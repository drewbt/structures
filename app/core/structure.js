// structure.js - the structural chain for one beam: geometry → section and material → loads →
// the stiffness engine's model → internal forces → design → reinforcement (FI-CONC-006 §13).
//
// Every step is a registered, versioned, pure function. The engine (drewbt/stiffness) runs in the
// local service, never in the browser; the browser builds the engine model, the service runs it and
// caches the result by the SHA-256 of the exact model text and of the engine binary.
//
// Units at the engine boundary are the engine's: kN, m, kN/m². Design is in N and mm (the code's SI
// form). Conversions are written out where they happen.

import { register } from './functions.js';
import * as ACI from './standards/aci318-19.js';
import { axisFrame, spread, hookedBar, closedLoop, roundPath } from './detail.js';

const num = (el, name, dflt) => { const p = el.params[name]; return p === undefined ? dflt : p.value; };

// ---- section and material ---------------------------------------------------------------------------
/** Gross rectangular section b × h (m). J by the Roark/Saint-Venant series approximation for a rectangle. */
export function rectSection(b, h) {
  const a = Math.max(b, h), c = Math.min(b, h);
  const J = a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4)));
  return { A: b * h, Iy: b * h ** 3 / 12, Iz: h * b ** 3 / 12, J, Av: 5 / 6 * b * h, source: 'Iy, Iz exact; J: Roark, Formulas for Stress and Strain, rectangle approximation (≈0.2% for a square); Av = 5/6 A (Timoshenko, rectangle)' };
}
/** Concrete per ACI 318-19 from f'c (MPa); ν = 0.2 assumed (ASSUMPTIONS A-14). E, G in kN/m². */
export function concrete(fc, unitWeight = 23.6, nu = 0.2) {
  const E = ACI.Ec(fc) * 1000; return { fc, E, G: E / (2 * (1 + nu)), nu, gamma: unitWeight, clause: 'ACI 318-19 19.2.2.1(b)' };
}

// ---- the beam's structural inputs, gathered from the model -----------------------------------------
function levelOf(model, el) { const l = model.get(el.parent); if (!l || l.type !== 'level') throw new Error(`${el.id}: parent is not a level`); return { elevation: num(l, 'elevation', 0), height: num(l, 'height', 3) }; }
export function beamInputs(model, el) {
  const lvl = levelOf(model, el);
  return {
    start: num(el, 'start'), end: num(el, 'end'), b: num(el, 'width', 0.3), h: num(el, 'depth', 0.6), zTop: lvl.elevation + num(el, 'top_offset', lvl.height),
    support_start: num(el, 'support_start', 'fixed'), support_end: num(el, 'support_end', 'free'), supports: num(el, 'supports', null),
    fc: num(el, 'fc', 28), fy: num(el, 'fy', 420), fyt: num(el, 'fyt', 420), unit_weight: num(el, 'unit_weight', 23.6),
    sdl: num(el, 'sdl', 0), ll: num(el, 'll', 0), segments: num(el, 'segments', 20), shear_deformation: num(el, 'shear_deformation', true),
    cover: num(el, 'cover', ACI.COVER_INTERIOR_BEAM / 1000), bar_main: num(el, 'bar_main', '#8'), bar_stirrup: num(el, 'bar_stirrup', '#3'), bar_hanger: num(el, 'bar_hanger', '#5'),
  };
}

const RESTRAINT = { fixed: [1, 1, 1, 1, 1, 1], pinned: [1, 1, 1, 1, 0, 0], roller: [0, 1, 1, 1, 0, 0], free: [0, 0, 0, 0, 0, 0] };

/** The support list of a beam: explicit `supports` [{at, type}] or the two ends. Sorted, validated. */
export function supportList(p, L) {
  const list = (p.supports && p.supports.length ? p.supports.map(s => ({ at: +s.at, type: s.type })) : [{ at: 0, type: p.support_start }, { at: L, type: p.support_end }]).filter(s => s.type !== 'free');
  for (const s of list) { if (!RESTRAINT[s.type]) throw new Error(`support "${s.type}" is fixed, pinned, roller or free`); if (!(s.at >= -1e-9 && s.at <= L + 1e-9)) throw new Error(`support at ${s.at} m lies off the beam (0–${L.toFixed(3)} m)`); }
  list.sort((a, b) => a.at - b.at);
  const vertical = list.length, fixed = list.some(s => s.type === 'fixed');
  if (!fixed && vertical < 2) throw new Error('a beam needs a fixed support or two vertical supports: as given it is a mechanism');
  return list;
}

