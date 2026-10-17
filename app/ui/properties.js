// properties.js - <coral-properties>: the selected element's parameters, editable with explicit
// units, its provenance, and the lineage of its computed result (function@version, input hash,
// assumptions). An edit calls model.set and regenerates; the panel then re-renders from the model.
import { parseLength, convert } from '../core/units.js';
import { fnFor } from '../core/functions.js';

const LENGTH = new Set(['m', 'mm', 'cm']);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class CoralProperties extends HTMLElement {
  connectedCallback() {
    this.app = this.closest('coral-app');
    for (const ev of ['select', 'model', 'regenerate']) this.app.addEventListener(ev, () => this.render());
    this.render();
  }
  // Re-entrancy: replacing the panel's DOM while one of its inputs has focus blurs that input, which
  // fires its change event, which mutates the model and asks for another render INSIDE this one.
  // The guard serialises renders; the in-place patch below avoids replacing the DOM at all while
  // the selection and the parameter set are unchanged, so an input being edited keeps its focus.
  render() {
    if (this._rendering) { this._pending = true; return; }
    this._rendering = true;
    try { this._render(); } finally { this._rendering = false; }
    if (this._pending) { this._pending = false; this.render(); }
  }
  _render() {
    const ids = [...this.app.selection]; const m = this.app.model;
    const key = ids.length === 1 && m.get(ids[0]) ? ids[0] + '|' + Object.keys(m.get(ids[0]).params).sort().join(',') : null;
    if (key && key === this._key && this.patch(m.get(ids[0]))) return;
    this._key = key;
    if (ids.length !== 1 || !m.get(ids[0])) { this.innerHTML = `<h3>Properties</h3><div class="hint">${ids.length > 1 ? `${ids.length} elements selected` : 'Select an element in the tree or the viewport.'}</div>${this.summary()}`; return; }
    const e = m.get(ids[0]); const res = m.results.get(e.id); const fn = fnFor(e.type); const err = this.app.lastRegenerate?.errors?.[e.id];
    const rows = Object.keys(e.params).sort().map(k => {
      const p = e.params[k]; const isLen = LENGTH.has(p.unit) && typeof p.value === 'number';
      const isText = typeof p.value === 'string';
      const shown = isLen ? `${+convert(p.value, p.unit, 'mm').toFixed(3)}` : isText ? p.value : JSON.stringify(p.value);
      const unit = isLen ? 'mm' : p.unit;
      const ref = p.unit === 'id';
      return `<div class="row"><label title="${esc(k)} [${esc(p.unit)}]">${esc(k)} <span class="mono">${esc(unit)}</span></label>${ref ? `<select data-k="${esc(k)}">${m.all().filter(x => x.type === 'wall').map(x => `<option value="${esc(x.id)}" ${x.id === p.value ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<input data-k="${esc(k)}" data-len="${isLen ? 1 : 0}" data-text="${isText ? 1 : 0}" value="${esc(shown)}">`}</div>`;
    }).join('');
    this.innerHTML = `
      <section><h3>${esc(e.type)}</h3><div class="row"><label>name</label><input id="name" value="${esc(e.name)}"></div>
        <div class="row"><label>id</label><span class="mono">${esc(e.id)}</span></div>
        <div class="row"><label>parent</label><span class="mono">${esc(e.parent || '—')}</span></div></section>
      <section><h3>Parameters</h3>${rows || '<div class="hint">none</div>'}
        <div class="hint">Lengths are shown and typed in mm; a unit suffix (m, mm, ft) is honoured. Arrays as JSON.</div></section>
      <section><h3>Provenance</h3><div class="prov-text">${this.provHTML(e)}</div></section>
      <section><h3>Result</h3>${err ? `<div class="prov assumed result-err">error: ${esc(err)}</div>` : res ? `<div class="result-ok"></div><div class="row"><label>function</label><span class="mono">${esc(res.fn)}@${esc(res.version)}</span></div>
        <div class="row"><label>inputs</label><span class="mono ihash" title="sha256 of the canonical inputs">${esc(res.inputHash.slice(0, 16))}…</span></div>
        ${res.output?.volume_m3 !== undefined ? `<div class="row"><label>volume</label><span class="vol">${res.output.volume_m3.toFixed(4)} m³</span></div>` : ''}
        ${res.output?.area_m2 !== undefined ? `<div class="row"><label>area</label><span class="area">${res.output.area_m2.toFixed(3)} m²</span></div>` : ''}
        ${res.output?.scale !== undefined ? `<div class="row"><label>scale</label><span>${res.output.scale} m/px</span></div>` : ''}
        <details><summary class="hint">assumptions (${fn?.assumptions?.length ?? 0})</summary><ul class="hint">${(fn?.assumptions || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : fn ? '<div class="hint">not computed yet</div>' : '<div class="hint">no function for this type</div>'}</section>
      <section><div class="actions"><button id="del">Delete</button></div></section>`;
    this.querySelector('#name').onchange = ev => m.rename(e.id, ev.target.value);
    this.querySelector('#del').onclick = () => { m.remove(e.id); this.app.select([]); this.app.regenerate(); };
    for (const inp of this.querySelectorAll('input[data-k], select[data-k]')) inp.onchange = () => {
      const k = inp.dataset.k, p = e.params[k];
      try {
        let v;
        if (inp.tagName === 'SELECT') v = inp.value;
        else if (inp.dataset.len === '1') v = convert(parseLength(inp.value, 'mm'), 'mm', p.unit);   // shown in mm, so a bare number is mm; a suffix is honoured
        else if (inp.dataset.text === '1') v = inp.value;
        else v = JSON.parse(inp.value);
        m.set(e.id, k, v, p.unit); this.app.regenerate();
      } catch (err) { inp.style.borderColor = 'var(--bad)'; inp.title = err.message; }
    };
  }
  /** Update the shown values of an already-rendered element without rebuilding the DOM. False if the layout changed. */
  patch(e) {
    const m = this.app.model; const res = m.results.get(e.id); const err = this.app.lastRegenerate?.errors?.[e.id];
    if ((!!err) !== (!!this.querySelector('.result-err')) || (!!res) !== (!!this.querySelector('.result-ok'))) return false;
    for (const inp of this.querySelectorAll('input[data-k], select[data-k]')) {
      if (inp === document.activeElement) continue;   // never overwrite what is being typed
      const p = e.params[inp.dataset.k]; if (!p) return false;
      const shown = inp.tagName === 'SELECT' ? p.value : inp.dataset.len === '1' ? `${+convert(p.value, p.unit, 'mm').toFixed(3)}` : inp.dataset.text === '1' ? p.value : JSON.stringify(p.value);
      if (inp.value !== String(shown)) { inp.value = shown; inp.style.borderColor = ''; inp.title = ''; }
    }
    const name = this.querySelector('#name'); if (name && name !== document.activeElement && name.value !== e.name) name.value = e.name;
    const vol = this.querySelector('.vol'); if (vol && res?.output?.volume_m3 !== undefined) vol.textContent = `${res.output.volume_m3.toFixed(4)} m³`;
    const area = this.querySelector('.area'); if (area && res?.output?.area_m2 !== undefined) area.textContent = `${res.output.area_m2.toFixed(3)} m²`;
    const ih = this.querySelector('.ihash'); if (ih && res) ih.textContent = res.inputHash.slice(0, 16) + '…';
    const prov = this.querySelector('.prov-text'); if (prov) prov.innerHTML = this.provHTML(e);
    return true;
  }
  provHTML(e) { const prov = e.provenance; return prov ? `<div class="prov ${esc(prov.method || '')}"><b>${esc(prov.method || '?')}</b> · source <span class="mono">${esc(prov.source || '—')}</span><br>trace <span class="mono">${esc(prov.trace || '—')}</span>${prov.note ? `<br>${esc(prov.note)}` : ''}</div>` : '<div class="hint">none recorded</div>'; }
  summary() {
    const m = this.app.model; const vols = {};
    let steel = 0;
    for (const e of m.all()) { const r = m.result(e.id); if (e.type === 'rebar') { steel += e.params.mass_kg?.value ?? r?.mass_kg ?? 0; continue; } if (e.type === 'punching_zone') continue; if (r?.volume_m3 !== undefined) vols[e.type] = (vols[e.type] || 0) + r.volume_m3; }
    const total = Object.values(vols).reduce((s, v) => s + v, 0);
    return `<section><h3>Quantities</h3>${Object.entries(vols).map(([t, v]) => `<div class="row"><label>${esc(t)}</label><span>${v.toFixed(3)} m³</span></div>`).join('')}<div class="row"><label><b>concrete</b></label><span><b>${total.toFixed(3)} m³</b></span></div>${steel ? `<div class="row"><label><b>reinforcement</b></label><span><b>${steel.toFixed(1)} kg</b></span></div>` : ''}
      <div class="hint">Exact prism volumes of the generated geometry; junction overlaps not deducted (ASSUMPTIONS A-07).</div></section>
      <section><h3>Model</h3><div class="row"><label>hash</label><span class="mono">${m.hash().slice(0, 16)}…</span></div><div class="row"><label>computed / cached</label><span>${m.stats.computed} / ${m.stats.cached}</span></div></section>`;
  }
}
customElements.define('coral-properties', CoralProperties);
