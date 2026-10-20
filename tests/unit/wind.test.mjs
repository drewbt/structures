// wind.test.mjs - the wind ruleset against published table values, sections against hand formulas, and the
// tower frame in the real stiffness engine against cantilever closed forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Model } from '../../app/core/model.js';
import '../../app/core/functions.js';
import * as W from '../../app/core/standards/asce7-16-wind.js';
import { gustFlexible, peakFactor } from '../../app/core/wind.js';
import { pierSection, towerStoreys, towerFrame, DYN, Ec, tmdDamping } from '../../app/core/towerdyn.js';
import { createNeedleTower, TOWER_DEFAULTS } from '../../app/core/tower.js';

const BIN = process.env.STIFFNESS_BIN || '/home/user/stiffness/build/stiffness', dir = mkdtempSync(join(tmpdir(), 'wind-'));
const engine = m => { const i = join(dir, 'i.json'), o = join(dir, 'o.json'); writeFileSync(i, JSON.stringify(m)); execFileSync(BIN, [i, '-o', o, '--compact'], { stdio: 'ignore' }); return JSON.parse(readFileSync(o, 'utf8')); };
const ft = 0.3048;

test('Kz matches the ASCE 7-16 Table 26.10-1 values (two decimals)', () => {
  for (const [z, exp, k] of [[30, 'B', 0.70], [30, 'C', 0.98], [100, 'C', 1.26], [100, 'B', 0.99], [15, 'C', 0.85]]) assert.ok(Math.abs(W.Kz(z * ft, exp) - k) < 0.006, `${exp} ${z} ft: ${W.Kz(z * ft, exp).toFixed(3)} vs ${k}`);
});

test('leeward Cp: −0.5, −0.3, −0.2 at L/B 1, 2, 4', () => { assert.equal(W.cpLeeward(1), -0.5); assert.ok(Math.abs(W.cpLeeward(2) + 0.3) < 1e-12); assert.ok(Math.abs(W.cpLeeward(4) + 0.2) < 1e-12); });

test('gust factor: a stiff building (n1 large) tends to the rigid value, more damping lowers Gf', () => {
  const a = gustFlexible.run({ h: 100, B: 30, L: 30, n1: 5, beta: 0.02, V: 50, exp: 'C' }), b = gustFlexible.run({ h: 100, B: 30, L: 30, n1: 0.15, beta: 0.01, V: 50, exp: 'C' }), c = gustFlexible.run({ h: 100, B: 30, L: 30, n1: 0.15, beta: 0.04, V: 50, exp: 'C' });
  assert.ok(a.Gf < 0.95 && a.Gf > 0.8, `stiff ${a.Gf}`); assert.ok(b.Gf > c.Gf && c.Gf > a.Gf);
  assert.ok(Math.abs(peakFactor(1) - (Math.sqrt(2 * Math.log(3600)) + 0.5772 / Math.sqrt(2 * Math.log(3600)))) < 1e-12);
});

test('a closed box section: I and Bredt J by hand', () => {
  const t = 0.5, s = pierSection([{ start: [-4, -5], end: [4, -5], thickness: t }, { start: [4, -5], end: [4, 5], thickness: t }, { start: [4, 5], end: [-4, 5], thickness: t }, { start: [-4, 5], end: [-4, -5], thickness: t }], { closed: true });
  const Iyy = 2 * (t * 8 ** 3 / 12) + 2 * (10 * t ** 3 / 12 + 10 * t * 16);   // flanges along x bend about their own axis; walls along y at x = ±4
  assert.ok(Math.abs(s.Iyy - Iyy) < 1e-9, `${s.Iyy} vs ${Iyy}`);
  assert.ok(Math.abs(s.J - 4 * 80 ** 2 / (36 / t)) < 1e-9);
  assert.ok(Math.abs(s.Avx - 2 * 8 * t) < 1e-12);
});

test('damper: equivalent damping grows with the mass ratio, 0 without a damper', () => { assert.equal(tmdDamping(0), 0); assert.ok(tmdDamping(0.02) > tmdDamping(0.01)); assert.ok(Math.abs(tmdDamping(0.02) - 0.5 * Math.sqrt(0.06 / (8 * 1.02 ** 3))) < 1e-15); });

/** A uniform tower: 12 equal storeys, a tube and a core, no setbacks, no outriggers, slab coupling off. */
function uniform() {
  const m = new Model('u'), app = { model: m, regenerate() { return m.regenerate(); } };
  createNeedleTower(app, { ...TOWER_DEFAULTS, floors: 11, lobby: 4, typical: 4, crown: 4, mechanical: { floors: [], height: 4 }, taper: { from: 999, every: 1, step: 0, maxSetback: 0 }, ext: [[1, 0.6]], coreWall: [[1, 0.5]], fc: [[1, 55]], tube: { thickness: 0.4, solidity: 1 }, core: { x: [-4, 4], y: [17.5, 27.5] }, damper: { mass: 0 }, outriggers: { floors: [], thickness: 0.8 }, wallScale: 1 });   // core centred on the tube: no torsion under a load in x
  return m;
}