/**
 * structure.beamModel 2.0.0: the engine's JSON model for a beam on any number of supports. Key points are
 * the beam ends and the supports; each interval between key points ("span", or "overhang" when one end is
 * a free beam end) is divided into an even number of Timoshenko segments. Cases: D on every segment, and one
 * live case L<i> per interval so ACI 6.4.2 patterns are exact superpositions.
 */
export const beamModel = register({
  name: 'structure.beamModel', version: '2.0.0',
  assumptions: ['prismatic gross concrete section (uncracked) for analysis stiffness', 'centroidal axis at mid-depth', 'loads uniform along the beam', 'reinforced-concrete unit weight 23.6 kN/m³ (150 pcf) unless the element states one: a customary US value, not a code value', 'Timoshenko shear deformation with Av = 5/6 b h unless shear_deformation is false', 'linear elastic, small displacement', 'when no support restrains axial movement (rollers only) the first support does', 'support restraints in the beam axes; beams parallel to x or y (skewed beams: fixed supports only)'],
  inputs: (model, el) => beamInputs(model, el),
  run(p) {
    const { start, end, b, h, zTop } = p;
    const L = Math.hypot(end[0] - start[0], end[1] - start[1]); if (!(L > 0)) throw new Error('beam has zero length');
    if (!(p.segments >= 1 && Number.isInteger(p.segments))) throw new Error('segments must be a positive integer');
    const sup = supportList(p, L);
    const keys = [...new Set([0, L, ...sup.map(s => s.at)].map(x => Math.round(x * 1e9) / 1e9))].sort((a, c) => a - c);
    const intervals = []; for (let k = 0; k + 1 < keys.length; k++) {
      const x0 = keys[k], x1 = keys[k + 1], s0 = sup.find(s => Math.abs(s.at - x0) < 1e-9), s1 = sup.find(s => Math.abs(s.at - x1) < 1e-9);
      intervals.push({ x0, x1, length: x1 - x0, overhang: !s0 || !s1, nseg: Math.max(2, 2 * Math.round(p.segments * (x1 - x0) / L / 2)) });
    }
    const xs = [0], segInterval = [];
    intervals.forEach((iv, k) => { for (let j = 1; j <= iv.nseg; j++) { xs.push(iv.x0 + iv.length * j / iv.nseg); segInterval.push(k); } iv.node0 = xs.length - 1 - iv.nseg; iv.node1 = xs.length - 1; });
    const sec = rectSection(b, h), mat = concrete(p.fc, p.unit_weight), zc = zTop - h / 2, F = axisFrame(start, end);
    const axialHeld = sup.some(s => s.type === 'fixed' || s.type === 'pinned');
    // RESTRAINT is in the beam's local axes [u axial, v lateral, w vertical, θu torsion, θv bending, θw lateral bending];
    // the engine's flags are global. A beam along y swaps x and y. A skewed beam can only take fixed supports here
    // (pinned and roller in a skewed local frame need inclined supports: owed).
    const alongX = Math.abs(F.ex[1]) < 1e-9, alongY = Math.abs(F.ex[0]) < 1e-9;
    if (!alongX && !alongY && sup.some(q => q.type !== 'fixed')) throw new Error('a beam skewed to the grid axes can only have fixed supports here (inclined pinned/roller supports are owed)');
    const toGlobal = loc => (alongX ? [...loc] : [loc[1], loc[0], loc[2], loc[4], loc[3], loc[5]]);
    const nodes = xs.map((x, i) => {
      const s = sup.find(q => Math.abs(q.at - x) < 1e-9); let r = s ? toGlobal(RESTRAINT[s.type]) : [...RESTRAINT.free];
      if (s && !axialHld(s) && !axialHeld && s === sup[0]) r[alongX ? 0 : 1] = 1;
      return { mark: `N${i}`, p: F.W(x, 0, zc), restrained: r };
    });
    function axialHld(s) { return s.type === 'fixed' || s.type === 'pinned'; }
    const sd = p.shear_deformation !== false;
    const members = xs.slice(1).map((_, i) => ({ mark: `S${i}`, a: i, b: i + 1, beam: true, area_m2: sec.A, Iy: sec.Iy, Iz: sec.Iz, J: sec.J, E: mat.E, G: mat.G, ...(sd ? { Avy: sec.Av, Avz: sec.Av } : {}) }));
    const wD = mat.gamma * b * h + p.sdl, wL = p.ll, n = members.length, zero = new Array(6 * (n + 1)).fill(0);
    const cases = [{ name: 'D', loads: zero, w: members.map(() => [0, 0, -wD]).flat() }];
    intervals.forEach((iv, k) => cases.push({ name: `L${k}`, loads: zero, w: members.map((_, i) => [0, 0, segInterval[i] === k ? -wL : 0]).flat() }));
    const engine = { youngs_modulus_kN_per_m2: mat.E, dofs_per_node: 6, nodes, members, cases };
    return { engine, L, section: sec, material: mat, loads: { wD, wL, selfweight: mat.gamma * b * h }, n, x: xs, supports: sup, intervals };
  },
});

