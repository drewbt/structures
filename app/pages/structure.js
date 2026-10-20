// structure.js - <page-structure> (PAGES 03 and 04): design and detailing of every structural element kind:
// beams (simply supported, continuous, cantilever), flat slabs with drop panels and punching zones,
// columns, pile caps and piles, with the load path that joins them. Every number here comes from a
// registered function or from the engine through the service; the page keeps only what it displays.
//
//   Design all:   beams → engine (service, cached) → beamResults → rcBeamDesign
//                 slabs → flatSlabDesign → column reactions, unbalanced moments
//                 loadTakedown (slabs + beams + self-weight + stated loads) → columns → columnDesign
//                 → caps (pileCapLayout when a column has none) → pileCapDesign
//   Generate:     every design's bars, stud rails and punching zones as elements, one batch, one undo step

import { beamInputs, beamModel, beamResults, rcBeamDesign, beamBars } from '../core/structure.js';
import { columnInputs, columnDesign, columnBars } from '../core/columns.js';
import { slabInputs, flatSlabDesign, flatSlabBars } from '../core/slabs.js';
import { loadTakedown, capInputs, pileCapLayout, pileCapDesign, pileCapBars } from '../core/foundations.js';
import { soilInputs, pileLength, createSoilProfile, modelExtent } from '../core/geotech.js';
import { towerGravity, createNeedleTower, gravityInputs } from '../core/tower.js';
import { analyseTower, towerFrame } from '../core/towerdyn.js';
import { asceCoverage } from '../core/coverage.js';
import { axisFrame } from '../core/detail.js';
import { sha256, canonicalJSON } from '../core/hash.js';
import { createReferenceFrame } from '../core/reference.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d));
const KINDS = [['beam', 'Beams'], ['slab', 'Slabs & punching'], ['column', 'Columns'], ['pilecap', 'Pile caps & piles'], ['loads', 'Load path']];
const P = (v, unit = '') => ({ value: v, unit });

export class PageStructure extends HTMLElement {
  connectedCallback() {
    this.app = this.closest('coral-app'); this.classList.add('page-scroll');
    this.kind = 'beam'; this.combo = 'U2'; this.diagram = 'M'; this.designs = new Map(); this.status = ''; this.busy = false;
    this.onChange = () => this.render();
    // a click in the model shows that element's design; a bar, pile, drop panel or zone shows its owner's
    this.onSelect = () => { const id = [...this.app.selection][0]; let e = id && this.app.model.get(id); if (e && !this.designs.has(e.id) && e.parent && this.designs.has(e.parent)) e = this.app.model.get(e.parent); if (e && this.designs.has(e.id)) { this.kind = e.type; this.selected = e.id; this.render(); } };
    this.app.addEventListener('regenerate', this.onChange); this.app.addEventListener('select', this.onSelect);
    globalThis.coralStructure = this;
    this.render();
    // the published copy opens complete: design everything as soon as the seeded model is in
    if (this.app.static) { const go = () => { if (!this.designs.size && !this.tower && !this.busy && this.model.byType('column').length) this.designAll(); }; if (this.model.elements.size) go(); else this.app.addEventListener('regenerate', go, { once: true }); }
  }
  disconnectedCallback() { this.app.removeEventListener('regenerate', this.onChange); this.app.removeEventListener('select', this.onSelect); }

  get model() { return this.app.model; }
  basis(kind, inputs, versions) { return sha256(canonicalJSON({ kind, inputs, versions })); }