test('frame vs Euler-Bernoulli: tip deflection under a top load equals P H³ / 3 E ΣI (tube + core, rigid diaphragms)', () => {
  const save = { s: DYN.slab_cracked, sh: DYN.shear }; DYN.slab_cracked = 1e-12; DYN.shear = false;
  try {
    const m = uniform(), st = towerStoreys(m), fr = towerFrame.run({ storeys: st, modes: 0 });
    const top = fr.floors.at(-1).core, P = 1000, loads = new Array(6 * fr.engine.nodes.length).fill(0); loads[6 * top] = P;
    const { mass_t, modes_wanted, ...e } = fr.engine; void mass_t; void modes_wanted;
    const r = engine({ ...e, cases: [{ name: 'P', loads }] }), d = r.cases[0].d[6 * top];
    const H = fr.height, s0 = st[0], I = Object.entries(s0.piers).reduce((s, [p, w]) => s + pierSection(w, { closed: true }).Iyy, 0), E = Ec(55);
    const exact = P * H ** 3 / (3 * E * I);
    assert.ok(Math.abs(d - exact) / exact < 2e-3, `engine ${d} vs ${exact}`);
  } finally { DYN.slab_cracked = save.s; DYN.shear = save.sh; }
});

test('frame vs closed form: first frequency of the uniform tower within 3 % of 1.875²/2π √(EI/m̄H⁴)', () => {
  const save = { s: DYN.slab_cracked, sh: DYN.shear }; DYN.slab_cracked = 1e-12; DYN.shear = false;
  try {
    const m = uniform(), st = towerStoreys(m), fr = towerFrame.run({ storeys: st, modes: 3 }), r = engine(fr.engine);
    const H = fr.height, I = Object.entries(st[0].piers).reduce((s, [p, w]) => s + pierSection(w, { closed: true }).Iyy, 0), E = Ec(55);
    const free = fr.engine.nodes.reduce((s, n, i) => s + (n.restrained[0] ? 0 : fr.engine.mass_t[6 * i]), 0), mbar = free / H,   // mass at the fixed base never moves
    f = 1.875 ** 2 / (2 * Math.PI) * Math.sqrt(E * I / (mbar * H ** 4));
    const fx = r.modes.map(q => q.frequency_hz).sort((a, b) => a - b)[0];
    assert.ok(Math.abs(fx - f) / f < 0.03, `engine ${fx} vs ${f}`);
  } finally { DYN.slab_cracked = save.s; DYN.shear = save.sh; }
});

import * as SE from '../../app/core/standards/asce7-16-seismic.js';
test('seismic: SDC from SDS and SD1, Cs branches and the 0.01 floor (ASCE 7-16 12.8.1.1, by hand)', () => {
  assert.equal(SE.sdc(0.16, 0.05), 'A'); assert.equal(SE.sdc(0.168, 0.037), 'B'); assert.equal(SE.sdc(0.2, 0.15), 'C'); assert.equal(SE.sdc(0.6, 0.1), 'D');
  const a = SE.Cs({ SDS: 1.0, SD1: 0.6, T: 0.5, TL: 8, R: 5, Ie: 1 }); assert.ok(Math.abs(a.Cs - 0.2) < 1e-12, '12.8-2: SDS / R');
  const b = SE.Cs({ SDS: 1.0, SD1: 0.6, T: 2, TL: 8, R: 5, Ie: 1 }); assert.ok(Math.abs(b.Cs - 0.06) < 1e-12, '12.8-3: SD1 / (T R)');
  const c = SE.Cs({ SDS: 1.0, SD1: 0.6, T: 10, TL: 8, R: 5, Ie: 1 }); assert.ok(Math.abs(c.Cs - 0.044) < 1e-12, '12.8-4 gives 0.0096, so 0.044 SDS governs');
  const d = SE.Cs({ SDS: 0.168, SD1: 0.0373, T: 7.9, TL: 6, R: 4, Ie: 1 }); assert.equal(d.Cs, 0.01); assert.match(d.governs, /minimum/);
  assert.equal(SE.kExp(0.4), 1); assert.equal(SE.kExp(3), 2); assert.ok(Math.abs(SE.kExp(1.5) - 1.5) < 1e-12);
  assert.ok(Math.abs(SE.Ta(435.4) - 0.0488 * 435.4 ** 0.75) < 1e-12);
});
