// structure.test.mjs - the structural chain against independent oracles.
//
// Analysis: closed-form Timoshenko beam theory (bending + shear deformation, κ = 5/6), run through the
// real stiffness engine binary (STIFFNESS_BIN, default /home/user/stiffness/build/stiffness). The engine
// tests are skipped, and say so, when the binary is absent; they are never faked.
// Design: the code's own tabulated values (β1, Ec), equilibrium and strain compatibility as identities,
// and one section worked by hand below (arithmetic in the comment, not by the code under test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Model } from '../../app/core/model.js';
import { rectSection, beamModel, beamResults, beamInputs, rcBeamDesign, flexure, asRequired, beamBars } from '../../app/core/structure.js';
import * as ACI from '../../app/core/standards/aci318-19.js';

const BIN = process.env.STIFFNESS_BIN || '/home/user/stiffness/build/stiffness';
const haveEngine = existsSync(BIN);
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
function runEngine(engineModel) {
  const dir = mkdtempSync(join(tmpdir(), 'coral-st-')); const i = join(dir, 'm.json'), o = join(dir, 'r.json');
  writeFileSync(i, JSON.stringify(engineModel)); execFileSync(BIN, [i, '-o', o, '--compact'], { stdio: 'ignore' });
  return JSON.parse(readFileSync(o, 'utf8'));
}
function beam(params) {
  const m = new Model('t');
  m.create({ id: 'L0', type: 'level', params: { elevation: { value: 0, unit: 'm' }, height: { value: 3, unit: 'm' } } });
  const P = {}; for (const [k, v] of Object.entries(params)) P[k] = { value: v, unit: typeof v === 'number' ? '' : '' };
  m.create({ id: 'B1', type: 'beam', parent: 'L0', params: P });
  return { m, p: beamInputs(m, m.get('B1')) };
}

test('rectangle section: A, Iy, Iz exact; J within 0.2 % of the Saint-Venant series for a square (0.140577 a⁴)', () => {
  const s = rectSection(0.3, 0.6);
  assert.equal(s.A, 0.18); assert.ok(rel(s.Iy, 0.3 * 0.6 ** 3 / 12) < 1e-15); assert.ok(rel(s.Iz, 0.6 * 0.3 ** 3 / 12) < 1e-15);
  assert.ok(rel(rectSection(1, 1).J, 0.140577) < 2e-3, `square J ${rectSection(1, 1).J}`);
  // h/b = 2: series value β = 0.229 (Timoshenko & Goodier, Table: J = β h b³)
  assert.ok(rel(rectSection(0.5, 1).J, 0.2287 * 1 * 0.5 ** 3) < 3e-3, `2:1 J ${rectSection(0.5, 1).J}`);
});

test('ACI 318-19 tabulated values: β1 at 28/35/55 MPa, Ec(28), φ at the strain limits', () => {
  assert.equal(ACI.beta1(28), 0.85); assert.ok(Math.abs(ACI.beta1(35) - 0.80) < 1e-12); assert.equal(ACI.beta1(55), 0.65); assert.equal(ACI.beta1(70), 0.65);
  assert.ok(Math.abs(ACI.Ec(28) - 24870.06) < 0.01);
  assert.equal(ACI.phiFlexure(0.0051, 420).phi, 0.9); assert.equal(ACI.phiFlexure(0.002, 420).phi, 0.65);
  assert.ok(Math.abs(ACI.phiFlexure(420 / 200000 + 0.0015, 420).phi - 0.775) < 1e-12, 'mid-transition is the mean of 0.65 and 0.90');
  assert.ok(Math.abs(ACI.BARS['#8'].area - 509.676) < 0.01 && Math.abs(ACI.BARS['#8'].db - 25.4) < 1e-12);
});

