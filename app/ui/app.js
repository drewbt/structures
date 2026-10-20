// app.js - <coral-app>: owns the one Model, the Api, the selection and the page routing.
//
// Layout (REQUIREMENTS §4): nav on top, tree left, the stage page centre, properties right, the
// timeline/validation strip below. Pages are web components placed into <main class="stage">; each
// receives the same `app` and reads the same model. Routing is the URL hash: #source, #trace,
// #architecture. The project is the `project` query parameter (default "section-haus").

import { createNeedleTower } from '../core/tower.js';
import { createSiteTower } from '../core/sitetower.js';
import { createBeachResidences } from '../core/lowrise.js';
import { Model } from '../core/model.js';
import { Api } from '../core/api.js';
import { LocalApi } from '../core/api-local.js';

/** Older links: #architecture is the model; #structure is the model with the design panel open. */
const ALIASES = { architecture: 'model', structure: 'model' };

export const STAGES = [
  { id: 'source', n: '00', label: 'Source', tag: 'page-source' },
  { id: 'trace', n: '01', label: 'Trace', tag: 'page-trace' },
  { id: 'model', n: '02', label: 'Model', tag: 'page-architecture' },
  { id: 'feasibility', n: '03', label: 'Feasibility', tag: 'page-feasibility' },
];

