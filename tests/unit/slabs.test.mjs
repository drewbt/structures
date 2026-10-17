// slabs.test.mjs - flat slab design against independent oracles: the closed-form Jc of ACI R8.4.4.2.3 for
// interior and edge columns, bo by hand, the DDM coefficient identity (negatives averaged + positive = M0),
// Table 22.6.5.2 governing cases, and global equilibrium of the column reactions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../../app/core/model.js';
import { slabInputs, flatSlabDesign, flatSlabBars, criticalPerimeter, sectionProps, stripPositions } from '../../app/core/slabs.js';
import * as ACI from '../../app/core/standards/aci318-19.js';

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
const SLAB = { x0: -0.2, x1: 18.2, y0: -0.2, y1: 18.2 };

test('interior column: bo = 2(c1 + d) + 2(c2 + d) and Jc = d b1³/6 + b1 d³/6 + d b2 b1²/2 (R8.4.4.2.3)', () => {
  const c1 = 0.5, c2 = 0.4, d = 0.2, segs = criticalPerimeter({ x: 6, y: 6, ax: c1 / 2, ay: c2 / 2, e: d / 2 }, SLAB), P = sectionProps(segs, d);
  const b1 = c1 + d, b2 = c2 + d;
  assert.equal(segs.length, 4); assert.ok(rel(P.bo, 2 * b1 + 2 * b2) < 1e-12);
  assert.ok(rel(P.Jx, d * b1 ** 3 / 6 + b1 * d ** 3 / 6 + d * b2 * b1 ** 2 / 2) < 1e-12, `Jx ${P.Jx}`);
  assert.ok(rel(P.Jy, d * b2 ** 3 / 6 + b2 * d ** 3 / 6 + d * b1 * b2 ** 2 / 2) < 1e-12, `Jy ${P.Jy}`);
  assert.ok(Math.abs(P.xb - 6) < 1e-12 && Math.abs(P.yb - 6) < 1e-12);
});

test('edge column flush with the slab edge: three sides; bo and Jc equal the closed form for moment perpendicular to the edge', () => {
  // column face on the edge x = −0.2 (centre at x = 0, c1 = 0.4 perpendicular to the edge)
  const c1 = 0.4, c2 = 0.4, d = 0.2, segs = criticalPerimeter({ x: 0, y: 6, ax: c1 / 2, ay: c2 / 2, e: d / 2 }, SLAB), P = sectionProps(segs, d);
  const b1 = c1 + d / 2, b2 = c2 + d; assert.equal(segs.length, 3); assert.ok(rel(P.bo, 2 * b1 + b2) < 1e-12);
  const cAB = b1 * b1 / (2 * b1 + b2);   // centroid from the inner face, R8.4.4.2.3
  const Jc = 2 * (b1 * d ** 3 / 12 + d * b1 ** 3 / 12 + b1 * d * (b1 / 2 - cAB) ** 2) + b2 * d * cAB ** 2;
  assert.ok(rel(P.Jx, Jc) < 1e-12, `Jx ${P.Jx} vs ${Jc}`);
  assert.ok(Math.abs((-0.2 + b1 - cAB) - P.xb) < 1e-12, 'centroid position');
});

test('corner column: two sides, bo = (c1 + d/2) + (c2 + d/2)', () => {
  const d = 0.2, segs = criticalPerimeter({ x: 0, y: 0, ax: 0.2, ay: 0.2, e: d / 2 }, SLAB), P = sectionProps(segs, d);
  assert.equal(segs.length, 2); assert.ok(rel(P.bo, 2 * (0.4 + d / 2)) < 1e-12);
});

test('two-way vc: each of the three expressions of Table 22.6.5.2 governs in its own case; λs = 1 for d ≤ 250 mm', () => {
  const r = Math.sqrt(28);
  assert.ok(rel(ACI.vcTwoWay(28, 1, 40, 200, 2400), 0.33 * r) < 1e-12, 'square column, small bo: 0.33√fc');
  assert.ok(rel(ACI.vcTwoWay(28, 4, 40, 200, 2400), 0.17 * (1 + 2 / 4) * r) < 1e-12, 'β = 4: 0.17(1 + 2/β)√fc');
  assert.ok(rel(ACI.vcTwoWay(28, 1, 20, 200, 8000), 0.083 * (2 + 20 * 200 / 8000) * r) < 1e-12, 'large bo, corner: 0.083(2 + αs d/bo)√fc');
  assert.equal(ACI.lambdaS(250), 1); assert.ok(rel(ACI.lambdaS(500), Math.sqrt(2 / 3)) < 1e-12);
});

test('strip positions: column-strip bars sit symmetrically about the column line, two inside a 400 mm core', () => {
  const v = stripPositions([4.5, 7.5], 12, 0.25, 6); assert.equal(v.length, 12);
  assert.equal(v.filter(x => Math.abs(x - 6) <= 0.18).length, 2);
  const e = stripPositions([-0.2, 1.5], 8, 0.2, 0); assert.equal(e.length, 8); assert.ok(e.every(x => x > -0.2 && x < 1.5));
});