test('beam model: nodes, supports, loads and units', () => {
  const { m } = beam({ start: [0, 0], end: [5, 0], width: 0.3, depth: 0.6, support_start: 'fixed', support_end: 'free', sdl: 2, ll: 5, segments: 10 });
  const r = beamModel.run(beamInputs(m, m.get('B1')));
  assert.equal(r.engine.nodes.length, 11); assert.equal(r.engine.members.length, 10);
  assert.deepEqual(r.engine.nodes[0].restrained, [1, 1, 1, 1, 1, 1]); assert.deepEqual(r.engine.nodes[10].restrained, [0, 0, 0, 0, 0, 0]);
  assert.ok(Math.abs(r.engine.nodes[0].p[2] - 2.7) < 1e-12, 'centroid at top (3.0) − h/2');
  assert.ok(Math.abs(r.loads.wD - (23.6 * 0.18 + 2)) < 1e-12); assert.equal(r.loads.wL, 5);
  assert.ok(Math.abs(r.material.E - 4700 * Math.sqrt(28) * 1000) < 1e-6, 'E in kN/m²');
  assert.throws(() => beamModel.run({ ...beamInputs(m, m.get('B1')), support_start: 'free' }), /mechanism/);
});

const cases = [
  { name: 'cantilever', s: 'fixed', e: 'free', L: 4.6,
    tip: (w, L, EI, GA) => -(w * L ** 4 / (8 * EI) + w * L ** 2 / (2 * GA)), M0: (w, L) => -w * L * L / 2, R0: (w, L) => w * L },
  { name: 'simply supported', s: 'pinned', e: 'roller', L: 6,
    mid: (w, L, EI, GA) => -(5 * w * L ** 4 / (384 * EI) + w * L ** 2 / (8 * GA)), Mmid: (w, L) => w * L * L / 8, R0: (w, L) => w * L / 2 },
  { name: 'fixed-fixed', s: 'fixed', e: 'fixed', L: 6,
    mid: (w, L, EI, GA) => -(w * L ** 4 / (384 * EI) + w * L ** 2 / (8 * GA)), Mmid: (w, L) => w * L * L / 24, M0: (w, L) => -w * L * L / 12, R0: (w, L) => w * L / 2 },
];
for (const c of cases) {
  test(`engine: ${c.name} under self-weight matches Timoshenko closed form to 1e-9`, { skip: haveEngine ? false : `stiffness binary not found at ${BIN}` }, () => {
    const { m } = beam({ start: [0, 0], end: [c.L, 0], width: 0.3, depth: 0.6, support_start: c.s, support_end: c.e, segments: 10 });
    const bm = beamModel.run(beamInputs(m, m.get('B1')));
    const res = beamResults.run({ output: runEngine(bm.engine), bm });
    const D = res.cases.D, w = bm.loads.wD, EI = bm.material.E * bm.section.Iy, GA = bm.material.G * bm.section.Av;
    if (c.tip) assert.ok(rel(D.w[10], c.tip(w, c.L, EI, GA)) < 1e-9, `tip ${D.w[10]} vs ${c.tip(w, c.L, EI, GA)}`);
    if (c.mid) assert.ok(rel(D.w[5], c.mid(w, c.L, EI, GA)) < 1e-9, `mid ${D.w[5]} vs ${c.mid(w, c.L, EI, GA)}`);
    if (c.M0) assert.ok(rel(D.M[0], c.M0(w, c.L)) < 1e-9, `M0 ${D.M[0]} vs ${c.M0(w, c.L)}`);
    if (c.Mmid) assert.ok(rel(D.M[5], c.Mmid(w, c.L)) < 1e-9, `Mmid ${D.M[5]} vs ${c.Mmid(w, c.L)}`);
    assert.ok(rel(D.R[0].F[2], c.R0(w, c.L)) < 1e-9, `R0 ${D.R[0].F[2]}`);
    // V = dM/dx: the shear at the start equals the slope of M between the first two stations, to O(Δx)
    const slope = (D.M[1] - D.M[0]) / (D.x[1] - D.x[0]); assert.ok(Math.abs(slope - (D.V[0] - w * (D.x[1] - D.x[0]) / 2)) < 1e-6 * Math.abs(D.V[0]) + 1e-9, 'V = dM/dx');
    // combinations are linear: U2 = 1.2 D (no L here)
    assert.ok(rel(res.combos.U2.M[0] || 1e-30, 1.2 * (D.M[0] || 1e-30)) < 1e-12);
  });
}