export class CoralApp extends HTMLElement {
  connectedCallback() {
    const q = new URLSearchParams(location.search);
    this.static = !!globalThis.CORAL_STATIC;   // the published build: storage in this browser, precomputed engine results
    this.project = q.get('project') || (this.static ? 'park-lane' : 'section-haus');   // the published copy opens on the study on the real site
    this.model = new Model(this.project);
    this.api = this.static ? new LocalApi() : new Api('');
    this.selection = new Set();
    this.sources = [];
    this.status = { text: 'starting', saved: true, health: null };
    this.innerHTML = `
      <coral-nav></coral-nav>
      <coral-tree></coral-tree>
      <main class="stage"></main>
      <coral-properties></coral-properties>
      <coral-timeline></coral-timeline>`;
    this.nav = this.querySelector('coral-nav'); this.stage = this.querySelector('main.stage');
    this.tree = this.querySelector('coral-tree'); this.props = this.querySelector('coral-properties'); this.timeline = this.querySelector('coral-timeline');
    this.renderNav();
    this.model.on((ev) => { if (ev.kind !== 'regenerate' && ev.kind !== 'load' && ev.kind !== 'commit') this.status.saved = false; this.renderNav(); this.dispatchEvent(new CustomEvent('model', { detail: ev })); });
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.matches('input,textarea')) { e.preventDefault(); e.shiftKey ? this.model.redo() : this.model.undo(); this.regenerate(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(); }
    });
    globalThis.coral = this;   // the inspection hook the tests and the console use
    this.boot();
  }
  async boot() {
    try {
      this.status.health = await this.api.health();
      await this.load();
    } catch (err) { this.status.text = `service unreachable: ${err.message}`; this.renderNav(); }
    this.route();
  }
  get stageId() { return (location.hash || (this.static ? '#model' : '#source')).slice(1); }
  route() {
    const raw = this.stageId, id = ALIASES[raw] || raw;
    const stage = STAGES.find(s => s.id === id) || STAGES[0];
    if (this.page?.tagName.toLowerCase() !== stage.tag) {
      this.stage.innerHTML = ''; this.page = document.createElement(stage.tag); this.stage.appendChild(this.page);
    }
    if (raw === 'structure') this.page.setDrawer?.(true);
    this.classList.toggle('model-stage', stage.id === 'model');
    this.renderNav();
  }
  renderNav() {
    const m = this.model;
    this.nav.innerHTML = `
      <span class="brand">Coral Concrete</span>${this.static ? '<span class="pill warn" title="Model kept in this browser; engine results precomputed from the local service">published copy</span>' : ''}
      <nav class="stages">${STAGES.map(s => `<a href="#${s.id}" class="${s.id === (ALIASES[this.stageId] || this.stageId) ? 'on' : ''}"><span class="n">${s.n}</span>${s.label}</a>`).join('')}</nav>
      <span class="spacer"></span>
      <select id="project" title="Project">${[...new Set([...(this.static ? [] : ['section-haus']), 'park-lane', 'dorado', 'needle-tower', 'reference-frame', this.project])].map(p => `<option ${p === this.project ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <span class="status" id="status">rev ${m.rev}${this.status.saved ? '' : ' · unsaved'} · ${m.elements.size} elements${this.status.text ? ' · ' + this.status.text : ''}</span>
      <button id="undo" title="Undo (Ctrl+Z)">↶</button><button id="redo" title="Redo (Ctrl+Shift+Z)">↷</button>
      <button id="reload" title="Discard unsaved changes and reload from the service">Reload</button>
      <button id="save" class="primary" title="${this.static ? 'Commit a revision to this browser\'s storage' : 'Commit a revision to SQLite'} (Ctrl+S)">Save</button>`;
    this.nav.querySelector('#save').onclick = () => this.save();
    this.nav.querySelector('#project').onchange = e => { location.href = `${location.pathname}?project=${encodeURIComponent(e.target.value)}#model`; };
    this.nav.querySelector('#reload').onclick = () => this.load();
    this.nav.querySelector('#undo').onclick = () => { this.model.undo(); this.regenerate(); };
    this.nav.querySelector('#redo').onclick = () => { this.model.redo(); this.regenerate(); };
  }
  async load() {
    const data = await this.api.loadModel(this.project);
    this.model.loadWire(data);
    this.sources = await this.api.sources(this.project);
    this.status.saved = true; this.status.text = '';
    if (this.project === 'needle-tower' && !this.model.elements.size) { createNeedleTower(this); this.status.text = 'synthetic needle tower generated (not yet saved)'; }   // generated on first open, from tower.js
    if (this.project === 'dorado' && !this.model.elements.size) { createBeachResidences(this); this.status.text = 'Dorado beach residences concept generated (not yet saved)'; }
    if (this.project === 'park-lane' && !this.model.elements.size) {   // the study on the real site, among its real neighbours
      try { const site = await (await fetch('data/site-park-lane.json')).json(); createSiteTower(this, site); this.status.text = 'Park Lane study generated on the real site (not yet saved)'; }
      catch (err) { this.status.text = `site data unavailable: ${err.message}`; }
    }
    this.regenerate();
    this.dispatchEvent(new CustomEvent('sources'));
    return data;
  }
  async save(message = 'edit') {
    const body = this.model.commitBody(message);
    const r = await this.api.commit(this.project, body);
    if (r.conflict) { this.status.text = `conflict: service is at rev ${r.rev}, reload first`; this.renderNav(); return r; }
    this.model.committed(r.rev);
    this.status.saved = true; this.status.text = r.client_hash_agrees === false ? 'HASH MISMATCH with service' : this.static ? (r.persisted === false ? `rev ${r.rev} kept in this tab only (browser storage unavailable or full)` : `saved rev ${r.rev} in this browser`) : `saved rev ${r.rev}`;
    this.renderNav(); return r;
  }
  regenerate() { const r = this.model.regenerate(); this.lastRegenerate = r; this.dispatchEvent(new CustomEvent('regenerate', { detail: r })); return r; }
  select(ids, { toggle = false } = {}) {
    if (toggle) { for (const id of ids) this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id); }
    else this.selection = new Set(ids);
    this.dispatchEvent(new CustomEvent('select', { detail: [...this.selection] }));
  }
  async refreshSources() { this.sources = await this.api.sources(this.project); this.dispatchEvent(new CustomEvent('sources')); }
}
customElements.define('coral-app', CoralApp);
