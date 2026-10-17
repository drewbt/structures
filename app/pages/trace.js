// trace.js - <page-trace> (PAGE 01): the drawing on a 2D canvas, calibration, the coordinate
// system, and manual tracing into trace primitives that become parametric components.
//
// Two kinds of record are written, deliberately: the TRACE (type "trace", parent = the drawing,
// pixel coordinates exactly as clicked) is the measurement; the COMPONENT (wall, column, slab,
// opening, in metres) is the model, derived from the trace through the drawing's calibration and
// carrying provenance {source, trace, method: "measured"}. If the calibration changes, "Re-derive"
// recomputes every component from its trace, so a corrected scale propagates (REQUIREMENTS §2).
// World coordinates are rounded to 1 mm (ASSUMPTIONS A-06).

import { convert } from '../core/units.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mm = v => Math.round(v * 1000) / 1000;
const TOOLS = [['select', 'Select'], ['calibrate', 'Calibrate'], ['origin', 'Origin'], ['axis', 'Axis'], ['wall', 'Wall'], ['column', 'Column'], ['slab', 'Slab'], ['opening', 'Opening']];
const HINTS = {
  select: 'Click an element to select it. Drag with the right button or Shift to pan; wheel to zoom.',
  calibrate: 'Click two points a known distance apart (the scale bar), then enter the distance.',
  origin: 'Click the pixel that is world (0, 0).',
  axis: 'Click a point on the world +x axis; the drawing rotation is set from the origin to it.',
  wall: 'Click the start and the end of a wall centreline. Snaps to ends and to orthogonal.',
  column: 'Click the column centre.',
  slab: 'Click the slab outline corners; press Enter or Finish to close the polygon (3+ points).',
  opening: 'Click on a wall centreline where the opening starts (measured from the wall start).',
};

export class PageTrace extends HTMLElement {
  connectedCallback() {
    this.app = this.closest('coral-app');
    this.tool = 'select'; this.pending = []; this.view = { x: 0, y: 0, k: 1 }; this.snapOn = true; this.cursor = null; this.snapPt = null;
    this.innerHTML = `<div class="toolbar"></div><div style="position:relative;flex:1;min-height:0"><canvas class="trace" tabindex="0"></canvas><div class="overlay-msg" id="msg"></div></div>`;
    this.toolbar = this.querySelector('.toolbar'); this.canvas = this.querySelector('canvas'); this.ctx = this.canvas.getContext('2d'); this.msg = this.querySelector('#msg');
    this.renderToolbar();
    this.bind();
    this.unsub = [
      () => this.app.removeEventListener('regenerate', this.onModel), () => this.app.removeEventListener('model', this.onModel), () => this.app.removeEventListener('select', this.onModel)];
    this.onModel = () => { this.loadImage(); this.draw(); };
    this.app.addEventListener('regenerate', this.onModel); this.app.addEventListener('model', this.onModel); this.app.addEventListener('select', this.onModel);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    this.loadImage(); this.fit(); this.draw();
    globalThis.coralTrace = this;   // test hook: imageToScreen / screenToImage / tool state
  }
  disconnectedCallback() { for (const u of this.unsub) u(); }

  // ---- the drawing in view -----------------------------------------------------------------------------
  get drawing() { const m = this.app.model; const d = m.byType('drawing'); return d.find(x => x.id === this.drawingId) || d[0] || null; }
  get transform() { return this.drawing ? this.app.model.result(this.drawing.id) : null; }
  loadImage() {
    const d = this.drawing; const url = d?.params.image_url?.value;
    if (!url) { this.img = null; return; }
    if (this.img && this.img.dataset.url === url) return;
    const img = new Image(); img.dataset.url = url; img.onload = () => { this.imgLoaded = true; this.fit(); this.draw(); }; img.onerror = () => { this.imgLoaded = false; this.draw(); };
    this.imgLoaded = false; img.src = url; this.img = img;
  }
  fit() {
    const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
    const iw = this.img?.naturalWidth || 1400, ih = this.img?.naturalHeight || 1000;
    this.view.k = Math.min(w / iw, h / ih) * 0.95; this.view.x = (w - iw * this.view.k) / 2; this.view.y = (h - ih * this.view.k) / 2;
  }
  imageToScreen(p) { return [p[0] * this.view.k + this.view.x, p[1] * this.view.k + this.view.y]; }
  screenToImage(s) { return [(s[0] - this.view.x) / this.view.k, (s[1] - this.view.y) / this.view.k]; }
  worldToImage(w) { const t = this.transform; return t ? t.toPixel(w) : null; }