// Worked by hand (not by the code): b = 300, h = 600, cover 40, #3 stirrup (9.525), #8 bar (25.4):
// d = 600 − 40 − 9.525 − 12.7 = 537.775 mm. Three #8: As = 3 × 509.676 = 1529.03 mm².
// a = 1529.03 × 420 / (0.85 × 28 × 300) = 642192.6 / 7140 = 89.943 mm; c = a/0.85 = 105.815 mm.
// εt = 0.003 (537.775 − 105.815)/105.815 = 0.012247 → tension-controlled, φ = 0.90.
// Mn = 642192.6 × (537.775 − 44.971) = 642192.6 × 492.804 = 316,475,... N·mm ≈ 316.48 kN·m; φMn ≈ 284.83 kN·m.
test('flexure: a section worked by hand', () => {
  const f = flexure({ b: 300, d: 537.775, As: 3 * ACI.BARS['#8'].area, fc: 28, fy: 420 });
  assert.ok(Math.abs(f.a - 89.943) < 1e-3, `a ${f.a}`); assert.ok(Math.abs(f.epsT - 0.012247) < 1e-6, `εt ${f.epsT}`);
  assert.equal(f.phi, 0.9); assert.ok(Math.abs(f.Mn / 1e6 - 316.48) < 0.01, `Mn ${f.Mn / 1e6}`);
  assert.ok(Math.abs(f.C - f.T) < 1e-6 * f.T, 'equilibrium C = T');
});

test('asRequired: the returned As gives φMn = Mu exactly, and 1 % less does not suffice', () => {
  for (const Mu of [50e6, 150e6, 280e6]) {
    const As = asRequired({ b: 300, d: 537.775, fc: 28, fy: 420, Mu });
    const f = flexure({ b: 300, d: 537.775, As, fc: 28, fy: 420 });
    assert.ok(rel(f.phiMn, Mu) < 1e-12, `φMn ${f.phiMn} vs ${Mu}`);
    assert.ok(flexure({ b: 300, d: 537.775, As: 0.99 * As, fc: 28, fy: 420 }).phiMn < Mu);
  }
  assert.equal(asRequired({ b: 300, d: 537.775, fc: 28, fy: 420, Mu: 1e12 }), null, 'impossible moment reports null');
});

test('design and bars for a cantilever: every check row carries a clause; bars are inside the beam', { skip: haveEngine ? false : `stiffness binary not found at ${BIN}` }, () => {
  const { m, p } = beam({ start: [0, 0], end: [4.6, 0], width: 0.4, depth: 0.7, support_start: 'fixed', support_end: 'free', sdl: 3, ll: 6, segments: 20 });
  const bm = beamModel.run(p); const res = beamResults.run({ output: runEngine(bm.engine), bm });
  const des = rcBeamDesign.run({ p, res, bm });
  assert.ok(des.checks.length >= 8 && des.checks.every(c => c.clause && Number.isFinite(c.util)), JSON.stringify(des.checks.map(c => c.name)));
  const top = des.faces.top; assert.ok(top.phiMn_kNm >= top.Mu, 'top steel carries the hogging moment');
  assert.ok(res.envelope.Mneg < 0 && Math.abs(res.envelope.Mneg - (-(1.2 * bm.loads.wD + 1.6 * bm.loads.wL) * 4.6 ** 2 / 2)) < 1e-6 * Math.abs(res.envelope.Mneg), 'governing hogging = (1.2D + 1.6L) L²/2');
  assert.equal(res.envelope.governs.Mneg, 'U2');
  assert.ok(des.top.length === 1 && des.top[0].x0 === 0 && des.top[0].x1 === 4.6, 'one top region over the whole cantilever');
  const bars = beamBars.run({ p, design: des, beamId: 'B1' });
  const longit = bars.bars.filter(b => b.shape === 'straight');
  assert.equal(longit.filter(b => b.mark === 'T1').length, top.n);
  for (const b of longit) for (const q of b.path) { assert.ok(Math.abs(q[1]) <= p.b / 2 - p.cover + 1e-12, 'inside the width less cover'); assert.ok(q[2] <= p.zTop - p.cover && q[2] >= p.zTop - p.h + p.cover, 'inside the depth less cover'); }
  const topBar = longit.find(b => b.face === 'top' && b.mark === 'T1'); assert.ok(topBar.anchorage_start > 0 && topBar.path[0][0] < 0, 'top bars run into the fixed support by ld');
  assert.ok(bars.bars.some(b => b.shape === 'stirrup'));
});

