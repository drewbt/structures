// feasibility.js - development feasibility of a tower model: areas floor by floor from the model, a priced
// cost plan partly from the model's own quantities, a quarterly cash flow with a construction loan, and the
// returns, break-evens and sensitivities a developer decides on. Pure functions of the model and an assumptions
// object; every assumption carries its basis. MARKET NUMBERS ARE ASSUMPTIONS from secondary sources (brokerage
// and trade reporting, 2023-2026), not appraisals or bids. This is a screening model, not investment, legal or
// tax advice.
import { register } from './functions.js';

const SF = 10.7639;   // ft² per m²
const num = (el, k, d) => { const p = el.params[k]; return p === undefined ? d : p.value; };
const polyArea = g => Math.abs(g.reduce((s, q, i) => s + q[0] * g[(i + 1) % g.length][1] - g[(i + 1) % g.length][0] * q[1], 0) / 2);

/** Assumptions with their basis. Edit through the Feasibility page; stored in the model as a `feasibility` element. */
export const FEAS_DEFAULTS = {
  // revenue
  price_base: { v: 4200, unit: '$/sf', basis: 'sellable $/sf on the first tower floor; Billionaires\' Row trades are reported at about $4,000-7,500/sf (brokerage reports 2026, unverified)' },
  price_step: { v: 0.9, unit: '% per floor', basis: 'view premium per floor up the shaft (assumed)' },
  price_podium: { v: 3200, unit: '$/sf', basis: 'podium residences behind the Central Park South frontage (assumed)' },
  price_penthouse: { v: 9000, unit: '$/sf', basis: 'top residences: reported at $5,000 to over $10,000/sf on the corridor (brokerage, unverified)' },
  terrace_value: { v: 30, unit: '% of interior $/sf', basis: 'private terrace valued at a fraction of interior (assumed)' },
  sales_discount: { v: 6, unit: '%', basis: 'negotiation off list; buyers reported haggling (2026 reporting)' },
  // areas
  efficiency: { v: 82, unit: '%', basis: 'sellable / (floor gross less core) on full-floor residences (assumed)' },
  amenity_podium_floors: { v: 2, unit: 'floors', basis: 'lowest podium floors kept for amenities (assumed)' },
  // land and zoning
  land_price: { v: 623, unit: '$M', basis: 'Park Lane Hotel sold to the Qatar Investment Authority in 2023 for about $623M (The Real Deal); today\'s value unverified' },
  land_costs: { v: 3.5, unit: '% of land', basis: 'NYC RPTT 2.625 % + NYS transfer 0.65 % on commercial transfers, plus legal (assumed; the buyer may bear them)' },
  zoning_allowance: { v: 295000, unit: 'zsf', basis: 'reported (2013) that a replacement could be about two-thirds of the 442,000 sf hotel; zoning NOT verified' },
  air_rights_price: { v: 700, unit: '$/sf', basis: 'cost of any floor area above the allowance, if a transfer is available at all (assumed)' },
  demolition: { v: 45, unit: '$M', basis: 'taking down a 46-storey hotel in Midtown (assumed)' },
  // construction, priced partly from the model
  concrete_rate: { v: 1750, unit: '$/m³', basis: 'in-place high-strength concrete with formwork, pumping and 180 kg/m³ rebar at height (assumed)' },
  facade_rate: { v: 2400, unit: '$/m² facade', basis: 'unitised curtain wall with fins (assumed)' },
  damper_rate: { v: 15000, unit: '$/t', basis: 'tuned mass damper supplied and installed (assumed)' },
  other_hard: { v: 720, unit: '$/gsf', basis: 'MEP, vertical transport, luxury interiors, finishes (assumed)' },
  general_conditions: { v: 12, unit: '% of hard', basis: 'construction manager general conditions and fee (assumed)' },
  contingency: { v: 7, unit: '% of hard', basis: 'hard cost contingency (assumed)' },
  // soft
  design_fees: { v: 6, unit: '% of hard', basis: 'architecture, engineering, wind tunnel, consultants (assumed)' },
  legal_permits: { v: 3, unit: '% of hard', basis: 'legal, AG offering plan, permits, insurance (assumed)' },
  developer_fee: { v: 3, unit: '% of cost ex land', basis: 'development management fee (market practice, assumed)' },
  marketing: { v: 3, unit: '% of revenue', basis: 'sales gallery, brochure, advertising (assumed)' },
  commissions: { v: 5, unit: '% of revenue', basis: 'sales brokerage (assumed)' },
  carry_tax: { v: 6, unit: '$M/yr', basis: 'property tax and insurance during development (assumed)' },
  // finance
  ltc: { v: 60, unit: '% of cost', basis: 'construction loan to cost; 65-75 % reported on small NYC condo loans, lower assumed for a supertall' },
  rate: { v: 8.5, unit: '%/yr', basis: 'SOFR (~3.6 %) + 4.5-5 % debt-fund spread (2026 reporting)' },
  loan_fee: { v: 1.25, unit: '%', basis: 'origination (2026 reporting: 1.00-1.25 %)' },
  // time (quarters)
  q_entitle: { v: 6, unit: 'quarters', basis: 'design, zoning, DOB approvals; hotel winds down (assumed)' },
  q_demolish: { v: 4, unit: 'quarters', basis: 'demolition and excavation to rock (assumed)' },
  q_build: { v: 16, unit: 'quarters', basis: 'superstructure, facade, fit-out to TCO for 52 storeys (assumed)' },
  q_sell: { v: 8, unit: 'quarters', basis: 'closings after TCO; the corridor sells slowly (2026 reporting) (assumed)' },
  presold: { v: 35, unit: '% of units', basis: 'contracts signed before TCO under an accepted offering plan (assumed)' },
  // the developer's own position (for the exit comparison)
  overhead: { v: 35, unit: '% of fee', basis: 'developer\'s own staff and office cost against the fee (assumed)' },
  gp_share: { v: 10, unit: '% of equity', basis: 'sponsor co-investment alongside an LP; 5-10 % is market practice (assumed)' },
  promote: { v: 20, unit: '% of profit over hurdle', basis: 'sponsor promote above the LP hurdle (market practice, assumed)' },
  option_fee: { v: 1, unit: '% of land', basis: 'non-refundable fee for an option or contract on the site during entitlement (assumed)' },
  promote_sale: { v: 50, unit: '% of expected value', basis: 'discount a buyer takes to buy a promote before the risk is gone (assumed)' },
  target_irr: { v: 15, unit: '%', basis: 'equity return a supertall condo needs to attract capital (assumed)' },
};