  // ---- toolbar ------------------------------------------------------------------------------------------
  renderToolbar() {
    const m = this.app.model;
    this.toolbar.innerHTML = `
      <label>Drawing <select id="dr">${m.byType('drawing').map(d => `<option value="${esc(d.id)}" ${d.id === this.drawing?.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('') || '<option value="">none — register one on Source</option>'}</select></label>
      <span class="sep"></span>
      ${TOOLS.map(([id, label]) => `<button data-tool="${id}" aria-pressed="${this.tool === id}">${label}</button>`).join('')}
      <button id="finish" title="Close the slab polygon (Enter)">Finish</button>
      <span class="sep"></span>
      <label>Level <select id="level">${m.byType('level').map(l => `<option value="${esc(l.id)}" ${l.id === this.levelId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
      <label>Wall t <input id="t" value="200"> mm</label>
      <label>Column <input id="cw" value="300">×<input id="cd" value="300"> mm</label>
      <label>Slab t <input id="st" value="200"> mm</label>
      <label>Opening w <input id="ow" value="900"> h <input id="oh" value="2100"> sill <input id="os" value="0"> mm</label>
      <span class="sep"></span>
      <button id="snap" aria-pressed="${this.snapOn}">Snap</button>
      <button id="fit">Fit</button>
      <button id="rederive" title="Recompute every traced component from its trace with the current calibration">Re-derive</button>`;
    this.toolbar.querySelector('#dr').onchange = e => { this.drawingId = e.target.value; this.img = null; this.loadImage(); this.draw(); this.renderToolbar(); };
    this.toolbar.querySelector('#level').onchange = e => { this.levelId = e.target.value; };
    for (const b of this.toolbar.querySelectorAll('[data-tool]')) b.onclick = () => this.setTool(b.dataset.tool);
    this.toolbar.querySelector('#finish').onclick = () => this.finishSlab();
    this.toolbar.querySelector('#snap').onclick = () => { this.snapOn = !this.snapOn; this.renderToolbar(); };
    this.toolbar.querySelector('#fit').onclick = () => { this.fit(); this.draw(); };
    this.toolbar.querySelector('#rederive').onclick = () => this.rederive();
    this.hint();
  }
  setTool(t) { this.tool = t; this.pending = []; this.renderToolbar(); this.draw(); }
  hint(extra) { this.msg.textContent = (extra ? extra + ' · ' : '') + (HINTS[this.tool] || ''); }
  param(id, unitFrom = 'mm') { return convert(parseFloat(this.toolbar.querySelector('#' + id).value), unitFrom, 'm'); }
  get level() { const m = this.app.model; return (this.levelId && m.get(this.levelId)) ? this.levelId : (this.drawing?.params.level?.value && m.get(this.drawing.params.level.value)) ? this.drawing.params.level.value : m.byType('level')[0]?.id; }

  // ---- input --------------------------------------------------------------------------------------------
  bind() {
    const c = this.canvas; let drag = null;
    c.addEventListener('pointerdown', e => { const r = c.getBoundingClientRect(); drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.button !== 0 || e.shiftKey, sx: e.clientX - r.left, sy: e.clientY - r.top }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect(); const s = [e.clientX - r.left, e.clientY - r.top];
      if (drag && drag.pan) { this.view.x += e.clientX - drag.x; this.view.y += e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved = true; }
      else if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
      this.cursor = this.screenToImage(s); this.snapPt = this.snap(this.cursor); this.draw(); this.readout();
    });
    c.addEventListener('pointerup', e => { if (drag && !drag.moved && !drag.pan) this.click(this.screenToImage([drag.sx, drag.sy]), e); drag = null; });
    c.addEventListener('wheel', e => { e.preventDefault(); const r = c.getBoundingClientRect(); const s = [e.clientX - r.left, e.clientY - r.top]; const f = Math.exp(-e.deltaY * 0.0015); this.view.x = s[0] - (s[0] - this.view.x) * f; this.view.y = s[1] - (s[1] - this.view.y) * f; this.view.k *= f; this.draw(); }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('keydown', e => { if (e.key === 'Enter') this.finishSlab(); if (e.key === 'Escape') { this.pending = []; this.draw(); } });
  }
  readout() {
    const p = this.snapPt || this.cursor; if (!p) return; const t = this.transform;
    const w = t ? t.toWorld(p) : null;
    this.hint(`px ${p[0].toFixed(1)}, ${p[1].toFixed(1)}${w ? ` → ${w[0].toFixed(3)}, ${w[1].toFixed(3)} m` : ' (uncalibrated)'}${this.snapPt ? ' ⌖' : ''}`);
  }
  /** Snap an image point to nearby trace vertices, then (while drawing a wall) to orthogonal from the previous point. */
  snap(p) {
    if (!this.snapOn || !p) return null;
    const tol = 8 / this.view.k; let best = null, bd = tol;
    for (const t of this.traces()) for (const q of t.params.pts_px.value) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = [q[0], q[1]]; } }
    if (!best && this.tool === 'wall' && this.pending.length === 1) {
      const a = this.pending[0]; const dx = p[0] - a[0], dy = p[1] - a[1];
      if (Math.abs(dy) < Math.abs(dx) * Math.tan(3 * Math.PI / 180)) best = [p[0], a[1]];
      else if (Math.abs(dx) < Math.abs(dy) * Math.tan(3 * Math.PI / 180)) best = [a[0], p[1]];
    }
    return best;
  }
  traces() { const d = this.drawing; return d ? this.app.model.children(d.id).filter(e => e.type === 'trace') : []; }