// ---- continuous beams against Clapeyron's three-moment equation (an independent method) ----------------
/** Support moments of a continuous beam on knife-edge supports with uniform load w[j] on span j (Euler). */
function threeMoment(Ls, ws) {
  const m = Ls.length, n = m - 1; if (n === 0) return [0, 0];
  const A = Array.from({ length: n }, () => new Array(n).fill(0)), r = new Array(n).fill(0);
  for (let j = 1; j <= n; j++) { const i = j - 1; A[i][i] = 2 * (Ls[j - 1] + Ls[j]); if (i > 0) A[i][i - 1] = Ls[j - 1]; if (i < n - 1) A[i][i + 1] = Ls[j]; r[i] = -(ws[j - 1] * Ls[j - 1] ** 3 + ws[j] * Ls[j] ** 3) / 4; }
  for (let i = 1; i < n; i++) { const f = A[i][i - 1] / A[i - 1][i - 1]; A[i][i] -= f * A[i - 1][i]; r[i] -= f * r[i - 1]; }   // Thomas algorithm
  const M = new Array(n); for (let i = n - 1; i >= 0; i--) M[i] = (r[i] - (i < n - 1 ? A[i][i + 1] * M[i + 1] : 0)) / A[i][i];
  return [0, ...M, 0];
}
const momentAt = (Ls, ws, Ms, x) => { let x0 = 0; for (let j = 0; j < Ls.length; j++) { if (x <= x0 + Ls[j] + 1e-9) { const t = x - x0; return Ms[j] * (1 - t / Ls[j]) + Ms[j + 1] * t / Ls[j] + ws[j] * t * (Ls[j] - t) / 2; } x0 += Ls[j]; } return 0; };

for (const spans of [[6, 6, 6], [5, 7], [4, 6, 6, 5]]) {
  test(`continuous beam ${spans.join(' + ')} m: every live pattern matches the three-moment equation to 1e-9`, { skip: haveEngine ? false : `stiffness binary not found at ${BIN}` }, () => {
    const L = spans.reduce((a, c) => a + c, 0); let x = 0; const supports = [{ at: 0, type: 'pinned' }];
    for (const l of spans) { x += l; supports.push({ at: x, type: 'roller' }); }
    const { p } = beam({ start: [0, 0], end: [L, 0], width: 0.3, depth: 0.6, supports, sdl: 4, ll: 8, segments: 12 * spans.length, shear_deformation: false });
    const bm = beamModel.run(p); const res = beamResults.run({ output: runEngine(bm.engine), bm });
    assert.equal(bm.intervals.length, spans.length); assert.ok(bm.intervals.every(iv => !iv.overhang));
    const pats = Object.entries(res.combos).filter(([id]) => id.startsWith('U2'));
    assert.ok(pats.length >= (spans.length === 2 ? 3 : spans.length + 2), `patterns ${pats.map(q => q[0])}`);   // all, odd, even, adjacent pairs (two spans: adjacent = all)
    let worst = 0;
    for (const [id, c] of pats) {
      const loaded = id === 'U2' ? spans.map((_, i) => i) : Object.keys(c.factors).find(k => k.startsWith('L(')).slice(2, -1).split(',').map(Number);
      const ws = spans.map((_, j) => 1.2 * bm.loads.wD + (loaded.includes(j) ? 1.6 * bm.loads.wL : 0));
      const Ms = threeMoment(spans, ws);
      c.x.forEach((xx, i) => { const ref = momentAt(spans, ws, Ms, xx); worst = Math.max(worst, Math.abs(c.M[i] - ref) / Math.max(...Ms.map(Math.abs), 1)); });
    }
    assert.ok(worst < 1e-9, `worst relative moment error ${worst}`);
    // equilibrium: Σ reactions = Σ loads for the all-spans combination
    const tot = res.combos.U2.R.reduce((a, r) => a + r.F[2], 0); assert.ok(rel(tot, (1.2 * bm.loads.wD + 1.6 * bm.loads.wL) * L) < 1e-9);
  });
}