/** Floor data a feasibility needs, read from the model: gross slab, core footprint, the glass line on penthouses. */
export function areaInputs(model) {
  const levels = model.byType('level').sort((a, b) => num(a, 'elevation') - num(b, 'elevation'));
  return levels.map(l => {
    const kids = model.children(l.id), slab = kids.find(k => k.type === 'slab'), kind = num(l, 'kind', l.name.startsWith('Foundation') ? 'mat' : 'cellar');
    const gross = slab && num(slab, 'role', '') !== 'mat' ? (model.result(slab.id)?.area_m2 || 0) : 0;
    const core = kids.filter(k => k.type === 'wall' && num(k, 'pier', '') === 'core'), cx = core.flatMap(w => [num(w, 'start')[0], num(w, 'end')[0]]), cy = core.flatMap(w => [num(w, 'start')[1], num(w, 'end')[1]]);
    const glass = kids.find(k => k.type === 'curtain_wall' && num(k, 'kind', '') === 'lobby');
    return { name: l.name, floor: num(l, 'floor', null), kind, gross_m2: gross, core_m2: core.length ? (Math.max(...cx) - Math.min(...cx)) * (Math.max(...cy) - Math.min(...cy)) : 0, inner_m2: glass ? polyArea(num(glass, 'outline')) : null, z: num(l, 'elevation'), h: num(l, 'height') };
  });
}