/**
 * structure.beamResults 2.0.0: per case and per combination M, V, w at every node, V at both ends of every
 * segment, reactions at every support; strength combinations U1 = 1.4D and U2 = 1.2D + 1.6L over every
 * ACI 6.4.2 live pattern (U2 is all spans loaded); the strength envelope along the beam.
 * Signs: M sagging positive (= F.My at a segment's a-end, −F.My at its b-end), V = dM/dx, w up positive.
 */
export const beamResults = register({
  name: 'structure.beamResults', version: '2.0.0',
  assumptions: ['linear superposition of D and the per-interval L cases', 'ACI 318-19 5.3.1 strength combinations U1 = 1.4D, U2 = 1.2D + 1.6L with the 6.4.2 live patterns'],
  inputs: null,
  run({ output, bm }) {
    const n = bm.n, xs = bm.x, cases = {};
    for (const c of output.cases) {
      const M = [], V = [], w = [], Va = [], Vb = [];
      for (let i = 0; i <= n; i++) {
        w.push(c.d[6 * i + 2]);
        if (i < n) { M.push(c.F[12 * i + 4]); V.push(c.F[12 * i + 2]); } else { M.push(-c.F[12 * (n - 1) + 10]); V.push(-c.F[12 * (n - 1) + 8]); }
        if (i < n) { Va.push(c.F[12 * i + 2]); Vb.push(-c.F[12 * i + 8]); }
      }
      const R = bm.supports.map(s => { const i = xs.findIndex(x => Math.abs(x - s.at) < 1e-9); return { at: s.at, type: s.type, node: i, F: c.R.slice(6 * i, 6 * i + 6) }; });
      cases[c.name] = { x: xs, M, V, w, Va, Vb, R };
    }
    const nIv = bm.intervals.length;
    const combine = factors => {
      const out = { x: xs, M: xs.map(() => 0), V: xs.map(() => 0), w: xs.map(() => 0), Va: new Array(n).fill(0), Vb: new Array(n).fill(0), R: bm.supports.map(s => ({ at: s.at, type: s.type, F: [0, 0, 0, 0, 0, 0] })) };
      for (const [k, f] of Object.entries(factors)) {
        const names = k === 'L' ? Array.from({ length: nIv }, (_, i) => `L${i}`) : k.startsWith('L:') ? k.slice(2).split(',').map(i => `L${i}`) : [k];
        for (const nm of names) { const c = cases[nm]; for (let i = 0; i <= n; i++) { out.M[i] += f * c.M[i]; out.V[i] += f * c.V[i]; out.w[i] += f * c.w[i]; } for (let i = 0; i < n; i++) { out.Va[i] += f * c.Va[i]; out.Vb[i] += f * c.Vb[i]; } c.R.forEach((r, j) => { for (let q = 0; q < 6; q++) out.R[j].F[q] += f * r.F[q]; }); }
      }
      out.Mmax = Math.max(...out.M); out.Mmin = Math.min(...out.M); out.Vabs = Math.max(...out.Va.map(Math.abs), ...out.Vb.map(Math.abs)); out.wabs = Math.max(...out.w.map(Math.abs));
      out.R.start = out.R[0]?.F; out.R.end = out.R[out.R.length - 1]?.F;   // the first and last support, for display
      return out;
    };
    const combos = {};
    combos.U1 = { ...combine({ D: 1.4 }), factors: { D: 1.4 }, clause: '5.3.1 (5.3.1a)' };
    for (const pat of ACI.livePatterns(nIv)) {
      const id = pat.id === 'all' ? 'U2' : `U2-${pat.id}`, key = pat.id === 'all' ? 'L' : `L:${pat.spans.join(',')}`;
      combos[id] = { ...combine({ D: 1.2, [key]: 1.6 }), factors: { D: 1.2, [pat.id === 'all' ? 'L' : `L(${pat.spans.join(',')})`]: 1.6 }, clause: `5.3.1 (5.3.1b), ${pat.clause}`, strength: true };
    }
    combos.U1.strength = true;
    for (const sv of ACI.SERVICE) combos[sv.id] = { ...combine(sv.factors), factors: sv.factors, clause: 'service' };
    const strength = Object.entries(combos).filter(([, c]) => c.strength);
    const env = { Mmax: xs.map((_, i) => Math.max(...strength.map(([, c]) => c.M[i]))), Mmin: xs.map((_, i) => Math.min(...strength.map(([, c]) => c.M[i]))),
      Vseg: Array.from({ length: n }, (_, i) => Math.max(...strength.map(([, c]) => Math.max(Math.abs(c.Va[i]), Math.abs(c.Vb[i]))))) };
    const arg = f => strength.reduce((best, [id, c]) => (f(c) > f(combos[best]) ? id : best), strength[0][0]);
    env.Mpos = Math.max(0, ...env.Mmax); env.Mneg = Math.min(0, ...env.Mmin); env.Vu = Math.max(...env.Vseg);
    env.governs = { Mpos: arg(c => c.Mmax), Mneg: arg(c => -c.Mmin), Vu: arg(c => c.Vabs) };
    return { cases, combos, envelope: env };
  },
});

