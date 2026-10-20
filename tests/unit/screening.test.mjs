// screening.test.mjs - the market search: limits respected, cost by construction type, slower sales cost money,
// a real parcel's price is used, and every market profile states its basis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { option, makeProduct, constructionType, searchSpace, bestForSite } from '../../app/core/screening.js';
import { MARKETS } from '../../app/core/markets.js';

const M = { name: 't', region: 'r', price_psf: 1200, hard_psf: 400, land_per_acre: 4e6, max_floors: 12, max_far: 4, coverage: 0.6, absorption_units_q: 6, parking_per_unit: 0, entitle_q: 3, a: {} };

test('every market profile is complete and states its basis', () => {
  for (const m of MARKETS) { for (const k of ['price_psf', 'hard_psf', 'land_per_acre', 'max_floors', 'max_far', 'coverage', 'absorption_units_q']) assert.ok(m[k] > 0, `${m.name} ${k}`); assert.ok(m.basis.length > 40, m.name); }
});

test('options break no site limit; construction cost rises with height type', () => {
  assert.equal(option(M, { acres: 1 }, makeProduct({ floors: 20, plate_sf: 10000 })), null, 'height cap');
  assert.equal(option(M, { acres: 0.25 }, makeProduct({ floors: 10, plate_sf: 9000 })), null, 'plate over coverage');
  assert.ok(constructionType(5).factor < constructionType(10).factor && constructionType(10).factor < constructionType(30).factor && constructionType(30).factor < constructionType(50).factor);
  for (const o of searchSpace([M])) assert.ok(o.floors <= M.max_floors && o.far <= M.max_far + 1e-9);
});

test('slower sales and dearer land cost money; a parcel price overrides the market land rate', () => {
  const p = makeProduct({ floors: 6, plate_sf: 12000 }), base = option(M, { acres: 1 }, p);
  assert.ok(option({ ...M, absorption_units_q: 2 }, { acres: 1 }, p).profit < base.profit);
  assert.ok(option({ ...M, land_per_acre: 8e6 }, { acres: 1 }, p).profit < base.profit);
  const parcel = option(M, { acres: 1, land: 1e6 }, p); assert.equal(parcel.land, 1e6); assert.ok(parcel.profit > base.profit);
  const b = bestForSite(M, { acres: 1 }); assert.ok(b.best && b.tried > 5);
});

test('market options carry the market\'s own costs, never the New York defaults (no demolition, carry on the land)', () => {
  const o = option(M, { acres: 1 }, makeProduct({ floors: 5, plate_sf: 12000 }));
  assert.equal(o.assumptions.demolition.v, 0); assert.ok(o.assumptions.carry_tax.v < 1);
});
