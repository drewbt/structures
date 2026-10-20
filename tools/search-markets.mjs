// search-markets.mjs - the solution-space search: every market × site size × height × plate, appraised in full,
// then each market's optimum re-run in a downside case (prices −15 %, hard cost +10 %, sales 30 % slower).
// Writes docs/market-search.json. node tools/search-markets.mjs
import { writeFileSync } from 'node:fs';
import { searchSpace, option, makeProduct } from '../app/core/screening.js';
import { MARKETS } from '../app/core/markets.js';

const TARGET = 0.15, all = searchSpace(MARKETS);
const down = m => ({ ...m, price_psf: m.price_psf * 0.85, hard_psf: m.hard_psf * 1.10, absorption_units_q: m.absorption_units_q * 0.7 });
const slim = o => o && ({ market: o.market, region: o.region, acres: o.acres, floors: o.floors, plate_sf: o.plate_sf, type: o.type, units: o.units, gsf: Math.round(o.gsf), far: +o.far.toFixed(2),
  land: o.land, gdv: o.gdv, cost: o.cost, profit: o.profit, margin: o.margin, irr: o.irr, equity: o.equity, years: o.years, land_share: o.land_share });
const results = MARKETS.map(m => {
  const mine = all.filter(o => o.market === m.name), bestIrr = mine[0];
  const ok = mine.filter(o => (o.irr ?? -1) >= TARGET).sort((a, b) => b.profit - a.profit), best = ok[0] || bestIrr;   // the most profit that still meets the target return
  const dn = best ? option(down(m), { acres: best.acres }, makeProduct({ floors: best.floors, plate_sf: best.plate_sf, unit_sf: m.unit_sf ?? 2000 })) : null;
  const scale = mine.reduce((acc, o) => { const k = o.floors <= 7 ? 'low-rise (≤7)' : o.floors <= 14 ? 'mid-rise (8-14)' : o.floors <= 40 ? 'high-rise (15-40)' : 'supertall (>40)'; if (!acc[k] || (o.irr ?? -1) > (acc[k].irr ?? -1)) acc[k] = slim(o); return acc; }, {});
  return { market: m.name, region: m.region, price_psf: m.price_psf, hard_psf: m.hard_psf, land_per_acre: m.land_per_acre, max_floors: m.max_floors, basis: m.basis,
    options: mine.length, meeting_target: ok.length, optimum: slim(best), best_irr: slim(bestIrr), downside: slim(dn), by_scale: scale };
}).sort((a, b) => (b.meeting_target ? b.optimum.profit : -1e12 + (b.optimum?.irr ?? -1)) - (a.meeting_target ? a.optimum.profit : -1e12 + (a.optimum?.irr ?? -1)));
writeFileSync(new URL('../docs/market-search.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString(), target_irr: TARGET, options: all.length, downside: 'prices −15 %, hard cost +10 %, sales 30 % slower', results }, null, 1));
const P = x => `$${(x / 1e6).toFixed(1)}M`, pc = x => x === null || x === undefined ? 'none' : `${(x * 100).toFixed(0)}%`;
console.log(`${all.length} options`);
for (const r of results) { const o = r.optimum, d = r.downside; console.log(`${r.region.padEnd(15)} ${r.market.slice(0, 36).padEnd(37)} ${String(r.meeting_target).padStart(4)} ok | ${o.acres}ac ${o.floors}fl ${o.plate_sf} ${o.units}u  IRR ${pc(o.irr)} profit ${P(o.profit)} margin ${pc(o.margin)} ${o.years}y eq ${P(o.equity)} | downside IRR ${pc(d?.irr)} profit ${P(d?.profit ?? 0)}`); }
