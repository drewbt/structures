// screening.js - market screening: the same appraisal (core/feasibility.js) run on a parametric building of a
// stated type in a stated market, before any site or model exists. The building is a stack of floors (lobby,
// residences, penthouses); hard cost is the market's all-in $/gsf before general conditions and contingency. The
// answer that matters is the land the product can afford ($/buildable sf, $/unit) set against what land costs in
// that market. Market numbers are reported figures from secondary sources, each with its basis; nothing here is an
// appraisal or advice.
import { appraise, residualLand, breakevenPrice, FEAS_DEFAULTS } from './feasibility.js';

const SF = 10.7639;

/** Building types. plate_sf gross per floor; core_sf; unit_sf the average residence (for $/unit). */
export const PRODUCTS = {
  'resort-lowrise': { label: 'Resort low-rise (5 storeys, concrete block and slab)', floors: 5, plate_sf: 16000, core_sf: 1400, unit_sf: 2600, penthouses: 1, storey_m: 3.6, ground_units: true },
  'midrise': { label: 'Luxury mid-rise (12 storeys, concrete)', floors: 12, plate_sf: 14000, core_sf: 1500, unit_sf: 2200, penthouses: 1, storey_m: 3.5 },
  'tower': { label: 'Luxury tower (30 storeys, concrete)', floors: 30, plate_sf: 11500, core_sf: 1700, unit_sf: 2000, penthouses: 2, storey_m: 3.5 },
};

/** The floor stack a product implies, in the form feasibility.areaInputs gives. */
export function productLevels(p) {
  const m2 = sf => sf / SF, rows = [{ name: p.ground_units ? 'L1' : 'L1 Lobby', floor: 1, kind: p.ground_units ? 'typical' : 'lobby', gross_m2: m2(p.plate_sf), core_m2: m2(p.core_sf), inner_m2: null, z: 0, h: 5 }];
  for (let k = 2; k <= p.floors; k++) {
    const ph = k > p.floors - p.penthouses;
    rows.push({ name: `L${k}${ph ? ' Penthouse' : ''}`, floor: k, kind: ph ? 'penthouse' : 'typical', gross_m2: m2(p.plate_sf), core_m2: m2(p.core_sf), inner_m2: ph ? m2(p.plate_sf * 0.85) : null, z: 5 + (k - 2) * p.storey_m, h: p.storey_m });
  }
  return rows;
}

/** Appraise a product in a market. market.a overrides FEAS_DEFAULTS keys; market.land_psf is land per buildable sf. */
export function screen(product, market) {
  const p = typeof product === 'string' ? PRODUCTS[product] : product, levels = productLevels(p);
  const q = { concrete_m3: 0, facade_m2: 0, damper_t: 0, levels };   // all hard cost sits in other_hard ($/gsf) for screening
  const zfa = p.plate_sf * p.floors;
  const base = { amenity_podium_floors: { v: 0 }, price_step: { v: p.floors > 15 ? 0.6 : 0.3 }, ...Object.fromEntries(Object.entries(market.a).map(([k, v]) => [k, { v }])) };
  const a = { ...base, land_price: { v: (market.land_psf ?? 0) * zfa / 1e6 }, zoning_allowance: { v: zfa } };
  const r = appraise(null, a, q);
  const rlIrr = residualLand(null, a, q, 'irr'), rlZero = residualLand(null, a, q, 'profit'), be = breakevenPrice(null, a, q, 'irr');
  const units = r.areas.sellable_sf / p.unit_sf, num = x => (typeof x === 'number' ? x : null);
  return {
    product: p.label, market: market.name, units: Math.round(units), gsf: r.areas.gsf, sellable_sf: r.areas.sellable_sf, gdv: r.rev.net, cost: r.cost.total + r.cf.interest + r.cf.loan_fee,
    profit: r.profit, margin: r.margin_on_cost, irr: r.cf.irr, equity: r.cf.equity, years: r.cf.quarters / 4,
    land_paid_psf: market.land_psf ?? null,
    afford_psf_irr: num(rlIrr) !== null ? rlIrr * 1e6 / zfa : null, afford_psf_zero: num(rlZero) !== null ? rlZero * 1e6 / zfa : null,
    afford_unit_irr: num(rlIrr) !== null ? rlIrr * 1e6 / units : null,
    price_factor_irr: be?.factor ?? null,
  };
}

export { FEAS_DEFAULTS };

// ---- the search: sites × scales × building types in each market -------------------------------------------

/** Construction type by height, with its cost factor on the market's concrete mid-rise $/gsf (basis: cost-guide
 *  spreads between wood podium, concrete mid-rise and high-rise residential; assumed). */
export function constructionType(floors) {
  if (floors <= 5) return { type: 'wood or block over slab', factor: 0.72, storey_m: 3.3 };
  if (floors <= 7) return { type: 'wood over concrete podium', factor: 0.80, storey_m: 3.3 };
  if (floors <= 14) return { type: 'concrete mid-rise', factor: 1.00, storey_m: 3.4 };
  if (floors <= 40) return { type: 'concrete high-rise', factor: 1.12 + 0.004 * (floors - 15), storey_m: 3.5 };
  return { type: 'supertall', factor: 1.30 + 0.008 * (floors - 40), storey_m: 3.6 };
}

