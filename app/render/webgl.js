// webgl.js - the 3D viewport on native WebGL (WebGL2, falling back to WebGL1 + OES_element_index_uint).
//
// The viewer holds a REDUCED copy of the engineering meshes (Float32 on the GPU) and nothing else:
// no parameters, no quantities. It never writes back. What it does: orbit/pan/zoom camera, flat
// Lambert shading, per-element colour, selection and hover by an id-colour pick pass, a horizontal
// section cut (fragments above `cutZ` are discarded), per-element transparency drawn after the
// opaque pass, and redraw only when something changed (the Eiffel page's lesson: drawing is where
// the time goes).

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec4 aCol; attribute vec3 aId; attribute float aMat;
uniform mat4 uProj, uView; uniform float uPick;
varying vec3 vNrm; varying vec4 vCol; varying vec3 vId; varying vec3 vW; varying float vMat;
void main() { gl_Position = uProj * uView * vec4(aPos, 1.0); vNrm = aNrm; vCol = aCol; vId = aId; vW = aPos; vMat = aMat; }`;

// The sky, shared by the background pass and the glass reflections: blue hour, a warm horizon, the sun's glow.
const SKY = `
uniform vec3 uSun;
vec3 sky(vec3 d) {
  d = normalize(d); float t = d.z;
  vec2 sh = normalize(uSun.xy); float toward = length(d.xy) > 1e-4 ? dot(normalize(d.xy), sh) * 0.5 + 0.5 : 0.5;
  vec3 hor = mix(vec3(0.40, 0.42, 0.62), vec3(0.98, 0.60, 0.36), pow(toward, 2.5));   // warm only towards the sun; the far sky cools to violet
  vec3 zen = vec3(0.035, 0.07, 0.20), mid = mix(vec3(0.20, 0.26, 0.52), vec3(0.30, 0.34, 0.58), toward), gnd = vec3(0.05, 0.055, 0.08);
  vec3 c = t >= 0.0 ? mix(hor, mix(mid, zen, smoothstep(0.12, 0.75, t)), smoothstep(0.0, 0.22, t)) : mix(hor * 0.45, gnd, smoothstep(0.0, 0.12, -t));
  float s = max(dot(d, normalize(uSun)), 0.0);
  c += vec3(1.0, 0.62, 0.32) * (pow(s, 48.0) * 1.2 + pow(s, 6.0) * 0.18);
  return c;
}`;

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vNrm; varying vec4 vCol; varying vec3 vId; varying vec3 vW; varying float vMat;
uniform float uPick; uniform float uCutZ; uniform vec3 uLight; uniform vec3 uLight2;
uniform float uRender; uniform vec3 uEye; uniform float uFog;
${SKY}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// a lit or dark room behind each bay of glass: floor by floor, bay by bay
vec3 rooms(vec3 n, float floorH, float bay, float litP, vec3 warm) {
  vec2 tg = vec2(-n.y, n.x); float u = dot(vW.xy, tg);
  vec2 cell = vec2(floor(vW.z / floorH), floor(u / bay));
  float h = hash(cell + floor(n.xy * 3.0)), lit = step(1.0 - litP, h);
  float v = fract(vW.z / floorH); float ceilingGlow = smoothstep(0.55, 0.95, v) * 0.35;
  return mix(vec3(0.02, 0.035, 0.06), warm * (0.55 + 0.6 * hash(cell * 1.7)) * (0.85 + ceilingGlow), lit);
}
void main() {
  if (vW.z > uCutZ) discard;
  if (uPick > 0.5) { gl_FragColor = vec4(vId, 1.0); return; }
  vec3 n = normalize(vNrm);
  if (uRender < 0.5) {
    float d = max(dot(n, normalize(uLight)), 0.0) * 0.65 + max(dot(n, normalize(uLight2)), 0.0) * 0.25 + 0.3;
    gl_FragColor = vec4(vCol.rgb * min(d, 1.0), vCol.a); return;
  }
  vec3 V = normalize(vW - uEye); if (dot(n, V) > 0.0) n = -n;
  vec3 R = reflect(V, n); float ndv = max(dot(n, -V), 0.0), fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 L = normalize(uSun), sunCol = vec3(1.0, 0.68, 0.42), amb = sky(vec3(n.xy * 0.6, 0.6)) * 0.55;
  float diff = max(dot(n, L), 0.0), spec = pow(max(dot(R, L), 0.0), 120.0);
  int m = int(vMat + 0.5); vec3 c;
  if (m == 1) {        // vision glass: sky reflection over lit rooms
    vec3 refl = sky(R) * vec3(0.82, 0.90, 1.0) + sunCol * spec * 2.0;   // a cool, silvered glass
    c = mix(rooms(n, 4.6, 1.5, 0.30, vec3(1.0, 0.80, 0.55)) + vec3(0.015, 0.03, 0.06), refl, clamp(fres * 1.8 + 0.34, 0.0, 0.94));
  } else if (m == 2) { // the crown lantern and the spire tip
    float g = 0.75 + 0.25 * sin(vW.z * 0.9); c = vec3(1.0, 0.86, 0.62) * 1.25 * g + sky(R) * 0.1;
  } else if (m == 3) { // fins and spandrels: brushed metal
    c = vec3(0.62, 0.64, 0.68) * (amb * 1.4 + sunCol * diff * 0.9) + sky(R) * (0.45 + 0.4 * fres) + sunCol * spec * 1.5;   // brushed metal picks up the sky
  } else if (m == 4) { // louvres on the mechanical floors
    float st = step(0.5, fract(vW.z * 3.0)); c = mix(vec3(0.05, 0.055, 0.065), vec3(0.16, 0.17, 0.19), st) * (0.6 + amb) + sky(R) * 0.06;
  } else if (m == 5) { // the city: darker glass, smaller bays
    vec3 refl = sky(R) * 0.35;
    c = mix(rooms(n, 3.6, 3.0, 0.22, vec3(1.0, 0.74, 0.48)) * 0.55 + vec3(0.04, 0.05, 0.08), refl, clamp(fres * 1.2 + 0.2, 0.0, 0.8));
    if (n.z > 0.9) c = vec3(0.04, 0.045, 0.06) + amb * 0.08;
  } else {             // matte: the item's colour under a low sun and the sky (ground lifted a little so grass reads as grass)
    c = vCol.rgb * (amb * 0.9 + sunCol * diff * 0.75 + (n.z > 0.9 ? vec3(0.10, 0.12, 0.10) : vec3(0.0)));
  }
  float dist = length(vW - uEye), fog = 1.0 - exp(-dist / (m == 5 ? uFog * 0.45 : uFog));   // the city sits back in the haze
  vec3 haze = mix(sky(normalize(vec3(V.xy, 0.03))), vec3(0.16, 0.19, 0.30), m == 5 ? 0.75 : 0.45);   // a cool dusk haze, cooler still over the city
  c = mix(c, haze, clamp(fog, 0.0, 0.85));
  gl_FragColor = vec4(c, m == 0 ? vCol.a : 1.0);
}`;