  // ---- design ---------------------------------------------------------------------------------------
  /** Elevations that carry walls or columns: more than one means a multi-storey building, which member design does not cover yet. */
  storeys() { const m = this.model; return new Set([...m.byType('column'), ...m.byType('wall')].map(e => m.get(e.parent)?.params.elevation?.value ?? 0)).size; }   // distinct elevations, so two levels at one height are one storey
  /** The gravity summary of a multi-storey model (structure.towerGravity): what can be computed honestly today. */
  towerSummary() {
    const m = this.model, gi = gravityInputs(m); if (!gi || !(gi.mat.area > 0)) return null;
    const lv = m.byType('level').map(l => (l.params.elevation?.value ?? 0) + (l.params.height?.value ?? 0));
    return { ...towerGravity.run(gi), concrete_m3: gi.concrete_m3, floors: gi.floors.length, height: Math.max(...lv), storeys: this.storeys() };
  }
  /** Wind and vibration through the engine (tower.frame → modes → wind cases → tower.windChecks). */
  async towerWindAnalysis() {
    const runs = [];
    const run = async eng => { const r = await this.app.api.analyse(this.app.project, { element: 'tower', function: towerFrame.name, version: towerFrame.version, model: eng }); runs.push({ key: sha256(JSON.stringify(eng)), output: r.output, engine: r.engine }); return r.output; };
    const res = await analyseTower(this.model, run, { gravityInputs, towerGravity }); res.runs = runs; return res;
  }
  async designAll() {
    this.busy = true; this.status = 'designing…'; this.render();
    const m = this.model, designs = new Map(), errors = [];
    if (this.storeys() > 1) {   // a tower: member design here assumes one storey of columns, so it is refused, not approximated
      try { this.tower = this.towerSummary(); this.designs = designs; this.errors = []; this.takedown = null; this.towerWind = null;
        this.status = `${this.storeys()} storeys: running wind and vibration through the engine…`; this.render();
        try { this.towerWind = this.model.byType('wind').length ? await this.towerWindAnalysis() : null; this.towerWindError = null; } catch (err) { this.towerWind = null; this.towerWindError = err.message; }
        this.status = `${this.storeys()} storeys: gravity${this.towerWind ? ', wind and vibration' : ''} screened; member design through the stacked floors is not implemented`; }
      finally { this.busy = false; this.render(); this.app.dispatchEvent(new CustomEvent('designs')); }
      return { designs, errors };
    }
    this.tower = null;
    try {
      // beams through the engine
      const beamReactions = [];
      for (const b of m.byType('beam')) {
        try {
          const p = beamInputs(m, b), bm = beamModel.run(p);
          const r = await this.app.api.analyse(this.app.project, { element: b.id, function: beamModel.name, version: beamModel.version, model: bm.engine });
          const res = beamResults.run({ output: r.output, bm }), design = rcBeamDesign.run({ p, res, bm });
          designs.set(b.id, { kind: 'beam', el: b, p, bm, res, design, analysis: r, basis: this.basis('beam', p, [beamModel.version, beamResults.version, rcBeamDesign.version, beamBars.version]) });
          const F = axisFrame(p.start, p.end);
          res.cases.D.R.forEach((rr, j) => { const L = Object.keys(res.cases).filter(k => k.startsWith('L')).reduce((a, k) => a + res.cases[k].R[j].F[2], 0); beamReactions.push({ beam: b.id, at: F.W(rr.at, 0, 0).slice(0, 2), z: p.zTop, D: rr.F[2], L }); });
        } catch (err) { errors.push(`${b.name}: ${err.message}`); designs.set(b.id, { kind: 'beam', el: b, error: err.message }); }
      }
      // slabs
      const slabReactions = [];
      for (const sl of m.byType('slab').filter(s => m.byType('column').length)) {
        try { const s = slabInputs(m, sl); if (!s.cols.length) continue; const design = flatSlabDesign.run(s); designs.set(sl.id, { kind: 'slab', el: sl, s, design, basis: this.basis('slab', s, [flatSlabDesign.version, flatSlabBars.version]) }); slabReactions.push(...design.reactions); }
        catch (err) { errors.push(`${sl.name}: ${err.message}`); designs.set(sl.id, { kind: 'slab', el: sl, error: err.message }); }
      }
      // load path, columns, caps
      const cols = m.byType('column').map(c => columnInputs(m, c));
      const capEls = m.byType('pilecap'), caps = capEls.map(c => capInputs(m, c)).map(c => ({ ...c, size: c.size, H: c.H }));
      const take = loadTakedown.run({ columns: cols, slabReactions, beamReactions, caps });
      this.takedown = take; this.beamReactions = beamReactions;
      for (const c of cols) {
        const ld = take.columns.find(q => q.column === c.id), el = m.get(c.id);
        try { const design = columnDesign.run({ c, Pu_kN: ld.Pu, Mux_kNm: ld.Mux, Muy_kNm: ld.Muy }); designs.set(c.id, { kind: 'column', el, c, load: ld, design, basis: this.basis('column', { c, ld }, [columnDesign.version, columnBars.version]) }); }
        catch (err) { errors.push(`${c.name}: ${err.message}`); designs.set(c.id, { kind: 'column', el, error: err.message }); }
      }
      for (const cap of caps) {
        const ld = take.caps.find(q => q.cap === cap.id), colIn = cols.find(c => c.id === cap.column), cd = designs.get(cap.column)?.design, el = m.get(cap.id);
        try { const design = pileCapDesign.run({ cap, col: { b: colIn.b, h: colIn.h, fy: colIn.fy, dowel_db: cd?.bars.main.db }, load: { D: ld.D, L: ld.L, Pu: ld.Pu, Mux: ld.Mux, Muy: ld.Muy } }); designs.set(cap.id, { kind: 'pilecap', el, cap, load: ld, design, basis: this.basis('pilecap', { cap, ld }, [pileCapDesign.version, pileCapBars.version]) }); }
        catch (err) { errors.push(`${cap.name}: ${err.message}`); designs.set(cap.id, { kind: 'pilecap', el, error: err.message }); }
      }
      this.designs = designs; this.errors = errors;
      this.status = `${designs.size} elements designed${errors.length ? `, ${errors.length} errors` : ''}`;
    } finally { this.busy = false; this.render(); this.app.dispatchEvent(new CustomEvent('designs')); }
    return { designs: this.designs, errors: this.errors };
  }

