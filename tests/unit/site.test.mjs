// site.test.mjs - the Park Lane study: the real site data, and the organic tower's geometry against the lot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Model } from '../../app/core/model.js';
import '../../app/core/functions.js';
import { createSiteTower, plate, inscribedTube, coreAt, SITE_TOWER_DEFAULTS as O } from '../../app/core/sitetower.js';
import { crownFinsMesh } from '../../app/core/archgeom.js';

const site = JSON.parse(readFileSync(new URL('../../app/data/site-park-lane.json', import.meta.url), 'utf8'));
const inside = ([x, y], g) => { let c = false; for (let i = 0; i < g.length; i++) { const [x1, y1] = g[i], [x2, y2] = g[(i + 1) % g.length]; if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) c = !c; } return c; };

test('site data: real footprints with heights, sources and licence stated, later towers flagged as added', () => {
  assert.match(site.source, /OpenStreetMap/); assert.match(site.license, /ODbL/);
  assert.ok(site.buildings.length > 1000);
  const added = site.buildings.filter(b => b.added); assert.ok(added.length >= 4 && added.every(b => b.note && b.h > 250));
  assert.ok(site.buildings.every(b => b.h > 0 && b.pts.length >= 3));
  assert.ok(site.buildings.every(b => !inside(b.pts.reduce((s, q) => [s[0] + q[0] / b.pts.length, s[1] + q[1] / b.pts.length], [0, 0]), site.site.outline)), 'no neighbour stands on the site');
});

test('the organic plate stays inside the real lot and holds the tube around the core at every height', () => {
  for (let f = 0; f <= 1.0001; f += 0.01) {
    const pl = plate(O, f); assert.ok(pl.every(q => inside(q, site.site.outline)), `plate leaves the lot at f=${f.toFixed(2)}`);
    const t = inscribedTube(O, pl, O.facadeSetback + 0.45), c = coreAt(O, f);
    assert.ok(t.hx >= c.hx + 2 && t.hy >= c.hy + 2, `tube ${t.hx}×${t.hy} around core ${c.hx}×${c.hy} at f=${f.toFixed(2)}`);
  }
});

test('the plate turns and tapers as stated: a quarter turn and 62 % at the top', () => {
  const area = g => Math.abs(g.reduce((s, q, i) => s + q[0] * g[(i + 1) % g.length][1] - g[(i + 1) % g.length][0] * q[1], 0) / 2);
  assert.ok(Math.abs(Math.sqrt(area(plate(O, 1)) / area(plate(O, 0))) - O.plan.taper) < 1e-3);
  const p1 = plate(O, 1), ang = Math.atan2(p1[0][1] - O.plan.cy, p1[0][0] - O.plan.cx) * 180 / Math.PI;
  assert.ok(Math.abs(ang - O.plan.twistDeg) < 0.5, `first vertex at ${ang.toFixed(1)}°`);
});

test('the generated study: facade per storey, set-back penthouses with balustrades, an open crown, real context', () => {
  const m = new Model('s'), app = { model: m, regenerate() { return m.regenerate(); } };
  createSiteTower(app, site); const r = m.regenerate(); assert.deepEqual(r.errors, {});
  const ph = m.byType('level').filter(l => l.params.kind?.value === 'penthouse'); assert.equal(ph.length, O.penthouses);
  for (const l of ph) { const k = m.children(l.id), slab = k.find(x => x.type === 'slab'), glass = k.find(x => x.type === 'curtain_wall' && x.params.kind.value === 'lobby');
    const span = g => Math.max(...g.map(q => q[0])) - Math.min(...g.map(q => q[0])); assert.ok(span(glass.params.outline.value) < span(slab.params.outline.value) - 2 * 0.75 * O.terrace, 'glass line set back about the terrace depth'); assert.ok(k.some(x => x.params.kind?.value === 'balustrade')); }
  const crown = m.byType('curtain_wall').find(c => c.params.kind.value === 'crownfins'); assert.ok(m.result(crown.id).solidity < 0.5, 'the crown is mostly open');
  const crownLevel = m.get(crown.parent); assert.ok(!m.children(crownLevel.id).some(w => w.type === 'wall' && w.params.pier?.value === 'tube'), 'no tube in the open crown');
  assert.equal(m.byType('context').find(c => c.params.kind.value === 'buildings').params.buildings.value.length, site.buildings.length);
});

test('crown blades: open lattice, solidity well under the outline, area carried for weight', () => {
  const sq = [[-10, -10], [10, -10], [10, 10], [-10, 10]], mm = crownFinsMesh({ outline: sq, z0: 0, h: 20 });
  assert.ok(mm.solidity > 0 && mm.solidity < 0.5); assert.ok(mm.glass_m2 > 0); assert.equal(mm.volume_m3, undefined);
});
