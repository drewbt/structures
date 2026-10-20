// feasibility.js - <page-feasibility> (PAGE 03): the development appraisal of the model on screen. Areas floor by
// floor and the priced quantities come from the model (core/feasibility.js); the market assumptions are editable
// here and kept in the model as one `feasibility` element, so they save, undo and travel with the project.
// Every assumption shows its basis. A screening appraisal, not an offering, valuation or advice.
import { FEAS_DEFAULTS, areaInputs, modelQuantities, appraise, residualLand, breakevenPrice, sensitivity, processStages, exitOptions } from '../core/feasibility.js';
import { gravityInputs } from '../core/tower.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $M = x => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${x < 0 ? '−' : ''}$${Math.abs(x / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}M`);
const pct = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)} %`);
const n0 = x => Math.round(x).toLocaleString();
const GROUPS = [
  ['Revenue', ['price_base', 'price_step', 'price_podium', 'price_penthouse', 'terrace_value', 'sales_discount', 'efficiency', 'amenity_podium_floors']],
  ['Land and zoning', ['land_price', 'land_costs', 'zoning_allowance', 'air_rights_price', 'demolition']],
  ['Construction', ['concrete_rate', 'facade_rate', 'damper_rate', 'other_hard', 'general_conditions', 'contingency']],
  ['Soft and sales', ['design_fees', 'legal_permits', 'developer_fee', 'marketing', 'commissions', 'carry_tax']],
  ['Finance and time', ['ltc', 'rate', 'loan_fee', 'q_entitle', 'q_demolish', 'q_build', 'q_sell', 'presold', 'target_irr']],
  ['Your position', ['overhead', 'gp_share', 'promote', 'option_fee', 'promote_sale']],
];

export class PageFeasibility extends HTMLElement {
  connectedCallback() {
    this.app = this.closest('coral-app'); this.classList.add('page-scroll', 'feas');
    this.onChange = () => { this.cache = null; this.render(); };
    this.app.addEventListener('regenerate', this.onChange);
    globalThis.coralFeasibility = this;
    this.render();
  }
  disconnectedCallback() { this.app.removeEventListener('regenerate', this.onChange); }
  get model() { return this.app.model; }
  get element() { return this.model.byType('feasibility')[0] || null; }
  get assumptions() { const o = this.element?.params.overrides?.value || {}; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v }])); }
  value(k) { return this.assumptions[k]?.v ?? FEAS_DEFAULTS[k].v; }
  setAssumption(k, val) {
    const m = this.model, o = { ...(this.element?.params.overrides?.value || {}) };
    if (val === null || val === FEAS_DEFAULTS[k].v) delete o[k]; else o[k] = val;
    if (!this.element) m.create({ type: 'feasibility', name: 'Feasibility assumptions', params: { overrides: { value: o, unit: '' } }, provenance: { source: 'user', method: 'stated', note: 'market and cost assumptions for the appraisal; defaults and their basis in core/feasibility.js' } });
    else m.set(this.element.id, 'overrides', o, '');
    this.app.status.saved = false; this.cache = null; this.render();
  }

  /** The appraisal, its break-evens, sensitivity, stages and exits: recomputed when the model or an assumption changes. */
  compute() {
    if (this.cache) return this.cache;
    const m = this.model, gi = gravityInputs(m), levels = areaInputs(m);
    if (!gi || !levels.some(l => l.kind === 'typical')) return (this.cache = { none: true });
    const q = { ...modelQuantities(m, gi.concrete_m3), levels }, a = this.assumptions, r = appraise(m, a, q);
    this.cache = {
      q, a, r,
      rlIrr: residualLand(m, a, q, 'irr'), rlZero: residualLand(m, a, q, 'profit'),
      beIrr: breakevenPrice(m, a, q, 'irr'), beZero: breakevenPrice(m, a, q, 'profit'),
      sens: sensitivity(m, a, q), stages: processStages(r, a), exits: exitOptions(m, r, a, q),
    };
    return this.cache;
  }

  render() {
    if (!this.model.elements.size) { this.innerHTML = '<p class="dim">Loading the model…</p>'; return; }
    const c = this.compute();
    if (c.none) { this.innerHTML = `<h2>Feasibility</h2><p class="dim">The appraisal reads floors by kind (residential, penthouse, podium) from a tower model. Open <b>park-lane</b> or <b>needle-tower</b> from the project list.</p>`; return; }
    const { r, q } = c, landLbl = x => typeof x === 'number' ? $M(x * 1e6) : x?.below === 0 ? 'below zero' : x?.above ? `above ${$M(x.above * 1e6)}` : '—';
    const verdict = r.profit >= 0 ? (r.cf.irr >= this.value('target_irr') / 100 ? 'ok' : 'warn') : 'bad';
    this.innerHTML = `
      <div class="feas-banner"><b>Screening appraisal of a design study.</b> Areas and the priced quantities come from the model; every market number is an assumption from secondary reporting (marked with its basis) and none is an appraisal, bid or quote. Not an offering, not investment, legal or tax advice. Sales of New York condominiums need an offering plan accepted by the Attorney General first.</div>
      <h2>Feasibility · ${esc(this.app.project)}</h2>
      <div class="kpis">
        ${this.kpi('Sales (net)', $M(r.rev.net), `${n0(r.areas.sellable_sf)} sf sellable · avg $${n0(r.rev.net / r.areas.sellable_sf)}/sf`)}
        ${this.kpi('Total cost', $M(r.cost.total + r.cf.interest + r.cf.loan_fee), `land ${$M(r.cost.land)} · finance ${$M(r.cf.interest + r.cf.loan_fee)}`)}
        ${this.kpi('Profit', $M(r.profit), `${pct(r.margin_on_cost)} on cost`, verdict)}
        ${this.kpi('Equity IRR', r.cf.irr === null ? 'none' : pct(r.cf.irr), `target ${this.value('target_irr')} % · equity ${$M(r.cf.equity)}`, verdict)}
        ${this.kpi('Land that works', landLbl(c.rlIrr), `at the target return · zero profit at ${landLbl(c.rlZero)} · asking ${$M(this.value('land_price') * 1e6)}`)}
        ${this.kpi('Prices that work', c.beIrr ? `×${c.beIrr.factor.toFixed(2)}` : '> ×5', c.beIrr ? `avg $${n0(c.beIrr.avg_psf)}/sf for the target; $${n0(c.beZero?.avg_psf ?? NaN)}/sf for zero profit` : '')}
      </div>
      <section class="card"><h3>What the numbers say</h3>${this.reading(c)}</section>
      <section class="card"><h3>From design to the last key: who is paid, when</h3>${this.gantt(c)}</section>
      <section class="card"><h3>Your exits compared</h3>${this.exitTable(c)}</section>
      <section class="card"><h3>Cash flow by quarter</h3>${this.cashChart(c)}</section>
      <div class="feas-2col">
        <section class="card"><h3>Cost plan</h3>${this.costTable(c)}</section>
        <section class="card"><h3>Profit sensitivity</h3>${this.sensTable(c)}<p class="dim small">Rows: hard cost change. Columns: change in every sale price. Equity IRR in brackets.</p></section>
      </div>
      <section class="card"><h3>Areas from the model, floor by floor</h3>${this.areaTable(c)}</section>
      <section class="card"><h3>Assumptions</h3><p class="dim small">Edits are kept in the model (one <code>feasibility</code> element), saved with the project and undoable. Clear a field to return to the default.</p>${this.assumptionForm()}</section>`;
    this.querySelectorAll('input[data-k]').forEach(inp => { inp.onchange = () => { const s = inp.value.trim(); this.setAssumption(inp.dataset.k, s === '' ? null : Number(s)); }; });
  }

  kpi(label, value, sub, cls = '') { return `<div class="kpi ${cls}"><div class="kl">${esc(label)}</div><div class="kv">${value}</div><div class="ks">${esc(sub)}</div></div>`; }

  reading(c) {
    const { r } = c, land = this.value('land_price'), gsf = r.areas.gsf, eff = r.areas.sellable_sf / gsf, fee = c.exits.find(x => x.route.startsWith('Fee'));
    const best = c.exits.filter(x => x.works && x.net > 0).sort((a, b) => b.per_year - a.per_year)[0];
    const lines = [];
    lines.push(r.profit < 0
      ? `At the $${land}M land price the study <b>loses ${$M(-r.profit)}</b>. The land alone is ${$M(r.cost.land)}, ${pct(r.cost.land / r.rev.net, 0)} of everything the apartments would sell for; Billionaires' Row schemes usually need land under about a quarter of sales.`
      : `At the $${land}M land price the study makes ${$M(r.profit)} (${pct(r.margin_on_cost)} on cost), ${r.cf.irr >= this.value('target_irr') / 100 ? 'meeting' : 'short of'} the ${this.value('target_irr')} % target.`);
    lines.push(`The slender form sells ${pct(eff, 0)} of its gross area (${n0(r.areas.sellable_sf)} of ${n0(gsf)} sf): small plates, a large core and tube, plant floors and a crown. That is the price of comfort at this slenderness; a wider base or bought air rights add saleable area faster than cost.`);
    lines.push(`To meet the target, either the land comes in at ${typeof c.rlIrr === 'number' ? $M(c.rlIrr * 1e6) : 'nothing (even free land falls short)'} or every price rises ${c.beIrr ? `${((c.beIrr.factor - 1) * 100).toFixed(0)} % (average $${n0(c.beIrr.avg_psf)}/sf)` : 'beyond five times'}.`);
    lines.push(best ? `Quickest clean money: <b>${esc(best.route.toLowerCase())}</b>, about ${$M(best.net)} pre-tax over ${best.years} years with ${$M(best.capital)} of your capital${best === fee ? ': the landowner carries the land and the market risk' : ''}.` : 'No route makes money for you on these assumptions.');
    return `<ul class="reading">${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
  }

  gantt(c) {
    const N = c.r.cf.quarters, W = 100 / N;
    const years = Array.from({ length: Math.ceil(N / 4) }, (_, y) => `<span style="left:${y * 4 * W}%">Y${y + 1}</span>`).join('');
    return `<div class="gantt"><div class="g-axis">${years}</div>${c.stages.map(s => `
      <div class="g-row"><div class="g-name">${esc(s.stage)}</div><div class="g-track"><div class="g-bar" style="left:${s.from * W}%;width:${Math.max(W, (s.to - s.from) * W)}%"></div></div>
        <div class="g-who">${s.who.filter(w => w[1] > 0 || s.stage.startsWith('Last')).map(([w, amt]) => `<span>${esc(w)}${amt > 0 ? ` <b>${$M(amt)}</b>` : ''}</span>`).join('')}<em>${esc(s.note)}</em></div></div>`).join('')}</div>`;
  }

  exitTable(c) {
    return `<table class="exits"><thead><tr><th>Route</th><th>Your capital</th><th>Net to you, pre-tax</th><th>Out after</th><th>Per year</th><th>Tax character</th></tr></thead><tbody>${c.exits.map(x => `
      <tr class="${x.works && x.net > 0 ? '' : 'dimrow'}"><td><b>${esc(x.route)}</b><div class="small">${esc(x.how)}</div><div class="small dim">${esc(x.note)}</div></td><td>${$M(x.capital)}</td><td class="${x.net >= 0 ? 'okc' : 'badc'}">${$M(x.net)}</td><td>${x.years} yr</td><td>${$M(x.per_year)}</td><td class="small">${esc(x.tax)}</td></tr>`).join('')}</tbody></table>
      <p class="dim small">Pre-tax and before your financing costs. Tax character depends on your facts and the structure; take advice from a tax attorney before choosing a route.</p>`;
  }

  cashChart(c) {
    const rows = c.r.cf.rows, W = 760, H = 220, pad = 34, n = rows.length, bw = (W - pad * 2) / n;
    const maxV = Math.max(...rows.map(x => Math.max(x.cost, x.income)), 1), maxL = Math.max(...rows.map(x => x.loan), 1), top = Math.max(maxV, maxL);
    const y = v => H / 2 - v / top * (H / 2 - 12);
    const bars = rows.map((x, i) => `<rect class="c-in" x="${pad + i * bw + 1}" y="${y(x.income)}" width="${bw - 2}" height="${H / 2 - y(x.income)}"><title>Q${i + 1} income ${$M(x.income)}</title></rect><rect class="c-out" x="${pad + i * bw + 1}" y="${H / 2}" width="${bw - 2}" height="${H / 2 - y(x.cost)}"><title>Q${i + 1} cost ${$M(x.cost)}</title></rect>`).join('');
    const loan = rows.map((x, i) => `${i ? 'L' : 'M'}${(pad + (i + 0.5) * bw).toFixed(1)},${y(x.loan).toFixed(1)}`).join('');
    return `<svg class="cash" viewBox="0 0 ${W} ${H}" role="img" aria-label="Quarterly costs, sales income and the loan balance">
      <line class="axis" x1="${pad}" x2="${W - pad}" y1="${H / 2}" y2="${H / 2}"/>${bars}<path class="c-loan" d="${loan}"/>
      <text x="${pad}" y="12" class="lbl">${$M(top)}</text></svg>
      <div class="cash-legend small"><span class="sw in"></span>sales closing <span class="sw out"></span>costs <span class="sw loan"></span>loan balance (peak ${$M(c.r.cf.peak_loan)}, interest ${$M(c.r.cf.interest)})</div>`;
  }

  costTable(c) {
    const { r } = c;
    return `<table><tbody>${r.cost.lines.map(l => `<tr><td>${esc(l.name)}<div class="small dim">${esc(l.basis)}</div></td><td class="num">${$M(l.amount)}</td></tr>`).join('')}
      <tr><td>Loan fee and interest (from the cash flow)</td><td class="num">${$M(r.cf.interest + r.cf.loan_fee)}</td></tr>
      <tr class="tot"><td>Total</td><td class="num">${$M(r.cost.total + r.cf.interest + r.cf.loan_fee)}</td></tr></tbody></table>`;
  }

  sensTable(c) {
    return `<table class="sens"><thead><tr><th>cost \\ price</th>${c.sens[0].cells.map(x => `<th>${x.price > 0 ? '+' : ''}${x.price} %</th>`).join('')}</tr></thead><tbody>${c.sens.map(row => `<tr><th>${row.cost > 0 ? '+' : ''}${row.cost} %</th>${row.cells.map(x => `<td class="${x.profit >= 0 ? 'okc' : 'badc'}">${$M(x.profit)}<div class="small dim">${x.irr === null ? '' : pct(x.irr, 0)}</div></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  areaTable(c) {
    const rev = new Map(c.r.rev.rows.map(x => [x.name, x]));
    return `<details><summary>${c.r.areas.rows.length} floors · ${n0(c.r.areas.gsf)} gsf · ${n0(c.r.areas.sellable_sf)} sf sellable · ${n0(c.r.areas.terrace_sf)} sf terraces · zoning floor area about ${n0(c.r.areas.zfa_sf)} sf against an allowance of ${n0(this.value('zoning_allowance'))} (unverified)</summary>
      <table><thead><tr><th>Floor</th><th>Use</th><th class="num">Gross sf</th><th class="num">Sellable sf</th><th class="num">Terrace sf</th><th class="num">$/sf</th><th class="num">Net sales</th></tr></thead><tbody>${[...c.r.areas.rows].reverse().map(x => { const v = rev.get(x.name); return `<tr><td>${esc(x.name)}</td><td>${esc(x.use)}</td><td class="num">${n0(x.gross_sf)}</td><td class="num">${n0(x.sellable_sf)}</td><td class="num">${x.terrace_sf ? n0(x.terrace_sf) : ''}</td><td class="num">${v ? n0(v.psf) : ''}</td><td class="num">${v ? $M(v.net) : ''}</td></tr>`; }).join('')}</tbody></table></details>`;
  }

  assumptionForm() {
    const a = this.assumptions;
    return GROUPS.map(([g, keys]) => `<details ${g === 'Revenue' || g === 'Land and zoning' ? 'open' : ''}><summary>${g}</summary><div class="assume">${keys.map(k => { const d = FEAS_DEFAULTS[k], set = a[k] !== undefined; return `
      <label title="${esc(d.basis)}"><span>${esc(k.replace(/_/g, ' '))}</span><input data-k="${k}" type="number" step="any" value="${set ? a[k].v : ''}" placeholder="${d.v}" class="${set ? 'set' : ''}"><em>${esc(d.unit)}</em><small>${esc(d.basis)}</small></label>`; }).join('')}</div></details>`).join('');
  }
}
customElements.define('page-feasibility', PageFeasibility);