// ---- design ----------------------------------------------------------------------------------------
/** Flexural capacity of a rectangular section with tension steel As at depth d (N, mm). Whitney block, compression steel ignored. */
export function flexure({ b, d, As, fc, fy }) {
  const a = As * fy / (0.85 * fc * b), b1 = ACI.beta1(fc), c = a / b1;
  const epsT = 0.003 * (d - c) / c, { phi, class: cls } = ACI.phiFlexure(epsT, fy);
  const Mn = As * fy * (d - a / 2);   // N·mm
  return { a, c, beta1: b1, epsT, phi, class: cls, Mn, phiMn: phi * Mn, C: 0.85 * fc * a * b, T: As * fy };
}
/** Smallest As (mm²) with φMn ≥ Mu (N·mm), by the quadratic for a tension-controlled section; null if none exists. */
export function asRequired({ b, d, fc, fy, Mu }) {
  if (Mu <= 0) return 0;
  const phi = 0.9, k = fy / (2 * 0.85 * fc * b);   // Mu/φ = As fy d − As² fy k
  const disc = (fy * d) ** 2 - 4 * fy * k * Mu / phi; if (disc < 0) return null;
  return (fy * d - Math.sqrt(disc)) / (2 * fy * k);
}

/** Longitudinal bars for a moment at a section: count, capacity and check rows. */
function designFace({ b, d, fc, fy, main, cover, st, Mu_kNm, label }) {
  const Mu = Mu_kNm * 1e6, need = asRequired({ b, d, fc, fy, Mu });
  if (need === null) return { error: 'section too small for the moment (no tension-controlled solution)', Mu: Mu_kNm, checks: [{ name: `flexure ${label}`, clause: '22.3', demand: Mu_kNm, capacity: null, util: Infinity }] };
  const asMin = Mu > 0 ? ACI.AsMin(fc, fy, b, d) : 0, As_req = Math.max(need, asMin), n = Math.max(2, Math.ceil(As_req / main.area));
  const sClear = (b - 2 * cover - 2 * st.db - n * main.db) / (n - 1), sMin = ACI.clearSpacingMin(main.db), fl = flexure({ b, d, As: n * main.area, fc, fy });
  const checks = [];
  if (Mu > 0) checks.push({ name: `flexure ${label} (${n} ${main.id})`, clause: '9.5.1.1, 22.2, 21.2.2', demand: Mu_kNm, capacity: fl.phiMn / 1e6, util: Mu_kNm / (fl.phiMn / 1e6) });
  if (Mu > 0) checks.push({ name: `minimum steel ${label}`, clause: '9.6.1.2', demand: asMin, capacity: n * main.area, util: asMin / (n * main.area) });
  checks.push({ name: `bar spacing ${label}`, clause: '25.2.1', demand: sMin, capacity: sClear, util: sClear > 0 ? sMin / sClear : Infinity });
  if (Mu > 0) checks.push({ name: `net tensile strain ${label} (${fl.class})`, clause: '21.2.2, 9.3.3.1', demand: 0.004, capacity: fl.epsT, util: 0.004 / fl.epsT });
  return { Mu: Mu_kNm, As_req, As_min: asMin, n, bar: main.id, As: n * main.area, clear_spacing: sClear, clear_spacing_min: sMin, ...fl, phiMn_kNm: fl.phiMn / 1e6, checks };
}
/** x where an envelope array crosses zero between nodes i and j (linear). */
const zeroAt = (xs, ys, i, j) => xs[i] + (xs[j] - xs[i]) * ys[i] / (ys[i] - ys[j]);

