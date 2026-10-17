// architecture.js - <page-architecture> (PAGE 02): the native 3D model of the parametric components,
// the section cut, quantities, typed creation of components and the inspectable export. Geometry
// comes from the model's results (the versioned functions); this page never computes geometry.
import { Viewer, PALETTE } from '../render/webgl.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class PageArchitecture extends HTMLElement {
  connectedCallback() {
    this.app = this.closest('coral-app');
    this.innerHTML = `
      <div class="toolbar">
        <button id="fit">Fit</button>
        <label>Section cut z <input id="cut" type="range" min="-1" max="12" step="0.05" value="12" style="width:140px"> <span id="cutv">off</span></label>
        <button id="ghost" aria-pressed="false">Ghost slabs</button><button id="xray" aria-pressed="false" title="Draw concrete translucent to see reinforcement">X-ray</button>
        <span class="sep"></span>
        <button id="add-level">+ Level</button><button id="add-wall">+ Wall</button><button id="add-column">+ Column</button><button id="add-slab">+ Slab</button><button id="add-beam">+ Beam</button>
        <span class="sep"></span>
        <button id="export">Export JSON</button>
        <span class="hint" id="stats"></span>
      </div>
      <div style="position:relative;flex:1;min-height:0"><canvas class="view3d"></canvas><div class="overlay-msg" id="msg">Drag to orbit · right-drag or Shift to pan · wheel to zoom · click to select</div></div>`;
    this.canvas = this.querySelector('canvas');
    try { this.viewer = new Viewer(this.canvas); } catch (err) { this.querySelector('#msg').textContent = `WebGL unavailable: ${err.message}`; }
    if (this.viewer) {
      this.viewer.onPick = (id, e) => this.app.select(id ? [id] : [], { toggle: e.ctrlKey || e.metaKey });
      this.viewer.onHover = id => { const el = id && this.app.model.get(id); const r = el && this.app.model.result(id); this.querySelector('#msg').textContent = el ? `${el.name} · ${el.type}${r?.volume_m3 !== undefined ? ` · ${r.volume_m3.toFixed(3)} m³` : ''}` : 'Drag to orbit · right-drag or Shift to pan · wheel to zoom · click to select'; };
    }
    this.ghost = false;
    this.onRegen = () => this.rebuild(); this.onSelect = () => this.viewer?.setSelection(this.app.selection);
    this.app.addEventListener('regenerate', this.onRegen); this.app.addEventListener('select', this.onSelect); this.app.addEventListener('model', this.onRegen);
    this.querySelector('#fit').onclick = () => this.viewer?.fit();
    this.querySelector('#cut').oninput = e => { const v = parseFloat(e.target.value); const off = v >= parseFloat(e.target.max); this.viewer?.setCut(off ? null : v); this.querySelector('#cutv').textContent = off ? 'off' : `${v.toFixed(2)} m`; };
    this.querySelector('#ghost').onclick = e => { this.ghost = !this.ghost; e.target.setAttribute('aria-pressed', this.ghost); this.rebuild(); };
    this.querySelector('#xray').onclick = e => { this.xray = !this.xray; e.target.setAttribute('aria-pressed', this.xray); this.rebuild(); };
    this.querySelector('#export').onclick = () => this.exportJSON(true);
    this.querySelector('#add-level').onclick = () => this.addLevel();
    for (const t of ['wall', 'column', 'slab', 'beam']) this.querySelector('#add-' + t).onclick = () => this.addTyped(t);
    this.rebuild(); this.viewer?.fit();
    globalThis.coralArch = this;
  }
  disconnectedCallback() { this.app.removeEventListener('regenerate', this.onRegen); this.app.removeEventListener('select', this.onSelect); this.app.removeEventListener('model', this.onRegen); }

  rebuild() {
    const m = this.app.model; const items = []; let vol = 0, steel = 0;
    for (const e of m.all()) {
      const r = m.result(e.id); if (!r || !r.positions) continue;
      const color = e.type === 'punching_zone' ? ((e.params.util?.value ?? 0) > 1 ? PALETTE.punching_fail : PALETTE.punching_zone) : PALETTE[e.type] || PALETTE.default;
      if (e.type === 'rebar') steel += e.params.mass_kg?.value ?? r.mass_kg ?? 0; else if (e.type !== 'punching_zone') vol += r.volume_m3 || 0;
      items.push({ id: e.id, mesh: r, color, alpha: this.xray && e.type !== 'rebar' && e.type !== 'punching_zone' ? 0.22 : this.ghost && e.type === 'slab' ? 0.35 : color[3] });
    }
    this.items = items;
    if (this.viewer) { const first = !this.viewer.items.length; this.viewer.setItems(items); this.viewer.setSelection(this.app.selection); if (first && items.length) this.viewer.fit(); }
    const lv = m.byType('level'); const zmax = Math.max(3, ...lv.map(l => (l.params.elevation?.value ?? 0) + (l.params.height?.value ?? 3))) + 1;
    const cut = this.querySelector('#cut'); if (parseFloat(cut.max) !== zmax) { const wasOff = parseFloat(cut.value) >= parseFloat(cut.max); cut.max = zmax; if (wasOff) cut.value = zmax; }
    this.querySelector('#stats').textContent = `${items.length} solids · ${vol.toFixed(3)} m³ concrete · ${steel.toFixed(1)} kg reinforcement · ${items.reduce((s, it) => s + it.mesh.indices.length / 3, 0)} triangles`;
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
