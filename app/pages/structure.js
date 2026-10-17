// structure.js - <page-structure> (PAGE 03 + the first part of PAGE 04): one beam's chain from
// geometry to verified reinforcement. Every number on this page is computed by a registered function
// or returned by the engine through the service; the page holds only what it last displayed.
//
//   beam (model) → structure.beamModel → service /analyse (stiffness engine, cached by text hash)
//   → structure.beamResults → structure.rcBeamDesign (ACI 318-19) → structure.beamBars → rebar elements

import { beamInputs, beamModel, beamResults, rcBeamDesign, beamBars } from '../core/structure.js';
import { sha256, canonicalJSON } from '../core/hash.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d));

export class PageStructure extends HTMLElement {
  connectedCallback() {
    this.app = this.closest('coral-app'); this.classList.add('page-scroll');
    this.combo = 'U2'; this.diagram = 'M'; this.state = null; this.busy = false;
    this.onChange = () => this.refresh();
    this.app.addEventListener('regenerate', this.onChange); this.app.addEventListener('select', this.onChange);
    globalThis.coralStructure = this;
    this.refresh();
  }
  disconnectedCallback() { this.app.removeEventListener('regenerate', this.onChange); this.app.removeEventListener('select', this.onChange); }

  get beam() {
    const m = this.app.model; const sel = [...this.app.selection].map(id => m.get(id)).find(e => e?.type === 'beam');
    const b = sel || m.get(this.beamId) || m.byType('beam')[0]; if (b) this.beamId = b.id; return b || null;
  }
  /** The design basis hash: everything the design of this beam depends on. Bars carry it; a mismatch is "stale". */
  basisOf(p) { return sha256(canonicalJSON({ p, f: [beamModel.version, beamResults.version, rcBeamDesign.version, beamBars.version] })); }

  async refresh() {
    const b = this.beam; if (!b) { this.state = null; this.render(); return; }
    const m = this.app.model; let p, bm;
    try { p = beamInputs(m, b); bm = beamModel.run(p); } catch (err) { this.state = { beam: b, error: err.message }; this.render(); return; }
    const basis = this.basisOf(p);
    if (this.state?.basis === basis && this.state.design) { this.render(); return; }
    this.state = { beam: b, p, bm, basis, pending: true }; this.render();
    const token = (this.token = (this.token || 0) + 1);
    try {
      const r = await this.app.api.analyse(this.app.project, { element: b.id, function: beamModel.name, version: beamModel.version, model: bm.engine });
      if (token !== this.token) return;
      const res = beamResults.run({ output: r.output, n: bm.n, L: bm.L });
      const design = rcBeamDesign.run({ p, res, L: bm.L });
      this.state = { beam: b, p, bm, basis, analysis: r, res, design };
    } catch (err) { if (token === this.token) this.state = { beam: b, p, bm, basis, error: err.message }; }
    this.render();
  }

  bars() { const b = this.state?.beam; return b ? this.app.model.all().filter(e => e.type === 'rebar' && e.parent === b.id) : []; }
  barStatus() {
    const bars = this.bars(); if (!bars.length) return { text: 'no reinforcement', cls: 'dim' };
    const stale = bars.filter(x => x.params.basis?.value !== this.state.basis).length;
    return stale ? { text: `${stale} of ${bars.length} bars designed for other inputs: regenerate`, cls: 'bad' } : { text: `${bars.length} bars, current`, cls: 'ok' };
  }
  generateBars() {
    const { beam, p, design, basis } = this.state; const m = this.app.model;
    const out = beamBars.run({ p, design, beamId: beam.name });
    for (const old of this.bars()) m.remove(old.id);
    for (const x of out.bars) {
      m.create({ type: 'rebar', name: x.name, parent: beam.id, params: {
        shape: { value: x.shape, unit: '' }, designation: { value: x.designation, unit: '' }, diameter: { value: x.diameter, unit: 'm' }, path: { value: x.path.map(q => q.map(v => Math.round(v * 1e6) / 1e6)), unit: 'm' },
        mark: { value: x.mark, unit: '' }, ...(x.face ? { face: { value: x.face, unit: '' } } : {}), cover: { value: x.cover, unit: 'm' },
        ...(x.spacing ? { spacing: { value: x.spacing, unit: 'm' } } : {}), ...(x.anchorage_start !== undefined ? { anchorage_start: { value: x.anchorage_start, unit: 'm' }, anchorage_end: { value: x.anchorage_end, unit: 'm' } } : {}),
        steel: { value: `ASTM A615 Grade ${Math.round(p.fy / 6.894757)}ksi-equivalent fy ${p.fy} MPa`, unit: '' }, basis: { value: basis, unit: '' }, verification: { value: 'designed, unchecked by a person', unit: '' } },
        provenance: { source: `${rcBeamDesign.name}@${rcBeamDesign.version}`, trace: this.state.analysis.model_sha, method: 'designed', note: `${beamBars.name}@${beamBars.version}; engine ${this.state.analysis.engine.slice(0, 12)}; ACI 318-19 (unverified ruleset)` } });
    }
    this.app.regenerate(); this.render();
  }

