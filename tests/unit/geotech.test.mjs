// geotech.test.mjs - pile axial capacity against closed forms worked by hand from the stated methods.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pileCapacity, pileLength, sigmaV, validateProfile, PA } from '../../app/core/geotech.js';

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
const clay = { surface: 0, water_depth: Infinity, fs: 2.5, layers: [{ name: 'C', kind: 'clay', top: 0, bottom: 30, gamma: 18, su: 50 }] };
const sand = { surface: 0, water_depth: Infinity, fs: 2.5, layers: [{ name: 'S', kind: 'sand', top: 0, bottom: 30, gamma: 18, N60: 30 }] };

test('clay: α su over the shaft less the top 1.5 m and the bottom diameter; Nc* su at the toe (GEC 10)', () => {
  const D = 0.6, L = 8, r = pileCapacity.run({ soil: clay, D, zHead: 0, L });
  const Qs = 0.55 * 50 * Math.PI * D * (L - 1.5 - D);            // su/pa = 0.49 ≤ 1.5, so α = 0.55
  const Nc = 8 + (50 - 48) / 48;                                    // between 8.0 at 48 kPa and 9.0 at 96 kPa
  const Qb = Nc * 50 * Math.PI * D * D / 4;
  assert.ok(rel(r.Qside, Qs) < 1e-9, `side ${r.Qside} vs ${Qs}`);
  assert.ok(rel(r.Qtip, Qb) < 1e-9, `tip ${r.Qtip} vs ${Qb}`);
  assert.ok(rel(r.Qallow, (Qs + Qb) / 2.5) < 1e-9);
});

test('clay: a toe shallower than 3 D reduces the tip by 2/3 (1 + z/6D)', () => {
  const D = 0.75, r = pileCapacity.run({ soil: clay, D, zHead: 0, L: 2 });
  const Nc = 8 + 2 / 48, qp = Nc * 50 * (2 / 3) * (1 + 2 / (6 * D));
  assert.ok(rel(r.qp, qp) < 1e-12, `${r.qp} vs ${qp}`);
});

test('sand: β σ′v with β = 1.5 − 0.245 √z integrates to πDγ[0.75 z² − 0.098 z^2.5]; tip 0.6 pa N60', () => {
  const D = 0.5, z1 = 2, z2 = 12, g = 18, r = pileCapacity.run({ soil: sand, D, zHead: -z1, L: z2 - z1 });
  const F = z => 0.75 * z * z - 0.098 * z ** 2.5, Qs = Math.PI * D * g * (F(z2) - F(z1));   // β stays within 0.25..1.2 and fs < 200 kPa over 2..12 m
  assert.ok(rel(r.Qside, Qs) < 2e-4, `side ${r.Qside} vs ${Qs} (50 mm slices)`);
  assert.ok(rel(r.Qtip, 0.6 * PA * 30 * Math.PI * D * D / 4) < 1e-12);
});

test('effective stress below the water table uses γ − γw', () => {
  const s = { surface: 0, water_depth: 2, fs: 2.5, layers: [{ name: 'a', kind: 'fill', top: 0, bottom: 3, gamma: 18 }, { name: 'b', kind: 'sand', top: 3, bottom: 10, gamma: 20, N60: 20 }] };
  assert.ok(Math.abs(sigmaV(s, 5) - (18 * 2 + (18 - 9.81) * 1 + (20 - 9.81) * 2)) < 1e-9);
  assert.ok(Math.abs(sigmaV(s, 12) - (18 * 2 + (18 - 9.81) + (20 - 9.81) * 9)) < 1e-9, 'the deepest layer continues below its bottom');
});

test('fill carries nothing', () => {
  const s = { surface: 0, water_depth: Infinity, fs: 2.5, layers: [{ name: 'F', kind: 'fill', top: 0, bottom: 20, gamma: 18 }] };
  const r = pileCapacity.run({ soil: s, D: 0.6, zHead: 0, L: 10 }); assert.equal(r.Qult, 0);
});

test('pile length: the shortest 0.5 m step that carries the load, and the step below does not', () => {
  const P = 400, r = pileLength.run({ soil: clay, D: 0.6, zHead: -1, P });
  assert.ok(r && r.capacity.Qallow >= P);
  if (r.L > 3) assert.ok(pileCapacity.run({ soil: clay, D: 0.6, zHead: -1, L: r.L - 0.5 }).Qallow < P);
  assert.equal(pileLength.run({ soil: clay, D: 0.45, zHead: 0, P: 1e6 }), null, 'none up to 30 m');
});

test('a profile with a gap between layers is refused', () => {
  const s = { surface: 0, water_depth: 2, fs: 2.5, layers: [{ name: 'a', kind: 'fill', top: 0, bottom: 1, gamma: 18 }, { name: 'b', kind: 'clay', top: 1.5, bottom: 5, gamma: 19, su: 60 }] };
  assert.throws(() => validateProfile(s), /starts at 1.5/);
});