test('three equal spans: the classic coefficients (−0.100 wL² at B under full load; 0.101 wL² span-1 sagging with spans 1 and 3 loaded)', { skip: haveEngine ? false : `stiffness binary not found at ${BIN}` }, () => {
  // Euler; D only via unit_weight=0 and sdl, so wD is exact
  const { p } = beam({ start: [0, 0], end: [18, 0], width: 0.3, depth: 0.6, supports: [{ at: 0, type: 'pinned' }, { at: 6, type: 'roller' }, { at: 12, type: 'roller' }, { at: 18, type: 'roller' }], sdl: 10, ll: 0, unit_weight: 0, segments: 120, shear_deformation: false });
  const bm = beamModel.run(p); const res = beamResults.run({ output: runEngine(bm.engine), bm }); const D = res.cases.D;
  const iB = D.x.findIndex(x => Math.abs(x - 6) < 1e-9); assert.ok(rel(D.M[iB], -0.1 * 10 * 36) < 1e-9, `MB ${D.M[iB]}`);
  // reactions 0.4 wL and 1.1 wL
  assert.ok(rel(D.R[0].F[2], 0.4 * 60) < 1e-9 && rel(D.R[1].F[2], 1.1 * 60) < 1e-9);
});

for (const [ll, regions] of [[10, 1], [2, 2]]) test(`continuous beam design, L = ${ll} kN/m: ${regions} top region(s); every region bounded by inflection + extension; bottom bars per span; bars generated`, { skip: haveEngine ? false : `stiffness binary not found at ${BIN}` }, () => {
  // with heavy live load the 6.4.2(a) pattern (outer spans loaded) makes the middle span hog end to end, so the two support regions merge
  const { p } = beam({ start: [0, 0], end: [18, 0], width: 0.35, depth: 0.6, supports: [{ at: 0, type: 'pinned' }, { at: 6, type: 'roller' }, { at: 12, type: 'roller' }, { at: 18, type: 'roller' }], sdl: 8, ll, segments: 60 });
  const bm = beamModel.run(p); const res = beamResults.run({ output: runEngine(bm.engine), bm }); const des = rcBeamDesign.run({ p, res, bm });
  assert.equal(des.top.length, regions); assert.equal(des.top.reduce((a, r) => a + r.supports.length, 0), 2, 'the two interior supports are covered'); assert.equal(des.bottom.length, 3); assert.equal(des.shear.length, 3);
  const mid = res.combos['U2-odd'].M[res.combos['U2-odd'].x.findIndex(x => Math.abs(x - 9) < 1e-9)];
  assert.equal(mid < 0, regions === 1, `middle-span moment under spans 1 and 3 loaded: ${mid.toFixed(2)} kN·m`);
  for (const r of des.top) {
    assert.ok(r.inflection[0] !== null && r.inflection[1] !== null);
    assert.ok(Math.abs(r.x1 - r.inflection[1] - r.extension) < 1e-9 && r.extension >= des.d / 1000 - 1e-12 && r.extension >= 6 / 16 - 1e-12, 'extension = max(d, 12db, ℓn/16) past the inflection point');
    assert.ok(r.phiMn_kNm >= r.Mu - 1e-9);
  }
  for (const r of des.bottom) assert.ok(r.phiMn_kNm >= r.Mu - 1e-9);
  assert.ok(des.bottom[1].x0 < 6 && des.bottom[1].x0 >= 6 - 0.15 - 1e-9, 'interior bottom bars run 150 mm past the support');
  const out = beamBars.run({ p, design: des, beamId: 'CB' });
  assert.ok(out.bars.some(b => b.mark === 'T1') && out.bars.some(b => b.mark.startsWith('H')) && out.bars.filter(b => b.shape === 'stirrup').length > 30);
  assert.equal(out.bars.some(b => b.mark === 'T2'), regions === 2);
});