  render() {
    const s = this.state, m = this.app.model;
    const beams = m.byType('beam');
    const head = `<h2>03 · Structure — beam analysis, design and reinforcement</h2>
      <div class="card"><div class="form" style="grid-template-columns:140px 1fr">
        <label>Beam</label><select id="beam">${beams.map(b => `<option value="${esc(b.id)}" ${b.id === s?.beam?.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('') || '<option>none: add a beam on page 02</option>'}</select>
        <label>Engine</label><span class="mono">${this.app.status.health?.engine ? 'stiffness ' + esc(this.app.status.health.engine.slice(0, 16)) + '…' : '<span class="pill bad">not configured: start coral-service with --engine</span>'}</span>
      </div></div>`;
    if (!s) { this.innerHTML = head + '<div class="hint">No beam in the model. Use “+ Beam” on page 02.</div>'; this.bindHead(); return; }
    if (s.error) { this.innerHTML = head + `<div class="card"><span class="pill bad">error</span> ${esc(s.error)}</div>`; this.bindHead(); return; }
    if (s.pending) { this.innerHTML = head + '<div class="card">Analysing…</div>'; this.bindHead(); return; }
    const { p, bm, res, design, analysis } = s; const c = res.combos[this.combo]; const st = this.barStatus();
    const rows = design.checks.map(k => `<tr><td>${esc(k.name)}</td><td class="mono">${esc(k.clause)}</td><td>${f(k.demand)}</td><td>${f(k.capacity)}</td><td><span class="pill ${k.util <= 1 ? 'ok' : 'bad'}">${f(k.util, 3)}</span></td></tr>`).join('');
    const face = n => { const x = design.faces[n]; return x?.error ? `<span class="pill bad">${esc(x.error)}</span>` : `${x.n} ${esc(x.bar)} (As ${f(x.As, 0)} mm² ≥ ${f(x.As_req, 0)} req.) · φMn ${f(x.phiMn_kNm, 1)} kN·m · ${esc(x.class)}`; };
    this.innerHTML = head + `
      <div class="card"><h3>Inputs</h3><table>
        <tr><th>Span</th><td>${f(bm.L, 3)} m, ${esc(p.support_start)} → ${esc(p.support_end)}, ${bm.n} Timoshenko segments</td><th>Section</th><td>${f(p.b * 1000, 0)} × ${f(p.h * 1000, 0)} mm, cover ${f(p.cover * 1000, 0)} mm</td></tr>
        <tr><th>Concrete</th><td>f′c ${p.fc} MPa, Ec ${f(bm.material.E / 1000, 0)} MPa (ACI 19.2.2.1b), γ ${p.unit_weight} kN/m³</td><th>Steel</th><td>fy ${p.fy} MPa, fyt ${p.fyt} MPa, bars ${esc(p.bar_main)} / stirrups ${esc(p.bar_stirrup)}</td></tr>
        <tr><th>Loads</th><td>D = ${f(bm.loads.wD, 3)} kN/m (self-weight ${f(bm.loads.selfweight, 3)} + SDL ${p.sdl}); L = ${f(bm.loads.wL, 3)} kN/m</td><th>Ruleset</th><td>${esc(design.ruleset.id)} <span class="pill warn">${esc(design.ruleset.status)}</span></td></tr></table></div>
      <div class="card"><h3>Analysis <span class="pill ${analysis.cached ? 'dim' : 'ok'}">${analysis.cached ? 'from cache' : 'engine run'}</span></h3>
        <div class="toolbar" style="border:none;padding:0 0 8px">
          <label>Combination <select id="combo">${Object.entries(res.combos).map(([k, v]) => `<option value="${k}" ${k === this.combo ? 'selected' : ''}>${k}: ${Object.entries(v.factors).map(([a, b]) => `${b}${a}`).join(' + ')}</option>`).join('')}</select></label>
          ${['M', 'V', 'w'].map(d => `<button data-d="${d}" aria-pressed="${this.diagram === d}">${{ M: 'Moment', V: 'Shear', w: 'Deflection' }[d]}</button>`).join('')}
        </div>
        <canvas id="diag" style="width:100%;height:220px;background:var(--bg);border-radius:4px"></canvas>
        <table><tr><th>${esc(this.combo)}</th><th>M max</th><th>M min</th><th>|V| max</th><th>|w| max</th><th>R start (Fz, My)</th><th>R end (Fz, My)</th></tr>
          <tr><td></td><td>${f(c.Mmax)} kN·m</td><td>${f(c.Mmin)} kN·m</td><td>${f(c.Vabs)} kN</td><td>${f(c.wabs * 1000, 3)} mm</td><td>${f(c.R.start[2])} kN, ${f(c.R.start[4])} kN·m</td><td>${f(c.R.end[2])} kN, ${f(c.R.end[4])} kN·m</td></tr></table>
        <div class="hint">Envelope: M⁺ ${f(res.envelope.Mpos)} (${res.envelope.governs.Mpos}), M⁻ ${f(res.envelope.Mneg)} (${res.envelope.governs.Mneg}), Vu ${f(res.envelope.Vu)} kN (${res.envelope.governs.Vu}). Signs: sagging positive, V = dM/dx, w up positive. Gross-section stiffness.</div>
        <div class="hint mono">model ${esc(analysis.model_sha.slice(0, 16))}… · engine ${esc(analysis.engine.slice(0, 16))}… · ${esc(analysis.function)} · ${esc(beamResults.name)}@${esc(beamResults.version)}</div></div>
      <div class="card"><h3>Design — ${esc(design.ruleset.id)} <span class="hint">governing: ${esc(design.governing?.name)} (${f(design.governing?.util, 3)})</span></h3>
        <table><tr><th>Top</th><td>${face('top')}</td></tr><tr><th>Bottom</th><td>${face('bottom')}</td></tr>
          <tr><th>Stirrups</th><td>${esc(design.bars.stirrup.id)} 2-leg @ ${design.shear.s} mm (max ${f(design.shear.s_max, 0)}) · φVn ${f(design.shear.phiVn_kN, 1)} kN vs Vu ${f(design.shear.Vu_kN, 1)} kN</td></tr>
          <tr><th>d</th><td>${f(design.d, 1)} mm · ld top ${f(design.anchorage.top, 0)} mm, bottom ${f(design.anchorage.bottom, 0)} mm (25.4.2.3)</td></tr>
          <tr><th>Deflection</th><td>immediate D ${f(design.deflection.immediate_D_mm, 2)} mm, D+L ${f(design.deflection.immediate_DL_mm, 2)} mm, L ${f(design.deflection.immediate_L_mm, 2)} mm (limit ${f(design.deflection.limit_L_mm, 1)}); long-term D ${f(design.deflection.long_term_D_mm, 2)} mm (λΔ ${f(design.deflection.lambda_delta, 2)}) · Ie/Ig ${f(design.deflection.Ie_DL / design.deflection.Ig, 3)}</td></tr></table>
        <table style="margin-top:8px"><thead><tr><th>Check</th><th>Clause</th><th>Demand</th><th>Capacity</th><th>Utilisation</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="hint">Demand and capacity are in kN·m, kN, mm² or mm as the row's quantity requires. Utilisation ≤ 1 satisfies the row; no row is a pass/fail verdict on the structure. The ruleset is unverified against the printed code (FUNCTION_REGISTRY.md).</div></div>
      <div class="card"><h3>Reinforcement <span class="pill ${st.cls}">${esc(st.text)}</span></h3>
        <div class="actions" style="justify-content:flex-start"><button id="gen" class="primary">Generate reinforcement from this design</button></div>
        ${this.bars().length ? `<table style="margin-top:8px"><thead><tr><th>Bar</th><th>Mark</th><th>Size</th><th>Shape</th><th>Length</th><th>Status</th></tr></thead><tbody>${this.bars().slice(0, 60).map(x => { const r = m.result(x.id); return `<tr><td>${esc(x.name)}</td><td>${esc(x.params.mark?.value)}</td><td>${esc(x.params.designation?.value)}</td><td>${esc(x.params.shape?.value)}</td><td>${f(r?.length_m, 3)} m</td><td>${x.params.basis?.value === s.basis ? '<span class="pill ok">current</span>' : '<span class="pill bad">stale</span>'}</td></tr>`; }).join('')}</tbody></table>` : ''}
      </div>`;
    this.bindHead();
    this.querySelector('#combo').onchange = e => { this.combo = e.target.value; this.render(); };
    for (const b of this.querySelectorAll('[data-d]')) b.onclick = () => { this.diagram = b.dataset.d; this.render(); };
    this.querySelector('#gen').onclick = () => this.generateBars();
    this.drawDiagram();
  }
  bindHead() { const sel = this.querySelector('#beam'); if (sel) sel.onchange = e => { this.beamId = e.target.value; this.app.select([e.target.value]); }; }
  drawDiagram() {
    const cv = this.querySelector('#diag'); if (!cv) return; const c = this.state.res.combos[this.combo];
    const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const ys = this.diagram === 'w' ? c.w.map(v => v * 1000) : c[this.diagram]; const unit = { M: 'kN·m', V: 'kN', w: 'mm' }[this.diagram];
    const xs = c.x, L = xs[xs.length - 1]; const ymax = Math.max(1e-9, ...ys.map(Math.abs));
    const pad = 36, X = x => pad + (W - 2 * pad) * x / L, Y = y => H / 2 - (H / 2 - 20) * y / ymax;   // positive up (sagging plotted up)
    g.strokeStyle = '#8899aa'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(L), Y(0)); g.stroke();
    g.fillStyle = 'rgba(31,111,209,0.18)'; g.strokeStyle = '#1f6fd1'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(0), Y(0)); xs.forEach((x, i) => g.lineTo(X(x), Y(ys[i]))); g.lineTo(X(L), Y(0)); g.closePath(); g.fill();
    g.beginPath(); xs.forEach((x, i) => (i ? g.lineTo(X(x), Y(ys[i])) : g.moveTo(X(x), Y(ys[i])))); g.stroke();
    const k = ys.reduce((bi, v, i) => (Math.abs(v) > Math.abs(ys[bi]) ? i : bi), 0);
    g.fillStyle = '#15223a'; g.font = '12px system-ui'; g.fillText(`${ys[k].toFixed(this.diagram === 'w' ? 3 : 2)} ${unit} at x = ${xs[k].toFixed(2)} m`, Math.min(X(xs[k]) + 6, W - 180), Y(ys[k]) + (ys[k] > 0 ? -6 : 14));
    g.fillStyle = '#67788f'; g.fillText(`${{ M: 'Bending moment (sagging up)', V: 'Shear V = dM/dx', w: 'Deflection (up)' }[this.diagram]} · ${this.combo}`, pad, 14); g.fillText('0', 8, Y(0) + 4); g.fillText(`${L.toFixed(2)} m`, W - pad - 20, H - 6);
  }
}
customElements.define('page-structure', PageStructure);