  /**
   * Create a pile cap with its piles under every column that stands on no cap. A search for the least concrete:
   * pile diameter × pile count × cap depth; each pile is as short as the soil profile allows for its load
   * (geotech.pileLength), and the arrangement must pass every cap and pile check. With no soil profile in the
   * model the assumed default profile is added first, and the status says so.
   */
  createFoundations({ level } = {}) {
    const m = this.model, take = this.takedown; if (!take) throw new Error('design first: the pile count comes from the column loads');
    const DIAMS = [0.45, 0.6, 0.75], DEPTHS = [0.6, 0.75, 0.9, 1.0, 1.2, 1.4, 1.6], EMBED = 0.075;
    let made = 0; this.foundationNotes = [];
    m.batch('create foundations', () => {
      if (!m.byType('soil').length) { createSoilProfile(m, { extent: modelExtent(m) }); this.foundationNotes.push('no soil profile in the model: the assumed default (fill over stiff clay over dense sand) was added as "Ground"; replace it with site data'); }
      const soil = soilInputs(m);
      const lvl = level || m.byType('level').reduce((lo, l) => (!lo || (l.params.elevation?.value ?? 0) < (lo.params.elevation?.value ?? 0) ? l : lo), null);
      for (const c of m.byType('column')) {
        if (m.byType('pilecap').some(k => k.params.column?.value === c.id)) continue;
        const ci = columnInputs(m, c), ld = take.columns.find(q => q.column === c.id), cd = this.designs.get(c.id)?.design;
        const gb0 = (this.beamReactions || []).filter(r => r.z <= ci.z0 + 1e-6 && Math.hypot(r.at[0] - ci.center[0], r.at[1] - ci.center[1]) < 0.5);
        let best = null;
        for (const D of DIAMS) for (let n = 1; n <= 9; n++) for (const H of DEPTHS) {
          const proto = { spacing: 3 * D, pile_D: D, edge: 0.15, H, unit_weight: 23.6 };
          const lay = pileCapLayout.run({ cap: proto, D: ld.D + gb0.reduce((a, r) => a + r.D, 0), L: ld.L + gb0.reduce((a, r) => a + r.L, 0), Mx: ld.Mux, My: ld.Muy, n });
          if (lay.n !== n) break;   // 8 piles are laid out as 9
          const zHead = ci.z0 - H + EMBED;
          // grade-beam reactions that will land on this trial cap (below the column base, inside its footprint)
          const gb = (this.beamReactions || []).filter(r => r.z <= ci.z0 + 1e-6 && Math.abs(r.at[0] - ci.center[0]) <= lay.size[0] / 2 && Math.abs(r.at[1] - ci.center[1]) <= lay.size[1] / 2);
          const self = 23.6 * lay.size[0] * lay.size[1] * H, Dt = ld.D + self + gb.reduce((a, r) => a + r.D, 0), Lt = ld.L + gb.reduce((a, r) => a + r.L, 0);
          const trialDesign = len => pileCapDesign.run({ cap: { id: 'trial', name: 'trial', column: c.id, center: ci.center, size: lay.size, H, zTop: ci.z0, fc: 28, fy: 420, cover: 0.075, embed: EMBED, bar: '#7', unit_weight: 23.6, pile_D: D, pile_length: len.L, Qallow: len.capacity.Qallow, spacing: 3 * D, edge: 0.15,
            piles: lay.layout.map(([x, y], i) => ({ id: `p${i}`, at: [ci.center[0] + x, ci.center[1] + y], D, length: len.L, fc: 28, fy: 420, Qallow: len.capacity.Qallow, geo: len.capacity })) }, col: { b: ci.b, h: ci.h, fy: ci.fy, dowel_db: cd?.bars.main.db }, load: { D: Dt, L: Lt, Pu: Math.max(1.4 * Dt, 1.2 * Dt + 1.6 * Lt), Mux: ld.Mux, Muy: ld.Muy } });
          let len = pileLength.run({ soil, D, zHead, P: lay.maxService }); if (!len) break;   // no length up to 30 m carries it: more piles
          let des = trialDesign(len); const Pmax = Math.max(...des.reactions.Ps);
          if (Pmax > len.capacity.Qallow) { len = pileLength.run({ soil, D, zHead, P: Pmax }); if (!len) break; des = trialDesign(len); }
          const u = des.governing.util, trial = { D, H, lay, len, u, gov: des.governing.name, concrete: lay.size[0] * lay.size[1] * H + n * Math.PI * D * D / 4 * len.L };
          if (!best || (u <= 1 && (best.u > 1 || trial.concrete < best.concrete)) || (best.u > 1 && u < best.u)) best = trial;
          if (u <= 1) break;   // a deeper cap with the same piles only adds concrete
        }
        if (!best) { this.foundationNotes.push(`${c.name}: no pile up to 30 m carries the load in this soil profile`); continue; }
        const { D, H, lay, len } = best, L = len.L, g = len.capacity;
        if (best.u > 1) this.foundationNotes.push(`${c.name}: no searched arrangement passes (best ${best.gov} ${best.u.toFixed(2)})`);
        const cap = m.create({ type: 'pilecap', name: `K-${c.name}`, parent: lvl.id, params: { column: P(c.id, 'id'), center: P(ci.center, 'm'), size: P(lay.size.map(v => Math.round(v * 1000) / 1000), 'm'), thickness: P(H, 'm'), top: P(ci.z0, 'm'),
          fc: P(28, 'MPa'), fy: P(420, 'MPa'), cover: P(0.075, 'm'), pile_embed: P(EMBED, 'm'), bar: P('#7'), pile_diameter: P(D, 'm'), pile_length: P(L, 'm'), pile_spacing: P(3 * D, 'm'), pile_edge: P(0.15, 'm') },
          provenance: { source: `${pileCapLayout.name}@${pileCapLayout.version}+${pileLength.name}@${pileLength.version}+${pileCapDesign.name}@${pileCapDesign.version}`, trace: '', method: 'designed', note: `${lay.layout.length} × Ø${D * 1000} piles ${L} m long, cap ${H} m: least concrete of the searched arrangements (governing ${best.gov} ${best.u.toFixed(2)}); pile allowable ${g.Qallow.toFixed(0)} kN from the soil profile, which is ASSUMED` } });
        lay.layout.forEach(([x, y], i) => m.create({ type: 'pile', name: `${cap.name}-P${i + 1}`, parent: cap.id, params: { center: P([ci.center[0] + x, ci.center[1] + y].map(v => Math.round(v * 1e6) / 1e6), 'm'), diameter: P(D, 'm'), length: P(L, 'm'), fc: P(28, 'MPa'), fy: P(420, 'MPa') },
          provenance: { source: `${pileLength.name}@${pileLength.version}`, trace: cap.id, method: 'designed', note: `bored cast-in-place pile; shortest length (0.5 m steps, 3 m minimum) whose allowable load ${g.Qallow.toFixed(0)} kN (side ${g.Qside.toFixed(0)} + tip ${g.Qtip.toFixed(0)} kN, FS ${g.fs}) carries ${best.lay.maxService.toFixed(0)} kN; toe in ${g.toe_layer}` } }));
        made++;
      }
    });
    this.app.regenerate(); return made;
  }