/**
 * structure.rcBeamDesign 2.0.0 (ACI 318-19), for simply supported, continuous and cantilever beams:
 * top-bar regions over every support where the strength envelope hogs, each running past its inflection
 * points by max(d, 12db, ℓn/16) (9.7.3.8.4) and anchored by ld into fixed beam ends; bottom bars per
 * interval for its largest sagging moment, carried 150 mm past interior supports (9.7.3.8.2); stirrups per
 * interval; deflection per interval with Ie. Check rows {name, clause, demand, capacity, util}.
 */
export const rcBeamDesign = register({
  name: 'structure.rcBeamDesign', version: '2.0.0',
  assumptions: ['ACI 318-19 as encoded in standards/aci318-19.js (status unverified against printed text)', 'single layer of longitudinal bars each face; compression steel ignored in strength', 'two bars minimum each face as detailing (not a code requirement)', 'shear designed for the largest |Vu| in each interval (no reduction at d from the support)', 'deflection per interval: the analysis deflection scaled by Ig/Ie of that interval (uniform Ie), live load on all spans', 'top hangers (2 bars) where no top region runs: detailing, not counted in strength', 'normal-weight concrete, λ = 1; nominal max aggregate 19 mm'],
  inputs: null,
  run({ p, res, bm }) {
    const b = p.b * 1000, h = p.h * 1000, cover = p.cover * 1000, fc = p.fc, fy = p.fy, fyt = p.fyt, L = bm.L, xs = bm.x;
    const main = ACI.BARS[p.bar_main], st = ACI.BARS[p.bar_stirrup]; if (!main || !st) throw new Error('unknown bar designation');
    const d = h - cover - st.db - main.db / 2, env = res.envelope, checks = [];
    const ldTop = ACI.ld(main.db, fy, fc, { top: h > 300 }), ldBot = ACI.ld(main.db, fy, fc);
    // top regions, one per hogging support (merged where they overlap)
    let top = [];
    for (const s of bm.supports) {
      const i = xs.findIndex(x => Math.abs(x - s.at) < 1e-9); if (env.Mmin[i] >= -1e-9) continue;
      let a = i; while (a > 0 && env.Mmin[a - 1] < 0) a--; let c = i; while (c < xs.length - 1 && env.Mmin[c + 1] < 0) c++;
      const xL = a > 0 ? zeroAt(xs, env.Mmin, a - 1, a) : 0, xR = c < xs.length - 1 ? zeroAt(xs, env.Mmin, c, c + 1) : L;
      const Mu = -Math.min(...env.Mmin.slice(a, c + 1));
      const lnL = bm.intervals.find(iv => Math.abs(iv.x1 - s.at) < 1e-9)?.length ?? 0, lnR = bm.intervals.find(iv => Math.abs(iv.x0 - s.at) < 1e-9)?.length ?? 0;
      const ext = ACI.negExtension(d, main.db, Math.max(lnL, lnR) * 1000) / 1000;
      top.push({ support: s, x0: Math.max(0, xL - (a > 0 ? ext : 0)), x1: Math.min(L, xR + (c < xs.length - 1 ? ext : 0)), Mu, inflection: [a > 0 ? xL : null, c < xs.length - 1 ? xR : null], extension: ext });
    }
    top.sort((u, v) => u.x0 - v.x0);
    top = top.reduce((acc, r) => { const last = acc[acc.length - 1]; if (last && r.x0 <= last.x1) { last.x1 = Math.max(last.x1, r.x1); last.Mu = Math.max(last.Mu, r.Mu); last.supports.push(r.support); } else acc.push({ ...r, supports: [r.support] }); return acc; }, []);
    top.forEach((r, k) => { const f = designFace({ b, d, fc, fy, main, cover, st, Mu_kNm: r.Mu, label: `top T${k + 1} (${r.x0.toFixed(2)}–${r.x1.toFixed(2)} m)` }); Object.assign(r, f); checks.push(...f.checks); });
    // bottom bars per interval
    const bottom = bm.intervals.map((iv, k) => {
      const Mu = Math.max(0, ...env.Mmax.slice(iv.node0, iv.node1 + 1));
      const f = designFace({ b, d, fc, fy, main, cover, st, Mu_kNm: Mu, label: `bottom B${k + 1} (span ${k + 1})` }); checks.push(...f.checks);
      const into = ACI.POS_INTO_SUPPORT / 1000, interior0 = iv.x0 > 1e-9, interior1 = iv.x1 < L - 1e-9;
      return { interval: k, x0: interior0 ? Math.max(0, iv.x0 - into) : 0, x1: interior1 ? Math.min(L, iv.x1 + into) : L, ...f };
    });
    // shear per interval
    const shear = bm.intervals.map((iv, k) => {
      const segs = []; for (let i = iv.node0; i < iv.node1; i++) segs.push(env.Vseg[i]);
      const Vu = Math.max(...segs) * 1000, vc = ACI.Vc(fc, b, d), Av = 2 * st.area, VsReq = Math.max(0, Vu / ACI.PHI_SHEAR - vc);
      let sp = VsReq > 0 ? Av * fyt * d / VsReq : Infinity; const sMax = ACI.sMaxStirrup(fc, b, d, VsReq);
      sp = Math.min(sp, sMax, Av / Math.max(0.062 * Math.sqrt(fc) * b / fyt, 0.35 * b / fyt)); sp = Math.floor(sp / 25) * 25;
      if (!(sp > 0)) throw new Error(`span ${k + 1}: stirrup spacing below 25 mm, section too small for the shear`);
      const vs = ACI.Vs(Av, fyt, d, sp), phiVn = ACI.PHI_SHEAR * (vc + vs);
      checks.push({ name: `shear span ${k + 1} (${st.id} 2-leg @ ${sp} mm)`, clause: '9.5.1.1, 22.5', demand: Vu / 1000, capacity: phiVn / 1000, util: Vu / phiVn });
      checks.push({ name: `shear section limit span ${k + 1}`, clause: '22.5.1.2', demand: vs / 1000, capacity: ACI.VsMaxSection(fc, b, d) / 1000, util: vs / ACI.VsMaxSection(fc, b, d) });
      return { interval: k, x0: iv.x0, x1: iv.x1, Vu_kN: Vu / 1000, Vc_kN: vc / 1000, Av, s: sp, s_max: sMax, Vs_kN: vs / 1000, phiVn_kN: phiVn / 1000 };
    });
    // deflection per interval
    const Ecm = ACI.Ec(fc), nmod = ACI.Es / Ecm, Ig = b * h ** 3 / 12, Mcr = ACI.fr(fc) * Ig / (h / 2);
    const sDL = res.combos['S-DL'], sD = res.combos['S-D'], sL = res.combos['S-L'];
    const deflection = bm.intervals.map((iv, k) => {
      const idx = []; for (let i = iv.node0; i <= iv.node1; i++) idx.push(i);
      const iMax = idx.reduce((m, i) => (Math.abs(sDL.M[i]) > Math.abs(sDL.M[m]) ? i : m), idx[0]); const hog = sDL.M[iMax] < 0;
      const region = hog ? top.find(r => xs[iMax] >= r.x0 - 1e-9 && xs[iMax] <= r.x1 + 1e-9) : bottom[k];
      const As = region && !region.error ? region.As : 2 * main.area, Asc = (hog ? bottom[k] : top.find(r => xs[iMax] >= r.x0 && xs[iMax] <= r.x1))?.As ?? 2 * main.area;
      const rho = As / (b * d), kk = Math.sqrt(2 * rho * nmod + (rho * nmod) ** 2) - rho * nmod, Icr = b * (kk * d) ** 3 / 3 + nmod * As * (d - kk * d) ** 2;
      const Ma = Math.abs(sDL.M[iMax]) * 1e6, MaD = Math.max(...idx.map(i => Math.abs(sD.M[i]))) * 1e6;
      const IeDL = ACI.Ie(Ig, Icr, Mcr, Ma), IeD = ACI.Ie(Ig, Icr, Mcr, MaD);
      const wmax = c => Math.max(...idx.map(i => Math.abs(c.w[i])));
      const dD = wmax(sD) * Ig / IeD * 1000, dDL = wmax(sDL) * Ig / IeDL * 1000, dL = Math.max(0, dDL - dD), lam = ACI.lambdaDelta(Asc / (b * d));
      const limit = iv.length * 1000 / ACI.DEFLECTION_LIMIT_L.ratio;
      checks.push({ name: `immediate deflection due to L, span ${k + 1} (ℓ/${ACI.DEFLECTION_LIMIT_L.ratio})`, clause: '24.2.2, 24.2.3.5', demand: dL, capacity: limit, util: limit > 0 ? dL / limit : 0 });
      return { interval: k, Ig, Icr, Ie_DL: IeDL, Mcr_kNm: Mcr / 1e6, Ma_kNm: Ma / 1e6, immediate_D_mm: dD, immediate_DL_mm: dDL, immediate_L_mm: dL, lambda_delta: lam, long_term_D_mm: dD * (1 + lam), limit_L_mm: limit, tension_face: hog ? 'top' : 'bottom' };
    });
    const governing = checks.reduce((g, c) => (c.util > (g?.util ?? -1) ? c : g), null);
    // compatibility with 1.x readers: the worst top and bottom region as faces
    const worst = arr => arr.filter(r => !r.error).reduce((m, r) => (!m || r.Mu > m.Mu ? r : m), null) ?? arr[0];
    return { ruleset: ACI.RULESET, d, top, bottom, shear, deflection, anchorage: { top: ldTop, bottom: ldBot }, checks, governing, bars: { main, stirrup: st, hanger: ACI.BARS[p.bar_hanger] || main },
      faces: { top: top.length ? worst(top) : { Mu: 0, n: 0, bar: main.id, As: 0, phiMn_kNm: 0 }, bottom: worst(bottom) } };
  },
});

