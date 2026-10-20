// architecture.js - <page-architecture> (PAGE 02, the Model stage): the 3D model fills the window. View
// controls, colour by governing utilisation, typed creation of components and export sit in one toolbar;
// design and detailing (<page-structure>) open in a drawer over the viewport's right side. Geometry
// comes from the model's results (the versioned functions); this page never computes geometry.
import { Viewer, PALETTE } from '../render/webgl.js';
import { boxMesh } from '../core/geometry.js';
import './structure.js';

/** Utilisation colour ramp: green (low) → amber (near 1) → red (over 1). RGBA. */
export function utilColor(u) {
  if (!(u >= 0)) return [0.6, 0.6, 0.6, 1];
  if (u > 1) return [0.84, 0.24, 0.24, 1];
  const lo = [0.20, 0.62, 0.42], mid = [0.86, 0.80, 0.30], hi = [0.93, 0.55, 0.16], t = Math.min(1, u);
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  return [...(t < 0.7 ? mix(lo, mid, t / 0.7) : mix(mid, hi, (t - 0.7) / 0.3)), 1];
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Presentation finishes: concrete in render mode is drawn as its finished surface (white render, painted soffits). */
const RENDER_FINISH = { slab: [0.93, 0.91, 0.87, 1], wall: [0.92, 0.89, 0.84, 1], column: [0.93, 0.92, 0.89, 1] };

export class PageArchitecture extends HTMLElement {
  connectedCallback() {
    this.app = this.closest('coral-app');
    this.colorBy = 'util'; this.show = { concrete: true, bars: true, zones: true, earth: true }; this.xray = false; this.ghost = true; this.renderMode = null;   // null: decided on first build (on when the model has a facade)
    this.innerHTML = `
      <div class="toolbar model-bar">
        <div class="group" aria-label="View">
          <button id="fit" title="Frame the whole model">Fit</button>
          <button id="render" aria-pressed="false" title="Presentation render: facade, sky, lit rooms, city; analysis overlays hidden">Render</button>
          <button id="xray" aria-pressed="false" title="Draw concrete translucent to see reinforcement">X-ray</button>
          <button id="ghost" aria-pressed="true" title="Draw slabs translucent">Ghost slabs</button>
          <button id="show-earth" aria-pressed="true" title="Show the ground: soil layers and water table">Earth</button>
          <button id="show-bars" aria-pressed="true" title="Show reinforcement">Bars</button>
          <button id="show-zones" aria-pressed="true" title="Show punching critical perimeters">Punching zones</button>
          <label class="cut">Cut <input id="cut" type="range" min="-1" max="12" step="0.05" value="12"> <span id="cutv">off</span></label>
        </div>
        <div class="group" aria-label="Colour">
          <span class="lbl">Colour</span>
          <button id="color-util" aria-pressed="true" title="Colour designed elements by their governing utilisation">Utilisation</button>
          <button id="color-mat" aria-pressed="false" title="Colour by element type">Material</button>
        </div>
        <details class="group add-menu"><summary>Add</summary><div class="menu">
          <button id="add-level">Level</button><button id="add-wall">Wall</button><button id="add-column">Column</button><button id="add-slab">Slab</button><button id="add-beam">Beam</button><button id="export">Export JSON</button></div></details>
        <span class="spacer"></span>
        <button id="design-toggle" class="primary" aria-pressed="false" title="Design and detailing for the selected element and the whole structure">Design</button>
      </div>
      <div class="viewport">
        <canvas class="view3d"></canvas>
        <div class="hud">
          <div class="caption" id="caption">Illustrative render: the facade, crown and spire are architecture drawn over the engineered structure; the city is illustrative massing, not a survey.</div>
          <div class="overlay-msg" id="msg">Drag to orbit · right-drag or Shift to pan · wheel to zoom · click an element</div>
          <div class="legend" id="legend" hidden></div>
          <div class="legend" id="earth-key" hidden></div>
          <div class="stats" id="stats"></div>
        </div>
        <aside class="drawer" id="drawer" hidden><button class="drawer-close" id="drawer-close" title="Close the design panel">×</button><page-structure></page-structure></aside>
      </div>`;
    this.canvas = this.querySelector('canvas'); this.drawer = this.querySelector('#drawer');
    try { this.viewer = new Viewer(this.canvas); } catch (err) { this.querySelector('#msg').textContent = `WebGL unavailable: ${err.message}`; }
    if (this.viewer) {
      this.viewer.onPick = (id, e) => this.app.select(id ? [id] : [], { toggle: e.ctrlKey || e.metaKey });
      this.viewer.onHover = id => { const el = id && this.app.model.get(id); const r = el && this.app.model.result(id); const u = el && this.utilOf(el); this.querySelector('#msg').textContent = el ? `${el.name} · ${el.type}${r?.volume_m3 ? ` · ${r.volume_m3.toFixed(3)} m³` : ''}${u !== null && u !== undefined ? ` · utilisation ${u.toFixed(2)}` : ''}` : 'Drag to orbit · right-drag or Shift to pan · wheel to zoom · click an element'; };
    }
    this.onRegen = () => this.rebuild(); this.onSelect = () => this.viewer?.setSelection(this.app.selection);
    this.app.addEventListener('regenerate', this.onRegen); this.app.addEventListener('select', this.onSelect); this.app.addEventListener('model', this.onRegen); this.app.addEventListener('designs', this.onRegen);
    const toggle = (id, fn) => { this.querySelector('#' + id).onclick = e => { fn(); this.syncButtons(); this.rebuild(); }; };
    this.querySelector('#fit').onclick = () => this.viewer?.fit();
    this.querySelector('#cut').oninput = e => { const v = parseFloat(e.target.value); const off = v >= parseFloat(e.target.max); this.viewer?.setCut(off ? null : v); this.querySelector('#cutv').textContent = off ? 'off' : `${v.toFixed(2)} m`; };
    toggle('render', () => { this.renderMode = !this.renderMode; this.viewer?.setRender(this.renderMode); if (this.renderMode) this.heroView(); });
    toggle('xray', () => { this.xray = !this.xray; }); toggle('ghost', () => { this.ghost = !this.ghost; });
    toggle('show-bars', () => { this.show.bars = !this.show.bars; }); toggle('show-zones', () => { this.show.zones = !this.show.zones; }); toggle('show-earth', () => { this.show.earth = !this.show.earth; });
    toggle('color-util', () => { this.colorBy = 'util'; }); toggle('color-mat', () => { this.colorBy = 'material'; });
    this.querySelector('#export').onclick = () => this.exportJSON(true);
    this.querySelector('#add-level').onclick = () => { this.querySelector('.add-menu').open = false; this.addLevel(); };
    for (const t of ['wall', 'column', 'slab', 'beam']) this.querySelector('#add-' + t).onclick = () => { this.querySelector('.add-menu').open = false; this.addTyped(t); };
    // the toolbar ids the tests and older links use: a hidden alias for "+ Beam" etc. is the menu item itself
    this.querySelector('#design-toggle').onclick = () => this.setDrawer(this.drawer.hidden);
    this.querySelector('#drawer-close').onclick = () => this.setDrawer(false);
    this.syncButtons(); this.rebuild(); this.viewer?.fit();
    globalThis.coralArch = this;
  }
  /** Open or close the design panel; the viewport keeps the full window behind it. */
  setDrawer(open) {
    if (open === undefined) return;
    this.drawer.hidden = !open; this.querySelector('#design-toggle').setAttribute('aria-pressed', String(open));
    if (open) this.querySelector('page-structure')?.render();
  }
  syncButtons() {
    const set = (id, v) => this.querySelector('#' + id)?.setAttribute('aria-pressed', String(v));
    set('render', !!this.renderMode); set('xray', this.xray); set('ghost', this.ghost); set('show-bars', this.show.bars); set('show-zones', this.show.zones); set('show-earth', this.show.earth); set('color-util', this.colorBy === 'util'); set('color-mat', this.colorBy === 'material');
  }
  /** Governing utilisation of an element, or of the designed element that owns it (a pile's cap, a drop panel's slab). */
  utilOf(el) {
    const st = globalThis.coralStructure; if (!st?.designs) return null;
    let d = st.designs.get(el.id); if (!d && el.parent) d = st.designs.get(el.parent);
    return d?.design?.governing?.util ?? null;
  }
  disconnectedCallback() { for (const ev of ['regenerate', 'model', 'designs']) this.app.removeEventListener(ev, this.onRegen); this.app.removeEventListener('select', this.onSelect); }

  /** A low view from the park towards the sunset, the whole tower and its spire in frame. */
  heroView() {
    const v = this.viewer; if (!v) return;
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const it of v.items) { const t = this.app.model.get(it.id)?.type; if (it.background && t !== 'curtain_wall' && t !== 'spire') continue; for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], it.mesh.bounds.min[k]); b.max[k] = Math.max(b.max[k], it.mesh.bounds.max[k]); } }
    if (!isFinite(b.min[0])) return;
    const H = Math.max(b.max[2], 1), aspect = (v.canvas.clientWidth || 1) / (v.canvas.clientHeight || 1), fovH = 2 * Math.atan(Math.tan(v.camera.fov / 2) * aspect), fov = Math.min(v.camera.fov, fovH);
    const skyline = this.app.model.byType('context').some(c => c.params.kind?.value === 'buildings');   // a real city around it: show the tower in its skyline
    v.camera.target = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, H * (skyline ? 0.4 : 0.5)];
    v.camera.theta = skyline ? 1.95 : 1.72; v.camera.phi = skyline ? 0.12 : -0.02;   // from over the park, looking down the avenues towards the sunset
    v.camera.dist = (H * 0.56) / Math.tan(fov / 2) * (skyline ? 2.4 : 1.12); v.needsDraw = true;
  }
  rebuild() {
    const m = this.app.model; const items = []; let vol = 0, steel = 0, designed = 0;
    if (this.renderMode === null) { this.renderMode = m.byType('curtain_wall').length > 0; this.viewer?.setRender(this.renderMode); this.syncButtons?.(); }
    const R = this.renderMode;
    for (const e of m.all()) {
      const r = m.result(e.id); if (!r || !r.positions) continue;
      const bar = e.type === 'rebar', zone = e.type === 'punching_zone';
      if (bar) steel += e.params.mass_kg?.value ?? r.mass_kg ?? 0; else if (!zone) vol += r.volume_m3 || 0;
      if ((bar && !this.show.bars) || (zone && !this.show.zones)) continue;
      if (R && (bar || zone)) continue;   // the presentation hides analysis overlays
      if (e.type === 'curtain_wall' || e.type === 'spire') { items.push({ id: e.id, mesh: r, color: PALETTE[e.type], alpha: R ? 1 : 0.14, background: !R }); continue; }
      if (e.type === 'context') { const k = e.params.kind?.value; if (this.show.earth) items.push({ id: e.id, mesh: r, color: PALETTE[`context_${k}`] || PALETTE.default, alpha: 1, background: true, material: k === 'ocean' || k === 'pool' ? 6 : 0 }); continue; }
      if (e.type === 'soil' || e.type === 'soil_layer') {   // the ground: seen through, never picked or coloured by design
        if (!this.show.earth) continue;
        if (R) { if (e.type === 'soil') items.push({ id: e.id, mesh: r, color: [0.30, 0.31, 0.33, 1], alpha: 1, background: true }); continue; }   // render: a paved plaza, no cutaway
        if (e.type === 'soil') {   // the surface sheet, and the water table drawn from the profile's stated depth
          items.push({ id: e.id, mesh: r, color: PALETTE.soil, alpha: 0.18, background: true });
          const w = e.params.water_depth?.value, [[x0, y0], [x1, y1]] = e.params.extent.value, zw = (e.params.surface?.value ?? 0) - w;
          if (Number.isFinite(w)) items.push({ id: e.id, mesh: boxMesh({ center: [(x0 + x1) / 2, (y0 + y1) / 2], size: [x1 - x0, y1 - y0], z0: zw - 0.01, z1: zw + 0.01 }), color: PALETTE.water, alpha: 0.22, background: true });
        } else items.push({ id: e.id, mesh: r, color: PALETTE[`soil_${e.params.kind?.value}`] || PALETTE.soil_fill, alpha: 0.7, background: true, cull: 'front' });   // cutaway: far walls and floor only
        continue;
      }
      let color = zone ? ((e.params.util?.value ?? 0) > 1 ? PALETTE.punching_fail : PALETTE.punching_zone) : PALETTE[e.type] || PALETTE.default;
      if (this.colorBy === 'util' && !bar && !zone) { const u = this.utilOf(e); if (u !== null) { color = utilColor(u); designed++; } }
      if (R) { const below = r.bounds && r.bounds.max[2] < -0.05; if (below) continue; items.push({ id: e.id, mesh: r, color: RENDER_FINISH[e.type] || PALETTE[e.type] || PALETTE.default, alpha: 1 }); continue; }   // render: no ghosting, no utilisation colours, nothing below grade
      items.push({ id: e.id, mesh: r, color, alpha: this.xray && !bar && !zone ? 0.22 : this.ghost && e.type === 'slab' ? 0.35 : color[3] });
    }
    this.items = items;
    if (this.viewer) { const first = !this.viewer.items.length; this.viewer.setItems(items); this.viewer.setSelection(this.app.selection); if (first && items.length) { if (R) this.heroView(); else this.viewer.fit(); } }
    this.classList.toggle('rendering', !!R);
    const real = m.byType('context').find(c => c.params.kind?.value === 'buildings'), cap = this.querySelector('#caption');
    if (cap) cap.textContent = real ? 'Design study, not the owner\'s scheme: the facade, terraces and crown are architecture over the engineered structure. Neighbours from OpenStreetMap (NYC building import, 2015) © OpenStreetMap contributors, ODbL; towers completed since added from published heights.' : 'Illustrative render: the facade, crown and spire are architecture drawn over the engineered structure; the city is illustrative massing, not a survey.';
    const lv = m.byType('level'); const zmax = Math.max(3, ...lv.map(l => (l.params.elevation?.value ?? 0) + (l.params.height?.value ?? 3))) + 1;
    const zmin = Math.floor(Math.min(-1, ...items.filter(it => it.mesh.bounds).map(it => it.mesh.bounds.min[2])));
    const cut = this.querySelector('#cut'); if (parseFloat(cut.min) !== zmin) cut.min = zmin; if (parseFloat(cut.max) !== zmax) { const wasOff = parseFloat(cut.value) >= parseFloat(cut.max); cut.max = zmax; if (wasOff) cut.value = zmax; }
    this.querySelector('#stats').textContent = `${vol.toFixed(1)} m³ concrete · ${(steel / 1000).toFixed(2)} t reinforcement · ${items.filter(it => !it.background).length} solids`;
    const soil = m.byType('soil')[0], key = this.querySelector('#earth-key'); key.hidden = !(soil && this.show.earth);
    if (soil) {
      const rgb = c => `rgb(${c.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`, layers = m.children(soil.id).filter(l => l.type === 'soil_layer').sort((a, b) => a.params.top.value - b.params.top.value);
      key.innerHTML = `<b>Ground</b> <span class="pill warn">assumed</span>${layers.map(l => { const k = l.params.kind?.value; return `<div class="sw"><i style="background:${rgb(PALETTE['soil_' + k] || PALETTE.soil_fill)}"></i>${esc(l.name)} ${l.params.top.value}–${l.params.bottom.value} m${k === 'clay' ? ` · su ${l.params.su?.value} kPa` : k === 'sand' ? ` · N60 ${l.params.N60?.value}` : k === 'rock' ? ` · qa ${l.params.qa?.value} kPa` : ''}</div>`; }).join('')}${Number.isFinite(soil.params.water_depth?.value) ? `<div class="sw"><i style="background:${rgb(PALETTE.water)}"></i>water table ${soil.params.water_depth.value} m</div>` : ''}`;
    }
    const legend = this.querySelector('#legend'); legend.hidden = !(this.colorBy === 'util' && designed);
    legend.innerHTML = `<b>Governing utilisation</b><div class="ramp"></div><div class="ticks"><span>0</span><span>0.5</span><span>1.0</span><span class="bad">&gt; 1</span></div><div class="hint">${designed} designed elements coloured; others by material</div>`;
  }
  addLevel() {
    const m = this.app.model; const top = m.byType('level').reduce((z, l) => Math.max(z, (l.params.elevation?.value ?? 0) + (l.params.height?.value ?? 3)), 0);
    const l = m.create({ type: 'level', name: `Level ${m.byType('level').length}`, params: { elevation: { value: top, unit: 'm' }, height: { value: 3, unit: 'm' } }, provenance: { source: '', trace: '', method: 'assumed', note: 'typed on the Architecture page; elevation stacked on the level below, height 3.000 m assumed' } });
    this.app.regenerate(); this.app.select([l.id]);
  }
  /** Typed creation with a small dialog; values in mm and metres as labelled. Method is "assumed" unless a source is given. */
  addTyped(type) {
    const m = this.app.model; const levels = m.byType('level'); if (!levels.length) { this.addLevel(); }
    const fields = type === 'wall' ? [['start', 'start x,y (m)', '0,0'], ['end', 'end x,y (m)', '6,0'], ['thickness', 'thickness (mm)', '200']]
      : type === 'column' ? [['center', 'centre x,y (m)', '3,2'], ['width', 'width (mm)', '300'], ['depth', 'depth (mm)', '300']]
      : type === 'beam' ? [['start', 'start x,y (m)', '0,0'], ['end', 'end x,y (m)', '4.6,0'], ['width', 'width (mm)', '400'], ['depth', 'depth (mm)', '700'], ['support_start', 'support at start', 'fixed'], ['support_end', 'support at end', 'free'], ['sdl', 'superimposed dead (kN/m)', '3'], ['ll', 'live (kN/m)', '6'], ['fc', 'f′c (MPa)', '28'], ['fy', 'fy (MPa)', '420']]
      : [['outline', 'outline x,y; x,y; … (m)', '0,0; 6,0; 6,4; 0,4'], ['thickness', 'thickness (mm)', '200'], ['offset', 'top offset from level (m)', '3']];
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<h3 style="margin:0">New ${type}</h3><div class="form"><label>level</label><select id="lvl">${m.byType('level').map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select>${fields.map(([k, label, dflt]) => `<label>${esc(label)}</label><input id="f-${k}" value="${esc(dflt)}">`).join('')}<label>source note</label><input id="note" placeholder="why these numbers (assumed if blank)"></div><div class="actions"><button id="cancel">Cancel</button><button id="ok" class="primary">Create</button></div>`;
    document.body.appendChild(dlg); dlg.showModal();
    dlg.querySelector('#cancel').onclick = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#ok').onclick = () => {
      try {
        const v = k => dlg.querySelector('#f-' + k).value; const xy = s => s.split(',').map(Number); const mmv = s => parseFloat(s) / 1000;
        const note = dlg.querySelector('#note').value;
        let params;
        if (type === 'wall') params = { start: { value: xy(v('start')), unit: 'm' }, end: { value: xy(v('end')), unit: 'm' }, thickness: { value: mmv(v('thickness')), unit: 'm' } };
        else if (type === 'column') params = { center: { value: xy(v('center')), unit: 'm' }, width: { value: mmv(v('width')), unit: 'm' }, depth: { value: mmv(v('depth')), unit: 'm' }, rotation: { value: 0, unit: 'deg' } };
        else if (type === 'beam') params = { start: { value: xy(v('start')), unit: 'm' }, end: { value: xy(v('end')), unit: 'm' }, width: { value: mmv(v('width')), unit: 'm' }, depth: { value: mmv(v('depth')), unit: 'm' },
          support_start: { value: v('support_start'), unit: '' }, support_end: { value: v('support_end'), unit: '' }, sdl: { value: parseFloat(v('sdl')), unit: 'kN/m' }, ll: { value: parseFloat(v('ll')), unit: 'kN/m' },
          fc: { value: parseFloat(v('fc')), unit: 'MPa' }, fy: { value: parseFloat(v('fy')), unit: 'MPa' }, fyt: { value: parseFloat(v('fy')), unit: 'MPa' }, unit_weight: { value: 23.6, unit: 'kN/m3' }, cover: { value: 0.04, unit: 'm' },
          bar_main: { value: '#8', unit: '' }, bar_stirrup: { value: '#3', unit: '' }, segments: { value: 20, unit: '' } };
        else params = { outline: { value: v('outline').split(';').map(s => xy(s.trim())), unit: 'm' }, thickness: { value: mmv(v('thickness')), unit: 'm' }, offset: { value: parseFloat(v('offset')), unit: 'm' } };
        const el = m.create({ type, name: `${type[0].toUpperCase()}${m.byType(type).length + 1}`, parent: dlg.querySelector('#lvl').value, params, provenance: { source: '', trace: '', method: note ? 'inferred' : 'assumed', note: note || 'typed on the Architecture page without a source' } });
        const r = this.app.regenerate(); if (r.errors[el.id]) throw new Error(r.errors[el.id]);
        this.app.select([el.id]); dlg.close(); dlg.remove();
      } catch (err) { alert(err.message); }
    };
  }
  exportJSON(download = false) {
    const data = this.app.model.exportInspectable();
    data.sources = this.app.sources;
    if (download) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${this.app.project}-rev${this.app.model.rev}.coral.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
    return data;
  }
}
customElements.define('page-architecture', PageArchitecture);