const SKY_VS = `attribute vec2 aP; varying vec2 vP; void main() { vP = aP; gl_Position = vec4(aP, 0.9999, 1.0); }`;
const SKY_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vP; uniform vec3 uCamR, uCamU, uCamF; uniform float uTan, uAspect;
${SKY}
void main() { vec3 d = uCamF + vP.x * uTan * uAspect * uCamR + vP.y * uTan * uCamU; gl_FragColor = vec4(sky(d), 1.0); }`;

export const PALETTE = {
  wall: [0.80, 0.78, 0.74, 1], slab: [0.70, 0.72, 0.74, 1], column: [0.55, 0.58, 0.62, 1], opening: [0.3, 0.6, 0.9, 0.5],
  level: [0.5, 0.5, 0.5, 0.3], beam: [0.72, 0.70, 0.66, 1], rebar: [0.62, 0.22, 0.12, 1], pile: [0.55, 0.50, 0.45, 1], soil_fill: [0.45, 0.40, 0.35, 1], soil_clay: [0.62, 0.40, 0.26, 1], soil_sand: [0.90, 0.76, 0.45, 1], soil: [0.55, 0.62, 0.42, 1], soil_rock: [0.48, 0.50, 0.54, 1], context_park: [0.36, 0.62, 0.32, 1], context_street: [0.42, 0.42, 0.44, 1], context_city: [0.84, 0.85, 0.87, 1], context_buildings: [0.84, 0.85, 0.87, 1], context_trees: [0.18, 0.40, 0.20, 1], curtain_wall: [0.55, 0.72, 0.88, 1], spire: [0.75, 0.77, 0.80, 1], water: [0.25, 0.55, 0.85, 1], pilecap: [0.66, 0.64, 0.60, 1], drop_panel: [0.74, 0.74, 0.76, 1], punching_zone: [0.17, 0.60, 0.37, 1], punching_fail: [0.82, 0.24, 0.24, 1], default: [0.6, 0.6, 0.6, 1], selected: [1.0, 0.62, 0.15, 1], hover: [0.35, 0.65, 1.0, 1],
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

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true }) || canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl; this.webgl2 = gl instanceof (globalThis.WebGL2RenderingContext || function () {});
    if (!this.webgl2 && !gl.getExtension('OES_element_index_uint')) throw new Error('WebGL1 without OES_element_index_uint');
    this.prog = this._program(VS, FS);
    this.loc = {}; for (const a of ['aPos', 'aNrm', 'aCol', 'aId', 'aMat']) this.loc[a] = gl.getAttribLocation(this.prog, a);
    for (const u of ['uProj', 'uView', 'uPick', 'uCutZ', 'uLight', 'uLight2', 'uRender', 'uEye', 'uFog', 'uSun']) this.loc[u] = gl.getUniformLocation(this.prog, u);
    this.skyProg = this._program(SKY_VS, SKY_FS); this.skyLoc = { aP: gl.getAttribLocation(this.skyProg, 'aP') };
    for (const u of ['uCamR', 'uCamU', 'uCamF', 'uTan', 'uAspect', 'uSun']) this.skyLoc[u] = gl.getUniformLocation(this.skyProg, u);
    this.buf = { pos: gl.createBuffer(), nrm: gl.createBuffer(), col: gl.createBuffer(), id: gl.createBuffer(), idx: gl.createBuffer(), mat: gl.createBuffer(), sky: gl.createBuffer() };
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.sky); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.render = false; this.sun = [-0.78, -0.42, 0.10];   // render mode: a low sun in the west-south-west at dusk
    this.items = [];            // [{id, mesh, color, offset, count}]
    this.idIndex = [];          // pick index -> element id
    this.selected = new Set(); this.hover = null;
    this.camera = { theta: -0.8, phi: 0.35, dist: 20, target: [0, 0, 1.5], fov: 45 * Math.PI / 180 };
    this.cutZ = Infinity;
    this.needsDraw = true; this.frames = 0;
    this.onPick = null; this.onHover = null;
    this._bindInput();
    this._tick = this._tick.bind(this); requestAnimationFrame(this._tick);
  }

  /** Replace the scene. items: [{id, mesh, color?, alpha?, background?}]; a background item is drawn but not picked or fitted. Uploads once; colours are rebuilt on selection. */
  setItems(items) {
    const gl = this.gl;
    let np = 0, ni = 0; for (const it of items) { np += it.mesh.positions.length; ni += it.mesh.indices.length; }
    const pos = new Float32Array(np), nrm = new Float32Array(np), idx = new Uint32Array(ni);
    let po = 0, io = 0; this.items = []; this.idIndex = [];
    items.forEach((it, k) => {
      pos.set(it.mesh.positions, po); nrm.set(it.mesh.normals, po);
      for (let i = 0; i < it.mesh.indices.length; i++) idx[io + i] = it.mesh.indices[i] + po / 3;
      const b = it.mesh.bounds; const center = b ? [0, 1, 2].map(k => (b.min[k] + b.max[k]) / 2) : [0, 0, 0];
      this.items.push({ id: it.id, mesh: it.mesh, center, color: it.color || PALETTE.default, alpha: it.alpha ?? (it.color ? it.color[3] : 1), background: !!it.background, cull: it.cull || null, material: it.material || 0, vOffset: po / 3, vCount: it.mesh.positions.length / 3, iOffset: io, iCount: it.mesh.indices.length, pickIndex: k + 1 });
      this.idIndex[k + 1] = it.id; po += it.mesh.positions.length; io += it.mesh.indices.length;
    });
    this.vertexCount = np / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.nrm); gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const ids = new Float32Array(np);
    for (const it of this.items) { const r = (it.pickIndex & 255) / 255, g = ((it.pickIndex >> 8) & 255) / 255, b = ((it.pickIndex >> 16) & 255) / 255; for (let v = 0; v < it.vCount; v++) { ids[(it.vOffset + v) * 3] = r; ids[(it.vOffset + v) * 3 + 1] = g; ids[(it.vOffset + v) * 3 + 2] = b; } }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.id); gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
    const mats = new Float32Array(np / 3);   // per-vertex surface material (archgeom MAT), the item's own when the mesh has none
    for (const it of this.items) { const mm = it.mesh.materials; for (let v = 0; v < it.vCount; v++) mats[it.vOffset + v] = mm ? mm[v] : (it.material || 0); }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.mat); gl.bufferData(gl.ARRAY_BUFFER, mats, gl.STATIC_DRAW);
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
  /** Render mode: sky, glass, lit rooms, haze (the presentation view). Engineering mode: flat colours. */
  setRender(on) { this.render = !!on; this.needsDraw = true; }
  setCut(z) { this.cutZ = z == null ? Infinity : z; this.needsDraw = true; }
  /** Frame the scene: fit the bounds of all items. */
  fit(bounds) {
    if (!bounds) { const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (const it of this.items) if (it.mesh?.bounds && !it.background) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], it.mesh.bounds.min[k]); max[k] = Math.max(max[k], it.mesh.bounds.max[k]); } bounds = isFinite(min[0]) ? { min, max } : { min: [-5, -5, 0], max: [5, 5, 3] }; }
    // the bounding sphere inside the narrower of the two fields of view, so a tall tower fits a phone and a wide site a desktop
    const c = [0, 1, 2].map(k => (bounds.min[k] + bounds.max[k]) / 2), r = Math.max(0.5, Math.hypot(...[0, 1, 2].map(k => bounds.max[k] - bounds.min[k])) / 2);
    const aspect = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1), fovH = 2 * Math.atan(Math.tan(this.camera.fov / 2) * aspect);
    this.camera.target = c; this.camera.dist = r / Math.sin(Math.min(this.camera.fov, fovH) / 2) * 1.02; this.needsDraw = true;
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
    const eye = this.eye(), aspect = this.canvas.width / this.canvas.height;
    if (this.render && !pick) {   // the sky behind everything
      const f = norm3(sub3(this.camera.target, eye)), r = norm3(cross3(f, [0, 0, 1])), u = cross3(r, f);
      gl.useProgram(this.skyProg); gl.disable(gl.DEPTH_TEST);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.sky); gl.enableVertexAttribArray(this.skyLoc.aP); gl.vertexAttribPointer(this.skyLoc.aP, 2, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(this.skyLoc.uCamR, r); gl.uniform3fv(this.skyLoc.uCamU, u); gl.uniform3fv(this.skyLoc.uCamF, f); gl.uniform1f(this.skyLoc.uTan, Math.tan(this.camera.fov / 2)); gl.uniform1f(this.skyLoc.uAspect, aspect); gl.uniform3fv(this.skyLoc.uSun, this.sun);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disableVertexAttribArray(this.skyLoc.aP); gl.enable(gl.DEPTH_TEST);
    }
    if (!this.items.length) return;
    gl.useProgram(this.prog);
    const bind = (name, buf, size) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(this.loc[name]); gl.vertexAttribPointer(this.loc[name], size, gl.FLOAT, false, 0, 0); };
    bind('aPos', this.buf.pos, 3); bind('aNrm', this.buf.nrm, 3); bind('aCol', this.buf.col, 4); bind('aId', this.buf.id, 3); bind('aMat', this.buf.mat, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
    gl.uniformMatrix4fv(this.loc.uProj, false, mat4Perspective(this.camera.fov, aspect, Math.max(0.05, this.camera.dist / 2000), this.render ? 60000 : Math.max(5000, this.camera.dist * 10)));
    gl.uniformMatrix4fv(this.loc.uView, false, mat4LookAt(eye, this.camera.target, [0, 0, 1]));
    gl.uniform1f(this.loc.uRender, this.render && !pick ? 1 : 0); gl.uniform3fv(this.loc.uEye, eye); gl.uniform3fv(this.loc.uSun, this.sun); gl.uniform1f(this.loc.uFog, Math.max(600, this.camera.dist * 2.2));
    gl.uniform1f(this.loc.uPick, pick ? 1 : 0); gl.uniform1f(this.loc.uCutZ, isFinite(this.cutZ) ? this.cutZ : 1e9);
    gl.uniform3f(this.loc.uLight, 0.4, -0.6, 1.0); gl.uniform3f(this.loc.uLight2, -0.7, 0.5, 0.3);
    const opaque = pick ? this.items.filter(it => !it.background) : this.items.filter(it => it.alpha >= 1), trans = pick ? [] : this.items.filter(it => it.alpha < 1);   // background (the ground) is seen, never picked
    gl.disable(gl.BLEND); gl.depthMask(true);
    for (const it of opaque) gl.drawElements(gl.TRIANGLES, it.iCount, gl.UNSIGNED_INT, it.iOffset * 4);
    if (trans.length) {
      const e = this.eye(); trans.sort((a, b) => dist2(b.center, e) - dist2(a.center, e));   // far to near
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      for (const it of trans) {   // cull: 'front' draws only the inside faces of a closed solid, a cutaway (the ground)
        if (it.cull) { gl.enable(gl.CULL_FACE); gl.cullFace(it.cull === 'front' ? gl.FRONT : gl.BACK); } else gl.disable(gl.CULL_FACE);
        gl.drawElements(gl.TRIANGLES, it.iCount, gl.UNSIGNED_INT, it.iOffset * 4);
      }
      gl.disable(gl.CULL_FACE);
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
    c.addEventListener('wheel', e => { e.preventDefault(); this.camera.dist *= Math.exp(e.deltaY * 0.001); this.camera.dist = Math.max(0.5, Math.min(6000, this.camera.dist)); this.needsDraw = true; }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => { this.needsDraw = true; }).observe(c);
  }
}