  // ---- reinforcement -----------------------------------------------------------------------------------
  barsOf(id) { return this.model.all().filter(e => (e.type === 'rebar' || e.type === 'punching_zone') && e.parent === id); }
  barStatus(id) {
    const d = this.designs.get(id), bars = this.barsOf(id).filter(b => b.type === 'rebar'); if (!bars.length) return { text: 'no reinforcement', cls: 'dim' };
    if (!d || d.error) return { text: `${bars.length} bars, not designed in this session`, cls: 'dim' };
    const stale = bars.filter(x => x.params.basis?.value !== d.basis).length;
    return stale ? { text: `${stale} of ${bars.length} bars designed for other inputs: regenerate`, cls: 'bad' } : { text: `${bars.length} bars, current`, cls: 'ok' };
  }
  generateAll(ids = null) {
    const m = this.model; let n = 0;
    m.batch('generate reinforcement', () => {
      for (const [id, d] of this.designs) {
        if (d.error || (ids && !ids.includes(id))) continue;
        for (const old of this.barsOf(id)) m.remove(old.id);
        let out;
        if (d.kind === 'beam') out = beamBars.run({ p: d.p, design: d.design, beamId: d.el.name }).bars;
        else if (d.kind === 'column') { const cap = m.byType('pilecap').find(k => k.params.column?.value === id); const base = cap ? { zBottomMat: (cap.params.top.value - cap.params.thickness.value) + (cap.params.pile_embed?.value ?? 0.075) + 0.03 } : null; out = columnBars.run({ c: d.c, design: d.design, base }).bars; }
        else if (d.kind === 'pilecap') out = pileCapBars.run({ cap: d.cap, design: d.design }).bars;
        else if (d.kind === 'slab') { const r = flatSlabBars.run({ s: d.s, design: d.design }); out = [...r.bars, ...r.rails];
          for (const z of r.zones) m.create({ type: 'punching_zone', name: z.name, parent: id, params: { path: P(z.path, 'm'), column: P(z.column, 'id'), section: P(z.section), util: P(Math.round(z.util * 1000) / 1000), basis: P(d.basis) }, provenance: { source: `${flatSlabDesign.name}@${flatSlabDesign.version}`, trace: d.basis, method: 'designed', note: 'critical perimeter (ACI 318-19 22.6.4)' } }); }
        for (const x of out) {
          const params = { shape: P(x.shape), designation: P(x.designation), diameter: P(x.diameter, 'm'), path: P(x.path, 'm'), mark: P(x.mark), basis: P(d.basis), verification: P('designed, unchecked by a person') };
          for (const k of ['face', 'cover', 'spacing', 'anchorage_start', 'anchorage_end', 'role', 'studs', 'stud_spacing', 'first_stud', 'stud_height', 'mass_kg', 'pitch', 'strip', 'location']) if (x[k] !== undefined) params[k] = P(typeof x[k] === 'number' ? Math.round(x[k] * 1e6) / 1e6 : x[k], ['cover', 'spacing', 'anchorage_start', 'anchorage_end', 'stud_spacing', 'first_stud', 'stud_height', 'pitch'].includes(k) ? 'm' : k === 'mass_kg' ? 'kg' : '');
          const fn = { beam: rcBeamDesign, column: columnDesign, pilecap: pileCapDesign, slab: flatSlabDesign }[d.kind];
          m.create({ type: 'rebar', name: x.name, parent: id, params, provenance: { source: `${fn.name}@${fn.version}`, trace: d.analysis?.model_sha ?? d.basis, method: 'designed', note: d.kind === 'beam' ? `engine ${d.analysis.engine.slice(0, 12)}; ACI 318-19 (unverified ruleset)` : 'ACI 318-19 (unverified ruleset)' } });
          n++;
        }
      }
    });
    this.app.regenerate(); this.render(); return n;
  }

