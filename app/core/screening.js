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