/** Areas floor by floor, in square feet. */
export const towerAreas = register({
  name: 'feasibility.areas', version: '1.0.0',
  assumptions: ['gross = slab area', 'sellable = (gross − core) × efficiency; penthouse interiors inside the glass line, terraces between the glass and the slab edge', 'lobby, mechanical, crown, cellars and the lowest podium floors are not sold', 'zoning floor area approximated as gross above grade less mechanical and crown (zoning NOT checked)'],
  inputs: model => ({ levels: areaInputs(model) }),
  run({ levels, efficiency = 0.82, amenityPodium = 2 }) {
    const rows = []; let podiumSeen = 0;
    for (const l of levels) {
      const { kind, gross_m2: gross, core_m2: core } = l; let use = kind, sell = 0, terrace = 0;
      if (kind === 'podium') { podiumSeen++; use = podiumSeen <= amenityPodium ? 'amenity' : 'podium residence'; if (use !== 'amenity') sell = (gross - core) * efficiency; }
      else if (kind === 'typical') { use = 'residence'; sell = (gross - core) * efficiency; }
      else if (kind === 'penthouse') { const inner = l.inner_m2 ?? gross; use = 'penthouse'; sell = (inner - core) * efficiency; terrace = Math.max(0, gross - inner); }
      if (gross > 0 || kind === 'cellar') rows.push({ name: l.name, floor: l.floor, kind, use, gross_sf: gross * SF, core_sf: core * SF, sellable_sf: Math.max(0, sell) * SF, terrace_sf: terrace * SF, z: l.z, h: l.h });
    }
    const sum = k => rows.reduce((s, r) => s + r[k], 0), zfa = rows.filter(r => !['cellar', 'mechanical', 'crown'].includes(r.use)).reduce((s, r) => s + r.gross_sf, 0);
    return { rows, gsf: sum('gross_sf'), sellable_sf: sum('sellable_sf'), terrace_sf: sum('terrace_sf'), zfa_sf: zfa, residence_floors: rows.filter(r => r.sellable_sf > 0).length };
  },
});

/** Quantities the cost plan prices directly from the model: concrete (from the gravity take-off), facade, damper. */
export function modelQuantities(model, concrete_m3) {
  const facade_m2 = model.byType('curtain_wall').reduce((s, c) => s + (model.result(c.id)?.glass_m2 || 0), 0);
  const damper_t = model.byType('damper').reduce((s, d) => s + num(d, 'mass', 0), 0);
  return { concrete_m3, facade_m2, damper_t };
}

const v = (a, k) => (a[k]?.v ?? FEAS_DEFAULTS[k].v);

/** Revenue by floor: price rising with the floor; penthouses and terraces; less the negotiation discount. */
export function revenue(areas, a) {
  const first = Math.min(...areas.rows.filter(r => r.use === 'residence').map(r => r.floor));
  const rows = areas.rows.filter(r => r.sellable_sf > 0).map(r => {
    const psf = r.use === 'penthouse' ? v(a, 'price_penthouse') : r.use === 'podium residence' ? v(a, 'price_podium') : v(a, 'price_base') * (1 + v(a, 'price_step') / 100 * (r.floor - first));
    const gross = r.sellable_sf * psf + r.terrace_sf * psf * v(a, 'terrace_value') / 100;
    return { ...r, psf, list: gross, net: gross * (1 - v(a, 'sales_discount') / 100) };
  });
  return { rows, list: rows.reduce((s, r) => s + r.list, 0), net: rows.reduce((s, r) => s + r.net, 0) };
}