/** A parametric building: floors and plate; the core grows with height (lifts, stairs, risers). */
export function makeProduct({ floors, plate_sf, unit_sf = 2000 }) {
  const ct = constructionType(floors), core_sf = Math.max(500, plate_sf * (floors <= 7 ? 0.07 : floors <= 14 ? 0.10 : floors <= 40 ? 0.13 : 0.17));
  return { label: `${floors} storeys × ${Math.round(plate_sf).toLocaleString()} sf plate (${ct.type})`, floors, plate_sf, core_sf, unit_sf, penthouses: floors >= 8 ? 1 : 0, storey_m: ct.storey_m, ground_units: floors <= 7, ct };
}

/**
 * One option: a product on a site in a market. market: { name, price_psf, top_premium, hard_psf (concrete mid-rise,
 * before GC and contingency), land_per_acre, max_floors, max_far, coverage, absorption_units_q, parking_per_unit,
 * entitle_q, a: other overrides }. site: { acres }. Returns null if the product breaks the site's limits.
 */
export function option(market, site, prod) {
  const lot_sf = site.acres * 43560, gsf = prod.plate_sf * prod.floors;
  if (prod.floors > market.max_floors || gsf > market.max_far * lot_sf || prod.plate_sf > market.coverage * lot_sf) return null;
  const units = Math.max(1, Math.round(gsf * 0.75 / prod.unit_sf)), sellQ = Math.max(2, Math.ceil(units * (1 - 0.4) / market.absorption_units_q));
  const parking = units * (market.parking_per_unit ?? 0) / gsf, landCost = site.land ?? site.acres * market.land_per_acre;   // a real parcel brings its own price
  // buyers pay for views, amenity and prestige: a low-rise sells below the market's luxury condo $/sf, a tower above
  const tier = prod.floors <= 7 ? (market.lowrise_factor ?? 0.85) : prod.floors <= 14 ? 1 : prod.floors <= 40 ? (market.highrise_factor ?? 1.08) : (market.supertall_factor ?? 1.15), psf = market.price_psf * tier;
  const a = {
    price_base: psf, price_podium: psf, price_penthouse: psf * (market.top_premium ?? 1.6),
    price_step: prod.floors > 7 ? (market.floor_premium ?? 0.5) : 0,
    other_hard: market.hard_psf * (prod.floors <= 7 && market.lowrise_cost_factor ? market.lowrise_cost_factor : prod.ct.factor) + parking, demolition: 0, carry_tax: (market.carry_pct ?? 1.2) / 100 * landCost / 1e6,   // islands build low-rise in concrete too: no wood-frame saving there
    q_entitle: market.entitle_q ?? 4, q_demolish: prod.floors > 14 ? 2 : 1, q_build: Math.round(4 + prod.floors * 0.35), q_sell: sellQ, presold: 40,
    ...(market.a || {}),
  };
  const levels = productLevels(prod), q = { concrete_m3: 0, facade_m2: 0, damper_t: 0, levels };
  const A = Object.fromEntries(Object.entries({ ...a, land_price: landCost / 1e6, zoning_allowance: gsf, amenity_podium_floors: 0 }).map(([k, v]) => [k, { v }]));
  const r = appraise(null, A, q);
  return { market: market.name, region: market.region, acres: site.acres, floors: prod.floors, plate_sf: prod.plate_sf, type: prod.ct.type, units, gsf, far: gsf / lot_sf,
    land: landCost, site: site.name ?? null, gdv: r.rev.net, cost: r.cost.total + r.cf.interest + r.cf.loan_fee, profit: r.profit, margin: r.margin_on_cost, irr: r.cf.irr, equity: r.cf.equity, years: r.cf.quarters / 4,
    land_share: r.cost.land / r.rev.net, assumptions: A, levels };
}

/** The best scheme for one real parcel: every height and plate the site allows, best profit meeting `target` IRR (else best IRR). */
export function bestForSite(market, site, { floors = [3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 25, 30], plates = [6000, 9000, 12000, 16000, 20000, 25000, 30000], target = 0.15 } = {}) {
  const all = []; for (const f of floors) for (const p of plates) { const o = option(market, site, makeProduct({ floors: f, plate_sf: p, unit_sf: market.unit_sf ?? 2000 })); if (o) all.push(o); }
  const ok = all.filter(o => (o.irr ?? -1) >= target).sort((a, b) => b.profit - a.profit);
  return { best: ok[0] || all.sort((a, b) => (b.irr ?? -1) - (a.irr ?? -1))[0] || null, meeting: ok.length, tried: all.length };
}

/** Search every market over site sizes, heights and plates; returns all feasible options, best IRR first. */
export function searchSpace(markets, { acres = [0.25, 0.5, 1, 2, 4, 8], floors = [3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 25, 30, 35, 40, 50], plates = [6000, 9000, 12000, 16000, 20000, 25000] } = {}) {
  const out = [];
  for (const m of markets) for (const ac of acres) for (const f of floors) for (const p of plates) {
    const o = option(m, { acres: ac }, makeProduct({ floors: f, plate_sf: p, unit_sf: m.unit_sf ?? 2000 })); if (o) out.push(o);
  }
  return out.sort((a, b) => (b.irr ?? -1) - (a.irr ?? -1));
}
