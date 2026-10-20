// search-parcels.mjs - every real parcel in app/core/parcels.js through the scheme search at its asking price,
// with a downside case. Writes docs/parcel-search.json. node tools/search-parcels.mjs
import { writeFileSync } from 'node:fs';
import { bestForSite, option, makeProduct } from '../app/core/screening.js';
import { MARKETS } from '../app/core/markets.js';
import { PARCELS } from '../app/core/parcels.js';

const marketFor = p => { const m = MARKETS.find(x => x.name === p.market); if (!m) throw new Error(`no market ${p.market}`);
  return { ...m, price_psf: m.price_psf * (p.price_factor ?? 1), max_floors: Math.min(m.max_floors, p.max_floors ?? 99), max_far: p.max_far ?? m.max_far, coverage: p.coverage ?? m.coverage, absorption_units_q: m.absorption_units_q * (p.absorption_factor ?? 1) }; };
const down = m => ({ ...m, price_psf: m.price_psf * 0.85, hard_psf: m.hard_psf * 1.1, absorption_units_q: m.absorption_units_q * 0.7 });
const rows = PARCELS.map(p => {
  const m = marketFor(p), site = { acres: p.acres, land: p.land, name: p.name }, s = bestForSite(m, site), b = s.best;
  const d = b ? option(down(m), site, makeProduct({ floors: b.floors, plate_sf: b.plate_sf, unit_sf: m.unit_sf ?? 2000 })) : null;
  return { ...p, per_acre: p.land / p.acres, schemes: s.tried, meeting: s.meeting, best: b && { floors: b.floors, plate_sf: b.plate_sf, units: b.units, gsf: Math.round(b.gsf), gdv: b.gdv, cost: b.cost, profit: b.profit, margin: b.margin, irr: b.irr, equity: b.equity, years: b.years }, downside: d && { profit: d.profit, irr: d.irr } };
}).sort((a, b) => (b.best?.irr ?? -9) - (a.best?.irr ?? -9));
writeFileSync(new URL('../docs/parcel-search.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString(), rows }, null, 1));
const P = x => `$${(x / 1e6).toFixed(1)}M`, pc = x => x === null || x === undefined ? 'none' : `${(x * 100).toFixed(0)}%`;
for (const r of rows) { const b = r.best; console.log(`${r.market.slice(0, 12).padEnd(13)} ${r.name.slice(0, 44).padEnd(45)} ${(r.status||'').slice(0,10).padEnd(11)} ${r.acres}ac ${P(r.land)} | ${b ? `${b.floors}fl ${b.units}u IRR ${pc(b.irr)} profit ${P(b.profit)} eq ${P(b.equity)} ${b.years}y` : 'no scheme fits'} | down ${pc(r.downside?.irr)} ${P(r.downside?.profit ?? 0)}`); }