  click(p, e) {
    const m = this.app.model, d = this.drawing; if (!d) return;
    p = this.snap(p) || p; p = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    switch (this.tool) {
      case 'select': { const id = this.hit(p); this.app.select(id ? [id] : [], { toggle: e.ctrlKey || e.metaKey }); break; }
      case 'calibrate': {
        this.pending.push(p);
        if (this.pending.length === 2) { const [p1, p2] = this.pending; this.pending = []; this.askDistance(p1, p2); }
        break;
      }
      case 'origin': m.set(d.id, 'origin_px', p, 'px'); this.app.regenerate(); this.rederive(false); break;
      case 'axis': {
        const o = d.params.origin_px?.value || [0, 0]; const ang = -Math.atan2(p[1] - o[1], p[0] - o[0]) * 180 / Math.PI;   // image y is down
        m.set(d.id, 'rotation', Math.round(ang * 1000) / 1000, 'deg'); this.app.regenerate(); this.rederive(false); break;
      }
      case 'wall': { this.pending.push(p); if (this.pending.length === 2) { const pts = this.pending; this.pending = []; this.makeTrace('wall', pts); } break; }
      case 'column': this.makeTrace('column', [p]); break;
      case 'slab': this.pending.push(p); break;
      case 'opening': { const host = this.nearestWall(p); if (!host) { this.hint('no wall near that point'); return; } this.makeTrace('opening', [p], { host }); break; }
    }
    this.draw();
  }
  finishSlab() { if (this.tool === 'slab' && this.pending.length >= 3) { const pts = this.pending; this.pending = []; this.makeTrace('slab', pts); this.draw(); } }