/**
 * structure.beamBars 2.0.0: the reinforcement as first-class bars in world coordinates, from the design's
 * regions: top bars per hogging region (anchored by ld into a fixed beam end), bottom bars per interval,
 * two top hangers wherever no top region runs (lapped 300 mm into a region), closed stirrups per interval
 * at that interval's spacing, the first at s/2 from the support.
 */
export const beamBars = register({
  name: 'structure.beamBars', version: '2.0.0',
  assumptions: ['straight longitudinal bars; anchorage beyond a fixed beam end drawn straight (hooks into the support are a detailing choice owed)', 'closed rectangular stirrups drawn without hooks; bend radii are fabrication data', 'bars centred on the stirrup inside face'],
  inputs: null,
  run({ p, design, beamId }) {
    const F = axisFrame(p.start, p.end), L = F.L, cv = p.cover, st = design.bars.stirrup.db / 1000, mb = design.bars.main.db / 1000, hb = design.bars.hanger.db / 1000;
    const zTop = p.zTop, zBot = p.zTop - p.h, bars = [], inner = p.b / 2 - cv - st - mb / 2;
    const fixedAt = x => { const s = (p.supports && p.supports.length ? p.supports : [{ at: 0, type: p.support_start }, { at: L, type: p.support_end }]).find(q => Math.abs(q.at - x) < 1e-9); return s?.type === 'fixed'; };
    const zT = zTop - cv - st - mb / 2, zB = zBot + cv + st + mb / 2;
    const clampEnd = (x, end) => (end === 0 ? Math.max(cv, x) : Math.min(L - cv, x));
    design.top.forEach((r, k) => {
      if (r.error) return;
      const anchor0 = r.x0 <= 1e-9 && fixedAt(0) ? design.anchorage.top / 1000 : 0, anchor1 = r.x1 >= L - 1e-9 && fixedAt(L) ? design.anchorage.top / 1000 : 0;
      const u0 = anchor0 ? cv - anchor0 : clampEnd(r.x0, 0), u1 = anchor1 ? L - cv + anchor1 : clampEnd(r.x1, L);
      spread(-inner, inner, r.n).forEach((v, i) => bars.push({ name: `${beamId}-T${k + 1}.${i + 1}`, shape: 'straight', designation: r.bar, diameter: mb, face: 'top', mark: `T${k + 1}`, path: roundPath([F.W(u0, v, zT), F.W(u1, v, zT)]), cover: cv, anchorage_start: anchor0, anchorage_end: anchor1, region: [r.x0, r.x1] }));
    });
    design.bottom.forEach((r, k) => {
      if (r.error) return;
      const u0 = clampEnd(r.x0, 0), u1 = clampEnd(r.x1, L);
      spread(-inner, inner, r.n).forEach((v, i) => bars.push({ name: `${beamId}-B${k + 1}.${i + 1}`, shape: 'straight', designation: r.bar, diameter: mb, face: 'bottom', mark: `B${k + 1}`, path: roundPath([F.W(u0, v, zB), F.W(u1, v, zB)]), cover: cv, region: [r.x0, r.x1] }));
    });
    // hangers where no top region runs
    const covered = design.top.filter(r => !r.error).map(r => [r.x0, r.x1]).sort((a, c) => a[0] - c[0]); const gaps = []; let cur = 0;
    for (const [a, c] of covered) { if (a > cur + 1e-6) gaps.push([cur, a]); cur = Math.max(cur, c); } if (cur < L - 1e-6) gaps.push([cur, L]);
    const lap = 0.3, ih = p.b / 2 - cv - st - hb / 2;
    gaps.forEach(([a, c], k) => { const u0 = a <= 1e-9 ? cv : a - lap, u1 = c >= L - 1e-9 ? L - cv : c + lap; [-ih, ih].forEach((v, i) => bars.push({ name: `${beamId}-H${k + 1}.${i + 1}`, shape: 'straight', designation: design.bars.hanger.id, diameter: hb, face: 'top', mark: `H${k + 1}`, path: roundPath([F.W(Math.max(cv, u0), v, zTop - cv - st - hb / 2), F.W(Math.min(L - cv, u1), v, zTop - cv - st - hb / 2)]), cover: cv, role: 'hanger (detailing, not counted in strength)' })); });
    // stirrups per interval
    const hw = p.b / 2 - cv - st / 2, zt = zTop - cv - st / 2, zb = zBot + cv + st / 2; let sNo = 0;
    for (const sh of design.shear) {
      const s = sh.s / 1000;
      for (let u = sh.x0 + s / 2; u <= sh.x1 - s / 2 + 1e-9 && u <= L - cv; u += s) {
        if (u < cv) continue;
        sNo++; bars.push({ name: `${beamId}-S${sNo}`, shape: 'stirrup', designation: design.bars.stirrup.id, diameter: st, mark: `S${sh.interval + 1}`, path: roundPath(closedLoop([F.W(u, -hw, zb), F.W(u, hw, zb), F.W(u, hw, zt), F.W(u, -hw, zt)])), cover: cv, spacing: s });
      }
    }
    return { bars, count: bars.length };
  },
});