/** The cost plan: land, zoning, demolition, hard costs priced partly from the model, soft costs. $. */
export function costPlan(model, areas, rev, a, { concrete_m3, facade_m2, damper_t }) {
  const M = 1e6, land = v(a, 'land_price') * M, landCosts = land * v(a, 'land_costs') / 100;
  const excess = Math.max(0, areas.zfa_sf - v(a, 'zoning_allowance')), airRights = excess * v(a, 'air_rights_price');
  const structure = concrete_m3 * v(a, 'concrete_rate'), facade = facade_m2 * v(a, 'facade_rate'), damper = damper_t * v(a, 'damper_rate'), other = areas.gsf * v(a, 'other_hard');
  const base = structure + facade + damper + other, gc = base * v(a, 'general_conditions') / 100, cont = (base + gc) * v(a, 'contingency') / 100, hard = base + gc + cont;
  const demolition = v(a, 'demolition') * M, design = hard * v(a, 'design_fees') / 100, legal = hard * v(a, 'legal_permits') / 100;
  const quarters = v(a, 'q_entitle') + v(a, 'q_demolish') + v(a, 'q_build') + v(a, 'q_sell'), carry = v(a, 'carry_tax') * M * quarters / 4;
  const devFee = (hard + demolition + design + legal) * v(a, 'developer_fee') / 100, marketing = rev.net * v(a, 'marketing') / 100, commissions = rev.net * v(a, 'commissions') / 100;
  const lines = [
    { group: 'Land', name: 'Site purchase', amount: land, basis: FEAS_DEFAULTS.land_price.basis },
    { group: 'Land', name: 'Transfer taxes and closing', amount: landCosts, basis: FEAS_DEFAULTS.land_costs.basis },
    { group: 'Land', name: `Floor area above the zoning allowance (${Math.round(excess).toLocaleString()} sf)`, amount: airRights, basis: FEAS_DEFAULTS.zoning_allowance.basis },
    { group: 'Hard', name: 'Demolition and excavation', amount: demolition, basis: FEAS_DEFAULTS.demolition.basis },
    { group: 'Hard', name: `Structure: ${Math.round(concrete_m3).toLocaleString()} m³ concrete from the model`, amount: structure, basis: FEAS_DEFAULTS.concrete_rate.basis },
    { group: 'Hard', name: `Facade: ${Math.round(facade_m2).toLocaleString()} m² from the model`, amount: facade, basis: FEAS_DEFAULTS.facade_rate.basis },
    { group: 'Hard', name: `Tuned mass damper: ${damper_t.toLocaleString()} t`, amount: damper, basis: FEAS_DEFAULTS.damper_rate.basis },
    { group: 'Hard', name: `MEP, lifts, interiors: ${Math.round(areas.gsf).toLocaleString()} gsf`, amount: other, basis: FEAS_DEFAULTS.other_hard.basis },
    { group: 'Hard', name: 'General conditions and CM fee', amount: gc, basis: FEAS_DEFAULTS.general_conditions.basis },
    { group: 'Hard', name: 'Contingency', amount: cont, basis: FEAS_DEFAULTS.contingency.basis },
    { group: 'Soft', name: 'Design, engineering, wind tunnel', amount: design, basis: FEAS_DEFAULTS.design_fees.basis },
    { group: 'Soft', name: 'Legal, offering plan, permits, insurance', amount: legal, basis: FEAS_DEFAULTS.legal_permits.basis },
    { group: 'Soft', name: 'Property tax and insurance while building', amount: carry, basis: FEAS_DEFAULTS.carry_tax.basis },
    { group: 'Soft', name: 'Development fee', amount: devFee, basis: FEAS_DEFAULTS.developer_fee.basis },
    { group: 'Sales', name: 'Marketing', amount: marketing, basis: FEAS_DEFAULTS.marketing.basis },
    { group: 'Sales', name: 'Sales commissions', amount: commissions, basis: FEAS_DEFAULTS.commissions.basis },
  ];
  return { lines, land: land + landCosts + airRights, hard: hard + demolition, soft: design + legal + carry + devFee, sales: marketing + commissions, devFee, total: lines.reduce((s, l) => s + l.amount, 0), excess_sf: excess };
}