  askDistance(p1, p2) {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<h3 style="margin:0">Calibrate scale</h3><div class="form"><label>Pixels</label><span>${Math.hypot(p2[0] - p1[0], p2[1] - p1[1]).toFixed(2)} px</span><label>Real distance</label><input id="dist" placeholder="5" autofocus> <span class="hint" style="grid-column:2">metres (or with a unit: 5000 mm)</span></div><div class="actions"><button id="cancel">Cancel</button><button id="ok" class="primary">Set scale</button></div>`;
    document.body.appendChild(dlg); dlg.showModal();
    const done = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#cancel').onclick = done;
    dlg.querySelector('#ok').onclick = () => { try { this.calibrate(p1, p2, dlg.querySelector('#dist').value); done(); } catch (err) { dlg.querySelector('#dist').style.borderColor = 'var(--bad)'; dlg.querySelector('#dist').title = err.message; } };
    dlg.querySelector('#dist').onkeydown = e => { if (e.key === 'Enter') dlg.querySelector('#ok').click(); };
  }
  /** Set the calibration parameters on the drawing: the two points and the distance. Scale is derived by trace.pixelToWorld. */
  calibrate(p1, p2, distanceText) {
    const m = this.app.model, d = this.drawing;
    const txt = String(distanceText).trim(); const mt = txt.match(/^(-?[\d.]+)\s*([a-zA-Z]*)$/); if (!mt) throw new Error('enter a distance');
    const dist = convert(parseFloat(mt[1]), mt[2] || 'm', 'm'); if (!(dist > 0)) throw new Error('distance must be positive');
    m.set(d.id, 'cal_p1', p1, 'px'); m.set(d.id, 'cal_p2', p2, 'px'); m.set(d.id, 'cal_distance', dist, 'm');
    if (!d.params.origin_px || (d.params.origin_px.value[0] === 0 && d.params.origin_px.value[1] === 0)) m.set(d.id, 'origin_px', p1, 'px');
    this.app.regenerate(); this.rederive(false);
  }

  // ---- traces → components -------------------------------------------------------------------------------
  makeTrace(kind, pts, extra = {}) {
    const m = this.app.model, d = this.drawing;
    if (!this.transform) { this.hint('calibrate the drawing first'); return null; }
    const level = this.level; if (!level) { this.hint('no level: register a drawing with a level on Source'); return null; }
    const settings = { thickness: this.param('t'), width: this.param('cw'), depth: this.param('cd'), slab_t: this.param('st'), ow: this.param('ow'), oh: this.param('oh'), os: this.param('os') };
    const trace = m.create({ type: 'trace', name: `${kind} trace`, parent: d.id, params: { kind: { value: kind, unit: '' }, pts_px: { value: pts, unit: 'px' }, ...(extra.host ? { host: { value: extra.host, unit: 'id' } } : {}) }, provenance: { source: d.params.source?.value, trace: '', method: 'measured', note: `clicked on ${d.name}` } });
    const el = this.derive(trace, level, settings);
    this.app.regenerate(); this.app.select([el.id]);
    return el;
  }
  /** Build (or update, when `existing`) the component for a trace with the current transform. */
  derive(trace, level, s, existing = null) {
    const m = this.app.model, d = this.drawing, T = this.transform; const kind = trace.params.kind.value; const pts = trace.params.pts_px.value.map(p => T.toWorld(p).map(mm));
    const prov = { source: d.params.source?.value || '', trace: trace.id, method: 'measured', note: `derived from ${trace.id} on ${d.name} at ${T.scale.toPrecision(6)} m/px` };
    const P = (k, v, unit) => ({ [k]: { value: v, unit } });
    let params, name = existing?.name;
    if (kind === 'wall') { params = { ...P('start', pts[0], 'm'), ...P('end', pts[1], 'm'), ...(existing ? {} : P('thickness', s.thickness, 'm')) }; name ??= `W${m.byType('wall').length + 1}`; }
    else if (kind === 'column') { params = { ...P('center', pts[0], 'm'), ...(existing ? {} : { ...P('width', s.width, 'm'), ...P('depth', s.depth, 'm'), ...P('rotation', 0, 'deg') }) }; name ??= `C${m.byType('column').length + 1}`; }
    else if (kind === 'slab') { params = { ...P('outline', pts, 'm'), ...(existing ? {} : { ...P('thickness', s.slab_t, 'm'), ...P('offset', 0, 'm') }) }; name ??= `S${m.byType('slab').length + 1}`; }
    else if (kind === 'opening') {
      const host = m.get(trace.params.host.value); if (!host) throw new Error('opening host wall is gone');
      const a = host.params.start.value, b = host.params.end.value, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u = ((pts[0][0] - a[0]) * (b[0] - a[0]) + (pts[0][1] - a[1]) * (b[1] - a[1])) / L;
      params = { ...P('host', host.id, 'id'), ...P('offset', mm(Math.max(0, u)), 'm'), ...(existing ? {} : { ...P('width', s.ow, 'm'), ...P('height', s.oh, 'm'), ...P('sill', s.os, 'm') }) }; name ??= `O${m.byType('opening').length + 1}`;
    } else throw new Error(`unknown trace kind ${kind}`);
    if (existing) { for (const [k, p] of Object.entries(params)) m.set(existing.id, k, p.value, p.unit); m.setProvenance(existing.id, prov); return existing; }
    return m.create({ type: kind, name, parent: level, params, provenance: prov });
  }
  /** Recompute every component derived from this drawing's traces with the current calibration. */
  rederive(regen = true) {
    const m = this.app.model, d = this.drawing; if (!d || !this.transform) return 0;
    let n = 0;
    for (const t of this.traces()) { const el = m.all().find(e => e.provenance?.trace === t.id); if (!el) continue; this.derive(t, el.parent, null, el); n++; }
    if (regen) this.app.regenerate(); this.draw(); return n;
  }
  nearestWall(p) {
    const T = this.transform; if (!T) return null; const w = T.toWorld(p); let best = null, bd = 0.3;   // within 300 mm of a centreline
    for (const wall of this.app.model.byType('wall')) {
      const a = wall.params.start.value, b = wall.params.end.value, L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2; if (!L2) continue;
      const t = Math.max(0, Math.min(1, ((w[0] - a[0]) * (b[0] - a[0]) + (w[1] - a[1]) * (b[1] - a[1])) / L2));
      const d = Math.hypot(w[0] - (a[0] + t * (b[0] - a[0])), w[1] - (a[1] + t * (b[1] - a[1]))); if (d < bd) { bd = d; best = wall.id; }
    }
    return best;
  }
  hit(p) {
    const tol = 8 / this.view.k; let best = null, bd = tol;
    for (const t of this.traces()) {
      const pts = t.params.pts_px.value, el = this.app.model.all().find(e => e.provenance?.trace === t.id); const id = el?.id || t.id;
      if (pts.length === 1) { const d = Math.hypot(pts[0][0] - p[0], pts[0][1] - p[1]); if (d < bd) { bd = d; best = id; } continue; }
      for (let i = 0; i < pts.length - (t.params.kind.value === 'slab' ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const d = segDist(p, a, b); if (d < bd) { bd = d; best = id; } }
    }
    return best;
  }

  // ---- drawing -----------------------------------------------------------------------------------------
  draw() {
    const c = this.canvas, ctx = this.ctx; const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
    if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(h * dpr)) { c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const d = this.drawing;
    if (!d) { ctx.fillStyle = '#667'; ctx.font = '14px system-ui'; ctx.fillText('No drawing. Register one on the Source page.', 20, 30); return; }
    ctx.save(); ctx.translate(this.view.x, this.view.y); ctx.scale(this.view.k, this.view.k);
    if (this.img && this.imgLoaded) ctx.drawImage(this.img, 0, 0); else { ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 1400, 1000); }
    const lw = 1.5 / this.view.k; ctx.lineWidth = lw;
    // calibration, origin, axis
    const cal1 = d.params.cal_p1?.value, cal2 = d.params.cal_p2?.value;
    if (cal1 && cal2) { ctx.strokeStyle = '#d9731a'; ctx.beginPath(); ctx.moveTo(...cal1); ctx.lineTo(...cal2); ctx.stroke(); for (const p of [cal1, cal2]) { ctx.beginPath(); ctx.arc(p[0], p[1], 5 / this.view.k, 0, 7); ctx.stroke(); } }
    const o = d.params.origin_px?.value; const T = this.transform;
    if (o && T) { ctx.strokeStyle = '#d23c3c'; ctx.beginPath(); ctx.moveTo(...o); ctx.lineTo(...T.toPixel([1, 0])); ctx.stroke(); ctx.strokeStyle = '#2b9a5e'; ctx.beginPath(); ctx.moveTo(...o); ctx.lineTo(...T.toPixel([0, 1])); ctx.stroke(); }
    // components, drawn from the MODEL through the transform (so the picture is the model, not the trace)
    const m = this.app.model, sel = this.app.selection;
    if (T) {
      for (const e of m.all()) {
        const on = sel.has(e.id); ctx.strokeStyle = on ? '#1f6fd1' : 'rgba(31,111,209,0.75)'; ctx.fillStyle = on ? 'rgba(31,111,209,0.35)' : 'rgba(31,111,209,0.15)'; ctx.lineWidth = (on ? 3 : 1.5) / this.view.k;
        if (e.type === 'wall') { const a = T.toPixel(e.params.start.value), b = T.toPixel(e.params.end.value), t = e.params.thickness.value / T.scale / 2; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * t, ny = dx / L * t; ctx.beginPath(); ctx.moveTo(a[0] + nx, a[1] + ny); ctx.lineTo(b[0] + nx, b[1] + ny); ctx.lineTo(b[0] - nx, b[1] - ny); ctx.lineTo(a[0] - nx, a[1] - ny); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        else if (e.type === 'column') { const r = m.result(e.id); if (r) { const b = r.bounds; const p = T.toPixel([b.min[0], b.max[1]]), q = T.toPixel([b.max[0], b.min[1]]); ctx.fillRect(p[0], p[1], q[0] - p[0], q[1] - p[1]); ctx.strokeRect(p[0], p[1], q[0] - p[0], q[1] - p[1]); } }
        else if (e.type === 'slab') { const pts = e.params.outline.value.map(p => T.toPixel(p)); ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath(); ctx.fillStyle = on ? 'rgba(43,154,94,0.3)' : 'rgba(43,154,94,0.12)'; ctx.strokeStyle = '#2b9a5e'; ctx.fill(); ctx.stroke(); }
        else if (e.type === 'opening') { const host = m.get(e.params.host.value); if (host) { const a = host.params.start.value, b = host.params.end.value, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; const s0 = e.params.offset.value, s1 = s0 + e.params.width.value; const p0 = T.toPixel([a[0] + ux * s0, a[1] + uy * s0]), p1 = T.toPixel([a[0] + ux * s1, a[1] + uy * s1]); ctx.strokeStyle = on ? '#d9731a' : 'rgba(217,115,26,0.9)'; ctx.lineWidth = (host.params.thickness.value / T.scale) * 1.1; ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.stroke(); } }
      }
    }
    // pending primitive
    if (this.pending.length) { ctx.strokeStyle = '#d9731a'; ctx.lineWidth = 2 / this.view.k; ctx.setLineDash([6 / this.view.k, 4 / this.view.k]); ctx.beginPath(); this.pending.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); const cur = this.snapPt || this.cursor; if (cur) ctx.lineTo(...cur); ctx.stroke(); ctx.setLineDash([]); for (const p of this.pending) { ctx.beginPath(); ctx.arc(p[0], p[1], 4 / this.view.k, 0, 7); ctx.stroke(); } }
    if (this.snapPt) { ctx.strokeStyle = '#d23c3c'; ctx.lineWidth = 1.5 / this.view.k; ctx.strokeRect(this.snapPt[0] - 6 / this.view.k, this.snapPt[1] - 6 / this.view.k, 12 / this.view.k, 12 / this.view.k); }
    ctx.restore();
    if (!T) { ctx.fillStyle = 'rgba(217,115,26,0.9)'; ctx.font = '13px system-ui'; ctx.fillText('Not calibrated: use Calibrate on the scale bar, then Origin.', 12, 20); }
  }
}
function segDist(p, a, b) { const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2; if (!L2) return Math.hypot(p[0] - a[0], p[1] - a[1]); const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2)); return Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1]))); }
customElements.define('page-trace', PageTrace);