function frame({ h = 0.25, drops = false, ll = 4.8 } = {}) {
  const m = new Model('t');
  m.create({ id: 'L0', type: 'level', params: { elevation: { value: 0, unit: 'm' }, height: { value: 3.5, unit: 'm' } } });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) m.create({ id: `C${i}${j}`, type: 'column', name: `C${i}${j}`, parent: 'L0', params: { center: { value: [6 * i, 6 * j], unit: 'm' }, width: { value: 0.4, unit: 'm' }, depth: { value: 0.4, unit: 'm' } } });
  m.create({ id: 'S', type: 'slab', name: 'S', parent: 'L0', params: { outline: { value: [[-0.2, -0.2], [18.2, -0.2], [18.2, 18.2], [-0.2, 18.2]], unit: 'm' }, thickness: { value: h, unit: 'm' }, offset: { value: 3.5, unit: 'm' }, sdl: { value: 1.5, unit: 'kN/m2' }, ll: { value: ll, unit: 'kN/m2' } } });
  if (drops) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const x0 = Math.max(-0.2, 6 * i - 1.1), x1 = Math.min(18.2, 6 * i + 1.1), y0 = Math.max(-0.2, 6 * j - 1.1), y1 = Math.min(18.2, 6 * j + 1.1);
    m.create({ type: 'drop_panel', parent: 'S', params: { center: { value: [(x0 + x1) / 2, (y0 + y1) / 2], unit: 'm' }, size: { value: [x1 - x0, y1 - y0], unit: 'm' }, projection: { value: 0.15, unit: 'm' } } });
  }
  return slabInputs(m, m.get('S'));
}

test('DDM: for every span of every frame, average of the two negative moments + positive = M0 (8.10.4); end spans use Table 8.10.4.2', () => {
  const d = flatSlabDesign.run(frame());
  for (const dir of ['x', 'y']) for (const f of d.strips[dir].frames) for (const sp of f.spans) {
    assert.ok(rel((sp.neg[0] + sp.neg[1]) / 2 + sp.pos, sp.M0) < 1e-12, `${dir} frame ${f.j} span ${sp.i}`);
  }
  const sp0 = d.strips.x.frames[1].spans[0];
  assert.ok(rel(sp0.neg[0], 0.26 * sp0.M0) < 1e-12 && rel(sp0.pos, 0.52 * sp0.M0) < 1e-12 && rel(sp0.neg[1], 0.70 * sp0.M0) < 1e-12);
  // M0 = qu ℓ2 ℓn²/8 for an interior frame, interior span
  const f = d.strips.x.frames[1], sp1 = f.spans[1]; assert.ok(rel(sp1.M0, d.loads.qu * 6 * 5.6 ** 2 / 8) < 1e-12);
  // column strip + middle strip moments at a support add back to the frame's support moment (interior lines)
  const cs = d.strips.x.strips.find(s => s.type === 'column' && s.line === 1), supM = f.supports[1].M;
  assert.ok(rel(-cs.locations.find(l => l.kind === 'top' && l.k === 1).Mu, 0.75 * supM) < 1e-12);
});

test('reactions: Σ column loads = slab load + drop panel weight exactly (equilibrium)', () => {
  for (const drops of [false, true]) {
    const s = frame({ drops }), d = flatSlabDesign.run(s);
    const A = 18.4 * 18.4, flat = (s.unit_weight * s.h + s.sdl) * A, dropW = s.drops.reduce((a, q) => a + q.size[0] * q.size[1] * q.projection * s.unit_weight, 0);
    const D = d.reactions.reduce((a, r) => a + r.D_kN, 0), L = d.reactions.reduce((a, r) => a + r.L_kN, 0);
    assert.ok(rel(D, flat + dropW) < 1e-12, `D ${D} vs ${flat + dropW}`); assert.ok(rel(L, s.ll * A) < 1e-12);
    assert.equal(d.reactions.filter(r => r.location === 'corner').length, 4); assert.equal(d.reactions.filter(r => r.location === 'interior').length, 4);
  }
});

test('drop panels: two critical sections per column; the one outside the drop uses the slab depth; drop checks reported', () => {
  const d = flatSlabDesign.run(frame({ drops: true }));
  const p = d.punching.find(q => q.name === 'C11'); assert.equal(p.sections.length, 2);
  assert.ok(p.sections[0].d_mm > p.sections[1].d_mm + 149, 'inner section through the 150 mm drop');
  assert.ok(rel(p.sections[1].bo_mm, 4 * (2200 + p.sections[1].d_mm)) < 1e-9, 'outer section around a 2.2 m square drop');
  assert.ok(d.checks.some(c => c.name.includes('projection ≥ h/4')) && d.checks.some(c => c.name.includes('extent x+ ≥ ℓ/6')));
  assert.ok(d.checks.find(c => c.name.startsWith('minimum thickness, interior')).name.includes('ℓn/36'), 'Table 8.3.1.1 with drop panels');
});

test('studs: a failing column gets rails; the outer section passes; rails never run off a free edge; bars and zones generated', () => {
  const s = frame({ h: 0.22 }), d = flatSlabDesign.run(s), p = d.punching.find(q => q.name === 'C11');
  assert.ok(p.sections[0].util > 1 && p.rails, 'interior column needs studs');
  assert.ok(p.rails.outer.util <= 1, `outer section util ${p.rails.outer.util}`);
  assert.equal(p.rails.nRails, 8); assert.ok(p.rails.s <= 0.75 * p.sections[0].d_mm + 1e-9);
  const out = flatSlabBars.run({ s, design: d });
  assert.ok(out.bars.length > 400 && out.zones.length === 16);
  for (const r of out.rails) for (const q of r.path) assert.ok(q[0] > -0.2 && q[0] < 18.2 && q[1] > -0.2 && q[1] < 18.2);
  const corner = out.rails.filter(r => r.column === 'C00'); assert.ok(corner.length <= 4, `corner rails ${corner.length}`);
  for (const b of out.bars) for (const q of b.path) assert.ok(q[2] < s.zTop && q[2] > s.zTop - s.h - 0.2, 'bars within the slab depth (hooks may dip)');
});