/** Quarterly cash flow: equity first, then the loan; interest capitalised; closings repay the loan before equity. */
export function cashFlow(cost, rev, a, interestBudget = null) {
  if (interestBudget === null) { const first = cashFlow(cost, rev, a, 0); return cashFlow(cost, rev, a, first.interest + first.loan_fee); }   // equity sized on cost including financing, as lenders do
  const qE = v(a, 'q_entitle'), qD = v(a, 'q_demolish'), qB = v(a, 'q_build'), qS = v(a, 'q_sell'), N = qE + qD + qB + qS + 1, r = v(a, 'rate') / 100 / 4;
  const out = Array(N).fill(0), inc = Array(N).fill(0);
  const spread = (amount, q0, n, shape = 's') => { for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, w = shape === 's' ? (t1 * t1 * (3 - 2 * t1)) - (t0 * t0 * (3 - 2 * t0)) : 1 / n; out[q0 + i] += amount * w; } };
  const L = n => cost.lines.filter(l => l.name.startsWith(n)).reduce((s, l) => s + l.amount, 0);
  out[0] += cost.land;                                                          // land at the start
  spread(L('Design') + L('Legal'), 0, qE + qD + qB, 'flat');
  spread(L('Property tax'), 0, N - 1, 'flat');
  spread(L('Demolition'), qE, qD, 'flat');
  const hardBuild = cost.hard - L('Demolition'); spread(hardBuild, qE + qD, qB, 's');
  spread(L('Development fee'), qE, qD + qB, 'flat');
  spread(L('Marketing'), qE + qD, qB + qS, 'flat');
  // closings: pre-sold units close at TCO; the rest across the sell-out; commissions paid with closings
  const tco = qE + qD + qB, pre = v(a, 'presold') / 100;
  inc[tco] += rev.net * pre; for (let i = 1; i <= qS; i++) inc[tco + i] += rev.net * (1 - pre) / qS;
  for (let i = 0; i < N; i++) out[i] += inc[i] * v(a, 'commissions') / 100;
  // finance: equity funds costs until it reaches (1 − LTC) of total cost; then the loan; interest capitalised
  const allIn = cost.total + interestBudget, loanCap = allIn * v(a, 'ltc') / 100, equityCap = allIn - loanCap; let eq = 0, loan = 0, fee = 0, interest = 0; const rows = [];
  for (let i = 0; i < N; i++) {
    let need = out[i], e = 0, d = 0;
    const int = loan * r; interest += int; loan += int;
    if (eq < equityCap) { e = Math.min(need, equityCap - eq); eq += e; need -= e; }
    if (need > 0) { if (loan === 0 && need > 0) { fee = loanCap * v(a, 'loan_fee') / 100; need += fee; } d = need; loan += d; need = 0; }
    let cash = inc[i], repay = Math.min(loan, cash); loan -= repay; cash -= repay;
    rows.push({ q: i, cost: out[i], income: inc[i], equity_in: e, loan_draw: d, interest: int, loan, repay, to_equity: cash });
  }
  const eqFlows = rows.map(x => x.to_equity - x.equity_in);
  return { rows, equity: eq, peak_loan: Math.max(...rows.map(x => x.loan)), interest, loan_fee: fee, profit: eqFlows.reduce((s, x) => s + x, 0), loan_commitment: loanCap, irr: irr(eqFlows, 4), multiple: eq > 0 ? rows.reduce((s, x) => s + x.to_equity, 0) / eq : null, quarters: N, tco };
}

/** Internal rate of return of periodic flows, annualised over `perYear` periods (bisection; null if none). */
export function irr(flows, perYear = 1) {
  const npv = r => flows.reduce((s, f, i) => s + f / (1 + r) ** i, 0);
  let lo = -0.99, hi = 1.0; if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (npv(lo) * npv(m) <= 0) hi = m; else lo = m; }
  return (1 + (lo + hi) / 2) ** perYear - 1;
}

/** The whole appraisal for an assumption set. */
export function appraise(model, a, q) {
  const areas = towerAreas.run({ levels: q.levels ?? areaInputs(model), efficiency: v(a, 'efficiency') / 100, amenityPodium: v(a, 'amenity_podium_floors') });
  const rev = revenue(areas, a), cost = costPlan(model, areas, rev, a, q), cf = cashFlow(cost, rev, a);
  const profit = rev.net - cost.total - cf.interest - cf.loan_fee;
  return { areas, rev, cost, cf, profit, margin_on_cost: profit / (cost.total + cf.interest + cf.loan_fee), margin_on_gdv: profit / rev.net };
}

/** The land price ($M) at which the scheme meets the test: equity IRR at the target (`irr`) or zero profit (`profit`).
 *  Returns a number, or { below: 0 } when even free land fails, or { above: 3000 } when beyond the search range. */
export function residualLand(model, a, q, test = 'irr') {
  const f = L => { const r = appraise(model, { ...a, land_price: { v: L } }, q); return test === 'irr' ? (r.cf.irr ?? -1) - v(a, 'target_irr') / 100 : r.profit; };
  let lo = 0, hi = 3000; if (f(lo) < 0) return { below: 0, profit_at_free_land: appraise(model, { ...a, land_price: { v: 0 } }, q).profit }; if (f(hi) >= 0) return { above: hi };
  for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (f(m) >= 0) lo = m; else hi = m; }
  return lo;
}

const scalePrices = (a, k) => ({ ...a, price_base: { v: v(a, 'price_base') * k }, price_podium: { v: v(a, 'price_podium') * k }, price_penthouse: { v: v(a, 'price_penthouse') * k } });

