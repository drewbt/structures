// tower.test.mjs - the synthetic needle tower: its floor stack, its continuity, and its gravity summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../../app/core/model.js';
import '../../app/core/functions.js';
import { createNeedleTower, floorStack, setback, towerGravity, TOWER_DEFAULTS as O } from '../../app/core/tower.js';
import { pileCapacity, soilInputs } from '../../app/core/geotech.js';

function build() { const m = new Model('t'); const app = { model: m, regenerate() { return m.regenerate(); } }; const ids = createNeedleTower(app); return { m, ids, r: m.regenerate() }; }

test('floor stack: cellars, lobby, typical and 4 mechanical storeys, crown; heights add up and storeys touch', () => {
  const fs = floorStack();
  assert.equal(fs.filter(f => f.kind === 'cellar').length, 2);
  assert.equal(fs.filter(f => f.k >= 1 && f.k <= O.floors).length, O.floors);
  assert.equal(fs.filter(f => f.kind === 'mechanical').length, 4);
  for (let i = 1; i < fs.length; i++) assert.ok(Math.abs(fs[i].elevation - (fs[i - 1].elevation + fs[i - 1].height)) < 1e-9, `${fs[i].name} sits on ${fs[i - 1].name}`);
  const top = fs.at(-1).elevation + fs.at(-1).height, hand = O.lobby + 4 * O.mechanical.height + (O.floors - 5) * O.typical + O.crown;
  assert.ok(Math.abs(top - hand) < 1e-9, `${top} vs ${hand}`);
  assert.ok(top / O.width > 10, `slenderness ${(top / O.width).toFixed(1)}`);
});

test('setbacks step the south face back, never past the core, and never move the north (park) face', () => {
  assert.equal(setback(O.taper.from - 1), 0);
  for (let k = 1; k <= O.floors; k++) { assert.ok(setback(k) <= O.taper.maxSetback); assert.ok(setback(k) < O.core.y[0], `floor ${k} keeps the core inside the plate`); if (k > 1) assert.ok(setback(k) >= setback(k - 1)); }
});

test('the generated tower: every element regenerates, every storey has its walls, core and slab; walls stack', () => {
  const { m, r } = build();
  assert.deepEqual(r.errors, {}, JSON.stringify(r.errors).slice(0, 300));
  const levels = m.byType('level'), storeys = levels.filter(l => l.params.floor !== undefined);
  assert.equal(storeys.length, floorStack().length);
  for (const l of storeys) {
    const kids = m.children(l.id), walls = kids.filter(k => k.type === 'wall');
    assert.ok(walls.filter(w => / core /.test(w.name)).length === 4 && walls.some(w => / east wall/.test(w.name)) && walls.some(w => / west wall/.test(w.name)), `${l.name} walls`);
  }
  // the east wall of each storey starts where the one below ends (vertical continuity)
  const east = storeys.map(l => m.children(l.id).find(w => / east wall/.test(w.name))).map(w => m.result(w.id).bounds);
  for (let i = 1; i < east.length; i++) assert.ok(Math.abs(east[i].min[2] - east[i - 1].max[2]) < 1e-9, `east wall ${i}`);
  // north face on the lot line all the way up
  const northCols = m.byType('column').filter(c => / north col/.test(c.name));
  assert.ok(northCols.every(c => Math.abs(c.params.center.value[1] + c.params.width.value / 2 - O.depth) < 1e-9));
});

test('context and ground: park across the street, rock under the mat, piles refused in rock', () => {
  const { m } = build();
  assert.equal(m.byType('context').length, 2);
  const soil = soilInputs(m); assert.equal(soil.layers.at(-1).kind, 'rock');
  const mat = m.byType('slab').find(s => s.params.role?.value === 'mat'), b = m.result(mat.id).bounds;
  assert.ok(soil.surface - b.min[2] > soil.layers.at(-1).top, 'the mat bottom is in rock');
  assert.throws(() => pileCapacity.run({ soil, D: 1, zHead: -2, L: 20 }), /rock/);
});

test('gravity summary: self-weight, superimposed and live loads add up by hand; pressure = total / area', () => {
  const r = towerGravity.run({ concrete_m3: 100, floors: [{ area: 50, sdl: 2, ll: 2 }, { area: 30, sdl: 1, ll: 4 }], mat: { area: 40, qa: 1000, layer: 'x' } });
  assert.equal(r.self_kN, 2400); assert.equal(r.sdl_kN, 130); assert.equal(r.L_kN, 220); assert.equal(r.total_kN, 2750);
  assert.equal(r.q_kPa, 2750 / 40); assert.equal(r.util, 2750 / 40 / 1000);
});
