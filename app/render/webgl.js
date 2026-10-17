// webgl.js - the 3D viewport on native WebGL (WebGL2, falling back to WebGL1 + OES_element_index_uint).
//
// The viewer holds a REDUCED copy of the engineering meshes (Float32 on the GPU) and nothing else:
// no parameters, no quantities. It never writes back. What it does: orbit/pan/zoom camera, flat
// Lambert shading, per-element colour, selection and hover by an id-colour pick pass, a horizontal
// section cut (fragments above `cutZ` are discarded), per-element transparency drawn after the
// opaque pass, and redraw only when something changed (the Eiffel page's lesson: drawing is where
// the time goes).

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec4 aCol; attribute vec3 aId;
uniform mat4 uProj, uView; uniform float uPick;
varying vec3 vNrm; varying vec4 vCol; varying vec3 vId; varying float vZ;
void main() { gl_Position = uProj * uView * vec4(aPos, 1.0); vNrm = aNrm; vCol = aCol; vId = aId; vZ = aPos.z; }`;
const FS = `
precision mediump float;
varying vec3 vNrm; varying vec4 vCol; varying vec3 vId; varying float vZ;
uniform float uPick; uniform float uCutZ; uniform vec3 uLight; uniform vec3 uLight2;
void main() {
  if (vZ > uCutZ) discard;
  if (uPick > 0.5) { gl_FragColor = vec4(vId, 1.0); return; }
  vec3 n = normalize(vNrm);
  float d = max(dot(n, normalize(uLight)), 0.0) * 0.65 + max(dot(n, normalize(uLight2)), 0.0) * 0.25 + 0.3;
  gl_FragColor = vec4(vCol.rgb * min(d, 1.0), vCol.a);
}`;

export const PALETTE = {
  wall: [0.80, 0.78, 0.74, 1], slab: [0.70, 0.72, 0.74, 1], column: [0.55, 0.58, 0.62, 1], opening: [0.3, 0.6, 0.9, 0.5],
  level: [0.5, 0.5, 0.5, 0.3], default: [0.6, 0.6, 0.6, 1], selected: [1.0, 0.62, 0.15, 1], hover: [0.35, 0.65, 1.0, 1],
};

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2]; let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true }) || canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl; this.webgl2 = gl instanceof (globalThis.WebGL2RenderingContext || function () {});
    if (!this.webgl2 && !gl.getExtension('OES_element_index_uint')) throw new Error('WebGL1 without OES_element_index_uint');
    this.prog = this._program(VS, FS);
    this.loc = {}; for (const a of ['aPos', 'aNrm', 'aCol', 'aId']) this.loc[a] = gl.getAttribLocation(this.prog, a);
    for (const u of ['uProj', 'uView', 'uPick', 'uCutZ', 'uLight', 'uLight2']) this.loc[u] = gl.getUniformLocation(this.prog, u);
    this.buf = { pos: gl.createBuffer(), nrm: gl.createBuffer(), col: gl.createBuffer(), id: gl.createBuffer(), idx: gl.createBuffer() };
    this.items = [];            // [{id, mesh, color, offset, count}]
    this.idIndex = [];          // pick index -> element id
    this.selected = new Set(); this.hover = null;
    this.camera = { theta: -0.8, phi: 0.95, dist: 20, target: [0, 0, 1.5], fov: 45 * Math.PI / 180 };
    this.cutZ = Infinity;
    this.needsDraw = true; this.frames = 0;
    this.onPick = null; this.onHover = null;
    this._bindInput();
    this._tick = this._tick.bind(this); requestAnimationFrame(this._tick);
  }

  /** Replace the scene. items: [{id, mesh, color?, alpha?}]. Uploads once; colours are rebuilt on selection. */
  setItems(items) {
    const gl = this.gl;
    let np = 0, ni = 0; for (const it of items) { np += it.mesh.positions.length; ni += it.mesh.indices.length; }
    const pos = new Float32Array(np), nrm = new Float32Array(np), idx = new Uint32Array(ni);
    let po = 0, io = 0; this.items = []; this.idIndex = [];
    items.forEach((it, k) => {
      pos.set(it.mesh.positions, po); nrm.set(it.mesh.normals, po);
      for (let i = 0; i < it.mesh.indices.length; i++) idx[io + i] = it.mesh.indices[i] + po / 3;
      const b = it.mesh.bounds; const center = b ? [0, 1, 2].map(k => (b.min[k] + b.max[k]) / 2) : [0, 0, 0];
      this.items.push({ id: it.id, mesh: it.mesh, center, color: it.color || PALETTE.default, alpha: it.alpha ?? (it.color ? it.color[3] : 1), vOffset: po / 3, vCount: it.mesh.positions.length / 3, iOffset: io, iCount: it.mesh.indices.length, pickIndex: k + 1 });
      this.idIndex[k + 1] = it.id; po += it.mesh.positions.length; io += it.mesh.indices.length;
    });
    this.vertexCount = np / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.nrm); gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const ids = new Float32Array(np);
    for (const it of this.items) { const r = (it.pickIndex & 255) / 255, g = ((it.pickIndex >> 8) & 255) / 255, b = ((it.pickIndex >> 16) & 255) / 255; for (let v = 0; v < it.vCount; v++) { ids[(it.vOffset + v) * 3] = r; ids[(it.vOffset + v) * 3 + 1] = g; ids[(it.vOffset + v) * 3 + 2] = b; } }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.id); gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
    this._uploadColors(); this.needsDraw = true;
  }
  _uploadColors() {
    const gl = this.gl; const col = new Float32Array(this.vertexCount * 4);
    for (const it of this.items) {
      const c = this.selected.has(it.id) ? PALETTE.selected : this.hover === it.id ? PALETTE.hover : it.color;
      for (let v = 0; v < it.vCount; v++) { const o = (it.vOffset + v) * 4; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; col[o + 3] = it.alpha; }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.col); gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
  }
  setSelection(ids) { this.selected = new Set(ids); if (this.items.length) this._uploadColors(); this.needsDraw = true; }
  setHover(id) { if (id === this.hover) return; this.hover = id; if (this.items.length) this._uploadColors(); this.needsDraw = true; }
  setCut(z) { this.cutZ = z == null ? Infinity : z; this.needsDraw = true; }
  /** Frame the scene: fit the bounds of all items. */
  fit(bounds) {
    if (!bounds) { const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (const it of this.items) if (it.mesh?.bounds) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], it.mesh.bounds.min[k]); max[k] = Math.max(max[k], it.mesh.bounds.max[k]); } bounds = isFinite(min[0]) ? { min, max } : { min: [-5, -5, 0], max: [5, 5, 3] }; }
    const c = [0, 1, 2].map(k => (bounds.min[k] + bounds.max[k]) / 2), size = Math.max(...[0, 1, 2].map(k => bounds.max[k] - bounds.min[k]), 1);
    this.camera.target = c; this.camera.dist = size * 1.4 / Math.tan(this.camera.fov / 2) * 0.6; this.needsDraw = true;
  }
  eye() { const c = this.camera; return [c.target[0] + c.dist * Math.cos(c.phi) * Math.cos(c.theta), c.target[1] + c.dist * Math.cos(c.phi) * Math.sin(c.theta), c.target[2] + c.dist * Math.sin(c.phi)]; }

  _program(vs, fs) {
    const gl = this.gl; const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
  }
  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.needsDraw = true; }
  }
  _draw(pick = false) {
    const gl = this.gl; this._resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.clearColor(pick ? 0 : 0.95, pick ? 0 : 0.96, pick ? 0 : 0.97, pick ? 0 : 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.items.length) return;
    gl.useProgram(this.prog);
    const bind = (name, buf, size) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(this.loc[name]); gl.vertexAttribPointer(this.loc[name], size, gl.FLOAT, false, 0, 0); };
    bind('aPos', this.buf.pos, 3); bind('aNrm', this.buf.nrm, 3); bind('aCol', this.buf.col, 4); bind('aId', this.buf.id, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
    const aspect = this.canvas.width / this.canvas.height;
    gl.uniformMatrix4fv(this.loc.uProj, false, mat4Perspective(this.camera.fov, aspect, 0.05, 5000));
    gl.uniformMatrix4fv(this.loc.uView, false, mat4LookAt(this.eye(), this.camera.target, [0, 0, 1]));
    gl.uniform1f(this.loc.uPick, pick ? 1 : 0); gl.uniform1f(this.loc.uCutZ, isFinite(this.cutZ) ? this.cutZ : 1e9);
    gl.uniform3f(this.loc.uLight, 0.4, -0.6, 1.0); gl.uniform3f(this.loc.uLight2, -0.7, 0.5, 0.3);
    const opaque = this.items.filter(it => it.alpha >= 1 || pick), trans = pick ? [] : this.items.filter(it => it.alpha < 1);
    gl.disable(gl.BLEND); gl.depthMask(true);
    for (const it of opaque) gl.drawElements(gl.TRIANGLES, it.iCount, gl.UNSIGNED_INT, it.iOffset * 4);
    if (trans.length) {
      const e = this.eye(); trans.sort((a, b) => dist2(b.center, e) - dist2(a.center, e));   // far to near
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      for (const it of trans) gl.drawElements(gl.TRIANGLES, it.iCount, gl.UNSIGNED_INT, it.iOffset * 4);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    function dist2(c, e) { return (c[0] - e[0]) ** 2 + (c[1] - e[1]) ** 2 + (c[2] - e[2]) ** 2; }
  }
  _tick() { if (this.needsDraw) { this._draw(false); this.needsDraw = false; this.frames++; } requestAnimationFrame(this._tick); }

  /** The element id under canvas pixel (x, y) in CSS px, or null. Renders a pick pass. */
  pick(x, y) {
    const gl = this.gl; this._draw(true);
    const dpr = this.canvas.width / this.canvas.clientWidth; const px = new Uint8Array(4);
    gl.readPixels(Math.floor(x * dpr), this.canvas.height - 1 - Math.floor(y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    this.needsDraw = true;
    const k = px[0] | (px[1] << 8) | (px[2] << 16); return k ? this.idIndex[k] ?? null : null;
  }

  _bindInput() {
    const c = this.canvas; let drag = null;
    c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false, shift: e.shiftKey }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; if (Math.abs(dx) + Math.abs(dy) > 0) drag.moved = true;
        if (drag.button === 2 || drag.shift) { const s = this.camera.dist / 600; const th = this.camera.theta; this.camera.target[0] += (-dx * Math.sin(th) * -1 - dy * Math.cos(th)) * s * -1; this.camera.target[1] += (dx * Math.cos(th) * -1 - dy * Math.sin(th)) * s * -1; }
        else { this.camera.theta -= dx * 0.008; this.camera.phi = Math.max(-1.5, Math.min(1.5, this.camera.phi + dy * 0.008)); }
        this.needsDraw = true;
      } else if (this.onHover) { const r = c.getBoundingClientRect(); const id = this.pick(e.clientX - r.left, e.clientY - r.top); this.setHover(id); this.onHover(id); }
    });
    c.addEventListener('pointerup', e => { if (drag && !drag.moved && drag.button === 0 && this.onPick) { const r = c.getBoundingClientRect(); this.onPick(this.pick(e.clientX - r.left, e.clientY - r.top), e); } drag = null; });
    c.addEventListener('wheel', e => { e.preventDefault(); this.camera.dist *= Math.exp(e.deltaY * 0.001); this.camera.dist = Math.max(0.5, Math.min(2000, this.camera.dist)); this.needsDraw = true; }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => { this.needsDraw = true; }).observe(c);
  }
}