/** The factor on every sale price at which the scheme meets the test (`irr` target or zero `profit`), and the resulting average $/sf. */
export function breakevenPrice(model, a, q, test = 'irr') {
  const f = k => { const r = appraise(model, scalePrices(a, k), q); return test === 'irr' ? (r.cf.irr ?? -1) - v(a, 'target_irr') / 100 : r.profit; };
  let lo = 0.3, hi = 5; if (f(hi) < 0) return null; if (f(lo) >= 0) return { factor: lo };
  for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (f(m) >= 0) hi = m; else lo = m; }
  const r = appraise(model, scalePrices(a, hi), q);
  return { factor: hi, price_base: v(a, 'price_base') * hi, avg_psf: r.rev.net / r.areas.sellable_sf };
}

/** Profit across sale-price and hard-cost changes. */
export function sensitivity(model, a, q, dp = [-15, -7.5, 0, 7.5, 15], dc = [-10, 0, 10, 20]) {
  return dc.map(c => ({ cost: c, cells: dp.map(p => {
    const k = 1 + p / 100, h = 1 + c / 100;
    const b = { ...scalePrices(a, k), other_hard: { v: v(a, 'other_hard') * h }, concrete_rate: { v: v(a, 'concrete_rate') * h }, facade_rate: { v: v(a, 'facade_rate') * h } };
    const r = appraise(model, b, q); return { price: p, profit: r.profit, irr: r.cf.irr };
  }) }));
}

/** The process from design to the last key, quarter by quarter: who is paid at each stage, from the appraisal. $. */
export function processStages(r, a) {
  const L = n => r.cost.lines.filter(l => l.name.startsWith(n)).reduce((s, l) => s + l.amount, 0), qE = v(a, 'q_entitle'), qD = v(a, 'q_demolish'), qB = v(a, 'q_build'), qS = v(a, 'q_sell');
  const hardBuild = r.cost.hard - L('Demolition'), gc = L('General conditions'), price = r.rev.net, buyerTax = price * 0.0315;
  return [
    { stage: 'Site control', from: 0, to: 1, who: [['Landowner (seller)', L('Site purchase')], ['City and State transfer taxes, title, lawyers', L('Transfer taxes')]], note: 'A contract or option first; buying outright puts the whole land price at risk from day one.' },
    { stage: 'Design and entitlement', from: 0, to: qE, who: [['Architects, engineers, wind tunnel, consultants', L('Design') * 0.45], ['Lawyers, zoning, offering plan filing', L('Legal') * 0.5], ['Developer fee (start)', L('Development fee') * 0.15]], note: 'Zoning, DOB approvals, the offering plan filed with the NY Attorney General. No sales are allowed until the AG accepts the plan.' },
    { stage: 'Financing', from: qE - 1, to: qE + 1, who: [['Construction lender: fees', r.cf.loan_fee], ['Lender: interest over the project', r.cf.interest], ['Equity partners (LP), at risk until sell-out', r.cf.equity]], note: 'Loan closing is the point where the developer can sell its promote or take fees out.' },
    { stage: 'Demolition and excavation', from: qE, to: qE + qD, who: [['Demolition contractor', L('Demolition')]], note: 'The hotel comes down; excavation to rock.' },
    { stage: 'Construction', from: qE + qD, to: qE + qD + qB, who: [['Construction manager: general conditions and fee', gc], ['Trades: concrete, facade, damper, MEP, interiors', hardBuild - gc], ['Developer fee (main)', L('Development fee') * 0.85], ['Design team (construction administration)', L('Design') * 0.55]], note: 'Pre-sales under the accepted plan: deposits held in escrow until closing (Part 20 rules).' },
    { stage: 'Marketing and pre-sales', from: qE + qD, to: qE + qD + qB + qS, who: [['Marketing agency, sales gallery, brochure, renders', L('Marketing')], ['Sales brokers', L('Sales commissions')]], note: 'Starts once the plan is accepted.' },
    { stage: 'TCO and closings', from: qE + qD + qB, to: qE + qD + qB + qS, who: [['Lender repaid first', r.cf.peak_loan], ['Buyers pay transfer and mansion taxes (about 3 % passed through)', buyerTax], ['Equity, then the developer\'s promote', Math.max(0, r.profit)]], note: 'Closings follow the temporary certificate of occupancy; the loan is repaid from the first closings.' },
    { stage: 'Last key and handover', from: qE + qD + qB + qS - 1, to: qE + qD + qB + qS, who: [['Condominium board takes over the building', 0], ['Sponsor holds unsold units and warranty obligations', 0]], note: 'The sponsor stays liable for construction defects; the board usually sues over defects years later. Any unsold units stay on the balance sheet.' },
  ];
}