  // ---- view -----------------------------------------------------------------------------------------
  render() {
    if (this.busy && this.querySelector('.card')) { const st = this.querySelector('#status'); if (st) st.textContent = this.status; return; }
    const m = this.model, list = this.kind === 'loads' ? [] : m.byType(this.kind);
    const engine = this.app.status.health?.engine;
    const head = `<h2>Design and detailing</h2>
      <div class="card"><div class="actions" style="justify-content:flex-start;flex-wrap:wrap">
        <button id="ref">Create reference frame (synthetic)</button>
        <button id="tower">Create needle tower (synthetic)</button>
        <button id="design" class="primary">Design all</button>
        <button id="found" ${this.takedown ? '' : 'disabled'}>Create foundations under columns</button>
        <button id="gen" ${this.designs.size ? '' : 'disabled'}>Generate reinforcement</button>
        <span class="hint" id="status">${esc(this.status)}</span></div>
        <div class="hint">Engine ${engine ? 'stiffness ' + esc(engine.slice(0, 16)) + '…' : '<span class="pill bad">not configured</span>'} · ruleset ACI 318-19 <span class="pill warn">unverified against printed text</span>${this.errors?.length ? ` · <span class="pill bad">${this.errors.length} errors</span> ${esc(this.errors.join('; ').slice(0, 300))}` : ''}</div></div>
      <div class="toolbar" style="border:1px solid var(--line);border-radius:6px;margin-bottom:12px">${KINDS.map(([k, label]) => `<button data-kind="${k}" aria-pressed="${this.kind === k}">${label} (${k === 'loads' ? (this.takedown ? '✓' : '—') : m.byType(k).length})</button>`).join('')}</div>`;
    let body = '';
    if (this.tower !== undefined && this.tower !== null) body = this.towerView();
    else if (this.kind === 'loads') body = this.loadsView();
    else {
      const rows = list.map(e => { const d = this.designs.get(e.id), g = d?.design?.governing, st = this.barStatus(e.id);
        return `<tr data-id="${esc(e.id)}" style="cursor:pointer;${e.id === this.selected ? 'background:color-mix(in srgb, var(--accent) 12%, transparent)' : ''}"><td><b>${esc(e.name)}</b></td><td>${d?.error ? `<span class="pill bad">${esc(d.error)}</span>` : g ? esc(g.name) : '<span class="hint">not designed</span>'}</td><td>${g ? `<span class="pill ${g.util <= 1 ? 'ok' : 'bad'}">${f(g.util, 3)}</span>` : ''}</td><td><span class="pill ${st.cls}">${esc(st.text)}</span></td></tr>`; }).join('');
      body = `<div class="card"><table><thead><tr><th>Element</th><th>Governing check</th><th>Utilisation</th><th>Reinforcement</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="hint">none in the model</td></tr>'}</tbody></table></div>`;
      const sel = this.designs.get(this.selected); if (sel && sel.kind === this.kind && !sel.error) body += this.detailView(sel);
    }
    if (!this.tower && this.designs.size) body += `<div class="card">${this.coverageView({ kind: 'frame' })}</div>`;
    this.innerHTML = head + body;
    this.querySelector('#ref').onclick = () => { createReferenceFrame(this.app); this.status = 'reference frame created'; this.render(); };
    this.querySelector('#tower').onclick = () => { createNeedleTower(this.app); this.status = 'needle tower created'; this.designAll(); };
    this.querySelector('#design').onclick = () => this.designAll();
    this.querySelector('#found').onclick = () => { const n = this.createFoundations(); this.status = `${n} pile caps created; design again to check them`; this.render(); };
    this.querySelector('#gen').onclick = () => { const n = this.generateAll(); this.status = `${n} bars and rails generated`; this.render(); };
    for (const b of this.querySelectorAll('[data-kind]')) b.onclick = () => { this.kind = b.dataset.kind; this.render(); };
    for (const tr of this.querySelectorAll('tr[data-id]')) tr.onclick = () => { this.selected = tr.dataset.id; this.app.select([tr.dataset.id]); this.render(); };
    const combo = this.querySelector('#combo'); if (combo) combo.onchange = e => { this.combo = e.target.value; this.render(); };
    for (const b of this.querySelectorAll('[data-d]')) b.onclick = () => { this.diagram = b.dataset.d; this.render(); };
    this.drawDiagram();
  }
  towerView() {
    const t = this.tower, kN = v => `${f(v / 1000, 0)} MN`;
    return `<div class="card"><h3>Tower: gravity summary</h3><table>
      <tr><th>storeys with walls or columns</th><td>${t.storeys}</td></tr>
      <tr><th>height to top of crown</th><td>${f(t.height, 1)} m</td></tr>
      <tr><th>floor slabs</th><td>${t.floors}</td></tr>
      <tr><th>concrete</th><td>${f(t.concrete_m3, 0)} m³</td></tr>
      <tr><th>self-weight (24 kN/m³)</th><td>${kN(t.self_kN)}</td></tr>
      <tr><th>superimposed dead</th><td>${kN(t.sdl_kN)}</td></tr>
      <tr><th>live (no reduction)</th><td>${kN(t.L_kN)}</td></tr>
      <tr><th>total service gravity load</th><td><b>${kN(t.total_kN)}</b> (about ${f(t.total_kN / 9.81, 0)} t)</td></tr>
      <tr><th>mat area</th><td>${f(t.mat_area, 1)} m², bearing on ${esc(t.bearing_layer || '—')}</td></tr>
      <tr><th>average bearing pressure</th><td>${f(t.q_kPa, 0)} kPa vs allowable ${t.qa_kPa ? `${f(t.qa_kPa, 0)} kPa <span class="pill warn">assumed</span> <span class="pill ${t.util <= 1 ? 'ok' : 'bad'}">${f(t.util, 3)}</span>` : '<span class="pill bad">not on rock with a stated qa</span>'}</td></tr></table>
      <p class="hint">${esc(towerGravity.name)}@${towerGravity.version}: ${towerGravity.assumptions.map(esc).join('; ')}.</p>
      </div>${this.towerWindView()}`;
  }
  towerWindView() {
    const w = this.towerWind;
    if (!w) return `<div class="card"><h3>Wind and vibration</h3><p class="hint">${this.towerWindError ? `<span class="pill bad">${esc(this.towerWindError)}</span>` : 'not run: the model has no wind site'}</p></div>`;
    const pass = w.checks.filter(c => !c.indicative).every(c => c.util <= 1) && !!w.seismic;
    const row = c => `<tr><td>${esc(c.name)}</td><td class="mono">${esc(c.clause)}</td><td>${f(c.demand, 3)}</td><td>${f(c.capacity, 3)}</td><td>${c.indicative ? `<span class="pill warn">${f(c.util, 2)} indicative</span>` : `<span class="pill ${c.util <= 1 ? 'ok' : 'bad'}">${f(c.util, 3)}</span>`}</td></tr>`;
    return `<div class="card"><h3>Wind, vibration and earthquake ${pass ? '<span class="pill ok">passes the analytical checks</span>' : '<span class="pill bad">fails</span>'}</h3>
      <div class="hint">Frame of ${w.frame.nodes} nodes and ${w.frame.members} members, ${f(w.frame.mass_t, 0)} t, run in the stiffness engine (${esc(w.runs?.[0]?.engine?.slice(0, 12) || '')}…). Site: V ${w.site.V} m/s (10-year ${w.site.V10} m/s), Exposure ${esc(w.site.exposure)}, damping ${(w.site.beta_service * 100).toFixed(1)} % + damper ${(w.added.x * 100).toFixed(1)} % (x) / ${(w.added.y * 100).toFixed(1)} % (y). Gf ultimate x ${f(w.gf.ultimate.x, 3)}, y ${f(w.gf.ultimate.y, 3)}.</div>
      ${w.seismic ? `<div class="hint" style="margin-top:4px">Earthquake: Ss ${w.seis.Ss} g, S1 ${w.seis.S1} g, site class ${esc(w.seis.site_class)} → SDS ${f(w.seismic.elf.SDS, 3)}, SD1 ${f(w.seismic.elf.SD1, 3)}, <b>SDC ${esc(w.seismic.elf.sdc)}</b>; ${esc(w.seismic.elf.system.name)} (R ${w.seismic.elf.system.R}, Cd ${w.seismic.elf.system.Cd}); Ta ${f(w.seismic.elf.Ta, 2)} s, Cu·Ta ${f(w.seismic.elf.CuTa, 2)} s; base shear x ${f(w.seismic.elf.x.V / 1000, 1)} MN, y ${f(w.seismic.elf.y.V / 1000, 1)} MN (Cs ${f(w.seismic.elf.x.Cs, 4)}, ${esc(w.seismic.elf.x.governs)}) against ultimate wind ${f(w.windBase.x / 1000, 1)} MN and ${f(w.windBase.y / 1000, 1)} MN. <span class="pill warn">site values assumed</span></div>` : '<div class="hint"><span class="pill bad">no seismic site: earthquake not checked</span></div>'}
      <table style="margin-top:6px"><thead><tr><th>Mode</th><th>Frequency</th><th>Period</th><th>Direction</th></tr></thead><tbody>${w.modes.map((q, i) => `<tr><td>${i + 1}</td><td>${f(q.n, 3)} Hz</td><td>${f(1 / q.n, 1)} s</td><td>${q.dir === 't' ? 'torsion' : q.dir === 'x' ? 'east-west (slender)' : 'north-south'}</td></tr>`).join('')}</tbody></table>
      <table style="margin-top:8px"><thead><tr><th>Check</th><th>Basis</th><th>Demand</th><th>Limit</th><th>Utilisation</th></tr></thead><tbody>${w.checks.map(row).join('')}</tbody></table>
      <p class="hint"><b>Code status.</b> ASCE 7-16 (adopted by the NYC Building Code) gives analytical wind loads only for buildings whose response is not governed by across-wind loading or vortex shedding (27.1.3); a tower this slender must be designed from a wind tunnel test (Chapter 31). The rows above are the analytical route and its screening: they pass or fail as shown, and the across-wind rows are outside the range of the only expression available, so they are indicative. Compliance is established by the tunnel test, not by this page. Coral's own wind tunnel (the LBM port) is not built yet.</p>
      ${this.coverageView({ kind: 'tower', tower: w, extras: w.extras })}
      <p class="hint"><b>Not computed:</b> member design of walls and slabs through the stacked floors, transfers at setbacks, axial shortening and creep, construction sequence, the damper's own design.</p></div>`;
  }
  /** ASCE 7-16, every chapter, every run: applied, not applicable (why), or owed. */
  coverageView(ctx) {
    const rows = asceCoverage(ctx), n = k => rows.filter(r => r.status === k).length, cls = { applied: 'ok', 'not applicable': 'dim', owed: 'bad' };
    return `<details class="coverage" ${ctx.open ? 'open' : ''}><summary><b>ASCE 7-16, chapter by chapter</b>: ${n('applied')} applied · ${n('not applicable')} not applicable · <span class="pill bad">${n('owed')} owed</span></summary>
      <table style="margin-top:6px"><thead><tr><th>Ch.</th><th>Title</th><th>Status</th><th>What was done, or why not</th></tr></thead><tbody>${rows.map(r => `<tr><td class="mono">${esc(r.ch)}</td><td>${esc(r.title)}</td><td><span class="pill ${cls[r.status]}">${esc(r.status)}</span></td><td>${esc(r.note)}</td></tr>`).join('')}</tbody></table></details>`;
  }
  checksTable(d) { return `<table style="margin-top:8px"><thead><tr><th>Check</th><th>Clause</th><th>Demand</th><th>Capacity</th><th>Utilisation</th></tr></thead><tbody>${d.design.checks.map(k => `<tr><td>${esc(k.name)}</td><td class="mono">${esc(k.clause)}</td><td>${f(k.demand, 3)}</td><td>${f(k.capacity, 3)}</td><td>${k.superseded ? `<span class="pill dim" title="${esc(k.superseded)}">${f(k.util, 3)} superseded</span>` : `<span class="pill ${k.util <= 1 ? 'ok' : 'bad'}">${f(k.util, 3)}</span>`}</td></tr>`).join('')}</tbody></table>
    <div class="hint">Utilisation ≤ 1 satisfies the row; no row is a verdict on the structure. Units as the row's quantity requires (kN, kN·m, MPa, mm, mm²).</div>`; }
  detailView(d) {
    const e = d.el, x = d.design;
    if (d.kind === 'beam') {
      const c = d.res.combos[this.combo] || d.res.combos.U2;
      return `<div class="card"><h3>${esc(e.name)} — ${d.bm.intervals.length} interval(s), supports ${d.bm.supports.map(s => `${s.type}@${f(s.at, 2)}`).join(', ')} <span class="pill ${d.analysis.cached ? 'dim' : 'ok'}">${d.analysis.cached ? 'from cache' : 'engine run'}</span></h3>
        <div class="toolbar" style="border:none;padding:0 0 8px"><label>Combination <select id="combo">${Object.entries(d.res.combos).map(([k, v]) => `<option value="${k}" ${k === this.combo ? 'selected' : ''}>${k}: ${Object.entries(v.factors).map(([a, b]) => `${b}${a}`).join(' + ')}</option>`).join('')}</select></label>
        ${['M', 'V', 'w', 'E'].map(q => `<button data-d="${q}" aria-pressed="${this.diagram === q}">${{ M: 'Moment', V: 'Shear', w: 'Deflection', E: 'Envelope' }[q]}</button>`).join('')}</div>
        <canvas id="diag" style="width:100%;height:220px;background:var(--bg);border-radius:4px"></canvas>
        <div class="hint">Loads D ${f(d.bm.loads.wD, 3)} kN/m, L ${f(d.bm.loads.wL, 3)} kN/m · ${esc(this.combo)}: M ${f(c.Mmin)} … ${f(c.Mmax)} kN·m, |V| ${f(c.Vabs)} kN, |w| ${f(c.wabs * 1000, 3)} mm · reactions ${c.R.map(r => f(r.F[2], 1)).join(', ')} kN</div>
        <table style="margin-top:8px"><tr><th>Top regions</th><td>${x.top.map((r, k) => `T${k + 1}: ${f(r.x0, 2)}–${f(r.x1, 2)} m, ${r.n} ${r.bar} (Mu ${f(r.Mu, 1)}, φMn ${f(r.phiMn_kNm, 1)})`).join('<br>') || 'none (no hogging)'}</td></tr>
          <tr><th>Bottom</th><td>${x.bottom.map((r, k) => `B${k + 1}: ${f(r.x0, 2)}–${f(r.x1, 2)} m, ${r.n} ${r.bar} (Mu ${f(r.Mu, 1)}, φMn ${f(r.phiMn_kNm, 1)})`).join('<br>')}</td></tr>
          <tr><th>Stirrups</th><td>${x.shear.map(s => `span ${s.interval + 1}: ${x.bars.stirrup.id} @ ${s.s} mm (Vu ${f(s.Vu_kN, 1)}, φVn ${f(s.phiVn_kN, 1)})`).join('<br>')}</td></tr></table>${this.checksTable(d)}</div>`;
    }
    if (d.kind === 'column') return `<div class="card"><h3>${esc(e.name)} — Pu ${f(x.Pu_kN, 1)} kN, Mux ${f(x.Mux_kNm, 1)}, Muy ${f(x.Muy_kNm, 1)} kN·m (magnified, ≥ minimum)</h3>
      <div class="hint">${x.layout.n} ${x.layout.bar} (${x.layout.nx} × ${x.layout.ny} a face), ρ ${f(x.layout.rho * 100, 2)} % · ties ${x.ties.bar} @ ${x.ties.s} mm · kℓu/r ${f(x.slender.x.slenderness, 1)} / ${f(x.slender.y.slenderness, 1)} vs ${x.slender.limit} (δ ${f(x.slender.x.delta, 3)}, ${f(x.slender.y.delta, 3)}) · φPn,max ${f(x.phiPnMax_kN, 0)} kN · dowel lap ${f(x.dowel.lap, 0)} mm · load from: ${esc([d.load.slab ? 'slab' : '', ...d.load.beams].filter(Boolean).join(', ') || 'stated loads')}</div>
      <canvas id="diag" data-kind="pm" style="width:100%;height:260px;background:var(--bg);border-radius:4px;margin-top:8px"></canvas>${this.checksTable(d)}</div>`;
    if (d.kind === 'slab') {
      const pc = x.punching;
      return `<div class="card"><h3>${esc(e.name)} — grid ${x.grid.xs.length} × ${x.grid.ys.length}, qu ${f(x.loads.qu, 2)} kN/m² (D ${f(x.loads.qD, 2)}, L ${f(x.loads.qL, 2)})</h3>
        <table><thead><tr><th>Column</th><th>Location</th><th>Section</th><th>d</th><th>bo</th><th>Vu</th><th>vu</th><th>φvc</th><th>Util</th><th>Studs</th></tr></thead><tbody>${pc.flatMap(p => p.sections.map((s, i) => `<tr><td>${i ? '' : esc(p.name)}</td><td>${i ? '' : esc(p.location)}</td><td>${esc(s.label)}</td><td>${f(s.d_mm, 0)}</td><td>${f(s.bo_mm, 0)}</td><td>${f(s.Vu_kN, 1)}</td><td>${f(s.vu, 3)}</td><td>${f(s.phivc, 3)}</td><td><span class="pill ${s.util <= 1 ? 'ok' : 'bad'}">${f(s.util, 2)}</span></td><td>${i === 0 && p.rails ? `${p.rails.nRails} rails × ${p.rails.studs} ${p.rails.stud} @ ${p.rails.s} (outer ${f(p.rails.outer.util, 2)})` : ''}</td></tr>`)).join('')}</tbody></table>
        <details style="margin-top:8px"><summary>Strips (${x.strips.x.strips.length + x.strips.y.strips.length})</summary><table>${['x', 'y'].flatMap(dir => x.strips[dir].strips.map(st => `<tr><td>${esc(st.kind)}</td><td>${f(st.width, 2)} m</td><td>${st.locations.map(l => `${esc(l.label)}: Mu ${f(l.Mu, 1)} → ${l.n ?? '—'} ${x.bar} @ ${l.spacing ?? '—'}`).join('<br>')}</td></tr>`)).join('')}</table></details>${this.checksTable(d)}</div>`;
    }
    if (d.kind === 'pilecap') return `<div class="card"><h3>${esc(e.name)} — ${d.cap.piles.length} piles Ø${f(d.cap.pile_D * 1000, 0)}, cap ${f(d.cap.size[0], 2)} × ${f(d.cap.size[1], 2)} × ${f(d.cap.H, 2)} m, d ${f(x.d, 0)} mm</h3>
      <div class="hint">Load D ${f(d.load.D, 1)} kN, L ${f(d.load.L, 1)} kN, Pu ${f(d.load.Pu, 1)} kN, Mux ${f(d.load.Mux, 1)}, Muy ${f(d.load.Muy, 1)} kN·m · pile reactions Pu ${x.reactions.Pu.map(v => f(v, 0)).join(', ')} kN (Σ ${f(x.sumPu, 1)}) · service ${x.reactions.Ps.map(v => f(v, 0)).join(', ')} kN vs allowable ${d.cap.Qsource === 'soil' ? `${d.cap.piles.map(p => f(p.Qallow, 0)).join(', ')} kN from the soil profile (piles ${[...new Set(d.cap.piles.map(p => p.length))].join(', ')} m)` : `${d.cap.Qallow} kN`} <span class="pill warn">assumed</span> · mats ${x.faces.x.n} + ${x.faces.y.n} ${x.bar}${x.stm ? ` · strut-and-tie: lever ${f(x.stm.lever_mm, 0)} mm, struts ${x.stm.struts.map(q => `${f(q.F_kN, 0)} kN @ ${f(q.theta_deg, 1)}°`).join(', ')}` : ''}</div>${this.checksTable(d)}</div>`;
    return '';
  }
  loadsView() {
    const t = this.takedown; if (!t) return '<div class="card hint">Design first: the load path is computed from the slab, beams and columns.</div>';
    const sumCaps = t.caps.reduce((a, c) => a + c.D + c.L, 0), sumCols = t.columns.reduce((a, c) => a + c.D + c.L, 0);
    const piles = [...this.designs.values()].filter(d => d.kind === 'pilecap' && !d.error).reduce((a, d) => a + d.design.reactions.Ps.reduce((p, v) => p + v, 0), 0);
    return `<div class="card"><h3>Load path — equilibrium</h3><table>
      <tr><th>Applied (service D + L)</th><td>slab ${f(t.applied.slab, 1)} + columns ${f(t.applied.columns, 1)} + beams ${f(t.applied.beams, 1)} + caps ${f(t.applied.caps, 1)} + stated ${f(t.applied.stated, 1)} = <b>${f(t.total, 1)} kN</b></td></tr>
      <tr><th>Σ at column bases</th><td>${f(sumCols, 1)} kN</td></tr><tr><th>Σ at caps</th><td>${f(sumCaps, 1)} kN ${t.caps.length ? `(difference from applied ${f(sumCaps - t.total, 6)} kN)` : '(no caps yet)'}</td></tr>
      <tr><th>Σ pile service reactions</th><td>${t.caps.length ? `${f(piles, 1)} kN` : '—'}</td></tr></table>
      <table style="margin-top:8px"><thead><tr><th>Column</th><th>D</th><th>L</th><th>Pu</th><th>Mux</th><th>Muy</th><th>From</th></tr></thead><tbody>${t.columns.map(c => `<tr><td>${esc(c.name)}</td><td>${f(c.D, 1)}</td><td>${f(c.L, 1)}</td><td>${f(c.Pu, 1)}</td><td>${f(c.Mux, 1)}</td><td>${f(c.Muy, 1)}</td><td>${esc([c.slab ? 'slab' : '', ...c.beams.map(b => this.model.get(b)?.name)].filter(Boolean).join(', '))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  drawDiagram() {
    const cv = this.querySelector('#diag'); if (!cv) return; const d = this.designs.get(this.selected); if (!d) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.font = '12px system-ui';
    if (cv.dataset.kind === 'pm') {   // interaction curves with the demand point
      const x = d.design, cx = x.curveX, cy = x.curveY, Mmax = Math.max(...cx.map(q => q[0]), ...cy.map(q => q[0]), x.Mux_kNm, x.Muy_kNm) * 1.1, Pmax = Math.max(...cx.map(q => q[1])) * 1.1, Pmin = Math.min(...cx.map(q => q[1]));
      const X = m => 40 + (W - 60) * m / Mmax, Y = p => H - 24 - (H - 40) * (p - Pmin) / (Pmax - Pmin);
      g.strokeStyle = '#8899aa'; g.beginPath(); g.moveTo(40, Y(0)); g.lineTo(W - 10, Y(0)); g.moveTo(40, 10); g.lineTo(40, H - 20); g.stroke();
      for (const [curve, col] of [[cx, '#1f6fd1'], [cy, '#2b9a5e']]) { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); curve.forEach((q, i) => (i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1])))); g.stroke(); }
      g.fillStyle = '#d23c3c'; for (const M of [x.Mux_kNm, x.Muy_kNm]) { g.beginPath(); g.arc(X(M), Y(x.Pu_kN), 4, 0, 7); g.fill(); }
      g.fillStyle = '#67788f'; g.fillText('φPn – φMn: about x (blue), about y (green); demand (red)', 46, 14); g.fillText('φMn kN·m →', W - 90, Y(0) - 4); g.fillText('φPn kN ↑', 44, 28); return;
    }
    const c = d.res.combos[this.combo] || d.res.combos.U2, xs = c.x, L = xs[xs.length - 1];
    let series, unit;
    if (this.diagram === 'E') { series = [d.res.envelope.Mmax, d.res.envelope.Mmin]; unit = 'kN·m'; }
    else { series = [this.diagram === 'w' ? c.w.map(v => v * 1000) : c[this.diagram]]; unit = { M: 'kN·m', V: 'kN', w: 'mm' }[this.diagram]; }
    const ymax = Math.max(1e-9, ...series.flat().map(Math.abs)), pad = 36, X = x => pad + (W - 2 * pad) * x / L, Y = y => H / 2 - (H / 2 - 20) * y / ymax;
    g.strokeStyle = '#8899aa'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(L), Y(0)); g.stroke();
    for (const s of d.bm.supports) { g.fillStyle = '#15223a'; g.beginPath(); g.moveTo(X(s.at), Y(0)); g.lineTo(X(s.at) - 6, Y(0) + 10); g.lineTo(X(s.at) + 6, Y(0) + 10); g.closePath(); g.fill(); }
    series.forEach((ys, k) => { g.strokeStyle = k ? '#d9731a' : '#1f6fd1'; g.fillStyle = k ? 'rgba(217,115,26,0.15)' : 'rgba(31,111,209,0.15)'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(0), Y(0)); xs.forEach((x, i) => g.lineTo(X(x), Y(ys[i]))); g.lineTo(X(L), Y(0)); g.closePath(); g.fill(); g.beginPath(); xs.forEach((x, i) => (i ? g.lineTo(X(x), Y(ys[i])) : g.moveTo(X(x), Y(ys[i])))); g.stroke(); });
    if (this.diagram === 'E') for (const r of d.design.top) { g.strokeStyle = '#b03a2e'; g.lineWidth = 3; g.beginPath(); g.moveTo(X(r.x0), 18); g.lineTo(X(r.x1), 18); g.stroke(); }
    g.fillStyle = '#67788f'; g.fillText(`${{ M: 'Bending moment (sagging up)', V: 'Shear V = dM/dx', w: 'Deflection (up)', E: 'Strength envelope; red bars: top-steel regions' }[this.diagram]} · ${unit}`, pad, 12);
  }
}
customElements.define('page-structure', PageStructure);