/** The developer's exit routes, compared: own capital at risk, pre-tax net to the developer, years to exit. */
export function exitOptions(model, r, a, q) {
  const qE = v(a, 'q_entitle'), qD = v(a, 'q_demolish'), qB = v(a, 'q_build'), N = r.cf.quarters, years = x => x / 4;
  const land = v(a, 'land_price') * 1e6, devFee = r.cost.devFee, oh = v(a, 'overhead') / 100, hurdle = r.cf.equity * ((1 + v(a, 'target_irr') / 100) ** years(N) - 1);
  const over = Math.max(0, r.profit - hurdle), promote = over * v(a, 'promote') / 100, rl = residualLand(model, a, q), rlv = typeof rl === 'number' ? rl * 1e6 : 0;
  const preEntitle = r.cost.lines.filter(l => l.name.startsWith('Design')).reduce((s, l) => s + l.amount, 0) * 0.3 + r.cost.lines.filter(l => l.name.startsWith('Legal')).reduce((s, l) => s + l.amount, 0) * 0.4;
  const optionFee = land * v(a, 'option_fee') / 100, flipGain = Math.max(0, rlv - land);
  const gp = v(a, 'gp_share') / 100, gpCap = r.cf.equity * gp;
  return [
    { route: 'Entitle and sell the package', exit_q: qE, capital: optionFee + preEntitle, net: flipGain - optionFee - preEntitle, works: flipGain > optionFee + preEntitle,
      how: 'Option the site, design and entitle it, then sell the contract and the approved design to a developer who pays more than the option price.', tax: 'Capital gain if held as an investment for more than a year; a pattern of flips risks dealer (ordinary income) treatment.',
      note: rlv > 0 ? `Value created only if the entitled site is worth more than the price: residual land at the target return is $${(rlv / 1e6).toFixed(0)}M against $${(land / 1e6).toFixed(0)}M.` : 'The scheme as modelled does not support any land value at the target return, so nothing is gained by flipping it.' },
    { route: 'Fee developer for the landowner', exit_q: qE + qD + qB, capital: 0, net: devFee * (1 - oh), works: true,
      how: 'The landowner keeps the land and funds the equity; you design, entitle, build and sell for a fee (and a promote if the owner agrees).', tax: 'Ordinary income (fees), paid as earned.',
      note: 'No capital at risk, paid quarterly through construction. The promote is worth nothing unless the scheme clears the hurdle.' },
    { route: 'Sponsor with promote, sell the promote at loan closing', exit_q: qE + 1, capital: gpCap, net: promote * (1 - v(a, 'promote_sale') / 100) + devFee * 0.15 * (1 - oh), works: promote > 0,
      how: 'Raise LP equity, co-invest, close the loan, then sell your promote (and the co-investment at cost) to a partner.', tax: 'Carried interest: long-term capital gain if the interest has been held 3 years or more (IRC 1061); otherwise short-term.',
      note: promote > 0 ? 'Early exit, at a discount for the risk the buyer takes on.' : 'There is no promote to sell: the projected profit does not clear the hurdle.' },
    { route: 'Sponsor with promote, through to the last closing', exit_q: N - 1, capital: gpCap, net: r.profit * gp + promote + devFee * (1 - oh), works: r.profit > 0,
      how: 'Co-invest, earn the fee and the promote, stay until the last unit closes.', tax: 'Fee as ordinary income; profit share and promote as capital gain or ordinary income depending on dealer status.',
      note: 'Highest upside, longest exposure: completion, market and defect risk.' },
    { route: 'Owner-developer (buy the land, fund the equity)', exit_q: N - 1, capital: r.cf.equity, net: r.profit + devFee * (1 - oh), works: r.profit > 0,
      how: 'Buy the site at the asking price and take all the equity risk.', tax: 'Condo sales by a developer are usually ordinary income (dealer property).',
      note: `${r.profit >= 0 ? 'Profit' : 'Loss'} of $${Math.abs(r.profit / 1e6).toFixed(0)}M on $${(r.cf.equity / 1e6).toFixed(0)}M of equity.` },
  ].map(x => ({ ...x, years: years(x.exit_q), per_year: x.net / Math.max(0.25, years(x.exit_q)) }));
}
