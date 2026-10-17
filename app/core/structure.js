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
    support_start: num(el, 'support_start', 'fixed'), support_end: num(el, 'support_end', 'free'),
    fc: num(el, 'fc', 28), fy: num(el, 'fy', 420), fyt: num(el, 'fyt', 420), unit_weight: num(el, 'unit_weight', 23.6),
    sdl: num(el, 'sdl', 0), ll: num(el, 'll', 0), segments: num(el, 'segments', 20),
    cover: num(el, 'cover', ACI.COVER_INTERIOR_BEAM / 1000), bar_main: num(el, 'bar_main', '#8'), bar_stirrup: num(el, 'bar_stirrup', '#3'),
  };
}

const RESTRAINT = { fixed: [1, 1, 1, 1, 1, 1], pinned: [1, 1, 1, 1, 0, 0], roller: [0, 1, 1, 1, 0, 0], free: [0, 0, 0, 0, 0, 0] };

/**
 * structure.beamModel: the engine's JSON model (stiffness io.h schema) for one beam: n equal
 * Timoshenko segments along the centroid, end restraints from the support types, two load cases
 * D (self-weight γ·b·h + superimposed dead) and L (imposed), as global uniform member loads in kN/m.
 */
export const beamModel = register({
  name: 'structure.beamModel', version: '1.0.0',
  assumptions: ['prismatic gross concrete section (uncracked) for analysis stiffness', 'centroidal axis at mid-depth', 'loads uniform along the beam', 'reinforced-concrete unit weight 23.6 kN/m³ (150 pcf) unless the element states one: a customary US value, not a code value', 'Timoshenko shear deformation with Av = 5/6 b h', 'linear elastic, small displacement'],
  inputs: (model, el) => beamInputs(model, el),
  run(p) {
    const { start, end, b, h, zTop, segments: n } = p;
    const L = Math.hypot(end[0] - start[0], end[1] - start[1]); if (!(L > 0)) throw new Error('beam has zero length');
    if (!(n >= 1 && Number.isInteger(n))) throw new Error('segments must be a positive integer');
    for (const s of [p.support_start, p.support_end]) if (!RESTRAINT[s]) throw new Error(`support "${s}" is fixed, pinned, roller or free`);
    if (p.support_start === 'free' && p.support_end === 'free') throw new Error('a beam free at both ends is a mechanism');
    const sec = rectSection(b, h), mat = concrete(p.fc, p.unit_weight), zc = zTop - h / 2;
    const nodes = [];
    for (let i = 0; i <= n; i++) { const t = i / n; const r = i === 0 ? RESTRAINT[p.support_start] : i === n ? RESTRAINT[p.support_end] : RESTRAINT.free; nodes.push({ mark: `N${i}`, p: [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t, zc], restrained: r }); }
    const members = []; for (let i = 0; i < n; i++) members.push({ mark: `S${i}`, a: i, b: i + 1, beam: true, area_m2: sec.A, Iy: sec.Iy, Iz: sec.Iz, J: sec.J, E: mat.E, G: mat.G, Avy: sec.Av, Avz: sec.Av });
    const wD = mat.gamma * b * h + p.sdl, wL = p.ll;
    const zero = new Array(6 * (n + 1)).fill(0);
    const engine = { youngs_modulus_kN_per_m2: mat.E, dofs_per_node: 6, nodes, members,
      cases: [{ name: 'D', loads: zero, w: Array.from({ length: n }, () => [0, 0, -wD]).flat() }, { name: 'L', loads: zero, w: Array.from({ length: n }, () => [0, 0, -wL]).flat() }] };
    return { engine, L, section: sec, material: mat, loads: { wD, wL, selfweight: mat.gamma * b * h }, n };
  },
});

/**
 * structure.beamResults: internal forces along the beam from the engine's output, per case and per
 * combination (linear superposition is exact for this linear analysis). Signs: M sagging positive
 * (= F.My at a segment's a-end, = −F.My at its b-end), V = dM/dx (= F.Vz at the a-end), w deflection
 * (engine d.z), R the reactions. Verified on the engine with a simply supported beam (IMPLEMENTATION_LOG §4).
 */
export const beamResults = register({
  name: 'structure.beamResults', version: '1.0.0',
  assumptions: ['linear superposition of cases D and L', 'ACI 318-19 5.3.1 strength combinations U1 = 1.4D, U2 = 1.2D + 1.6L'],
  inputs: null,
  run({ output, n, L }) {
    const cases = {};
    for (const c of output.cases) {
      const x = [], M = [], V = [], w = [];
      for (let i = 0; i <= n; i++) {
        x.push(L * i / n); w.push(c.d[6 * i + 2]);
        if (i < n) { M.push(c.F[12 * i + 4]); V.push(c.F[12 * i + 2]); } else { M.push(-c.F[12 * (n - 1) + 10]); V.push(-c.F[12 * (n - 1) + 8]); }
      }
      const R = { start: c.R.slice(0, 6), end: c.R.slice(6 * n, 6 * n + 6) };
      cases[c.name] = { x, M, V, w, R };
    }
    const combine = (factors) => {
      const pick = k => cases[k]; const x = cases.D.x; const out = { x, M: x.map(() => 0), V: x.map(() => 0), w: x.map(() => 0), R: { start: [0, 0, 0, 0, 0, 0], end: [0, 0, 0, 0, 0, 0] } };
      for (const [k, f] of Object.entries(factors)) { const c = pick(k); for (let i = 0; i < x.length; i++) { out.M[i] += f * c.M[i]; out.V[i] += f * c.V[i]; out.w[i] += f * c.w[i]; } for (let j = 0; j < 6; j++) { out.R.start[j] += f * c.R.start[j]; out.R.end[j] += f * c.R.end[j]; } }
      out.Mmax = Math.max(...out.M); out.Mmin = Math.min(...out.M); out.Vabs = Math.max(...out.V.map(Math.abs)); out.wabs = Math.max(...out.w.map(Math.abs));
      return out;
    };
    const combos = {}; for (const c of [...ACI.COMBINATIONS, ...ACI.SERVICE]) combos[c.id] = { ...combine(c.factors), factors: c.factors, clause: c.clause };
    const strength = ACI.COMBINATIONS.map(c => combos[c.id]);
    const env = { Mpos: Math.max(0, ...strength.map(c => c.Mmax)), Mneg: Math.min(0, ...strength.map(c => c.Mmin)), Vu: Math.max(...strength.map(c => c.Vabs)),
      governs: { Mpos: ACI.COMBINATIONS[strength.findIndex(c => c.Mmax === Math.max(...strength.map(s => s.Mmax)))].id, Mneg: ACI.COMBINATIONS[strength.findIndex(c => c.Mmin === Math.min(...strength.map(s => s.Mmin)))].id, Vu: ACI.COMBINATIONS[strength.findIndex(c => c.Vabs === Math.max(...strength.map(s => s.Vabs)))].id } };
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

/**
 * structure.rcBeamDesign (ACI 318-19): longitudinal bars for the governing sagging and hogging
 * strength moments, stirrups for the governing shear, development lengths, and the immediate and
 * long-term deflection under service loads with Ie. Returns check rows {name, clause, demand, capacity,
 * util} — utilisation, never pass/fail (stiffness CONTRACT §3).
 */
export const rcBeamDesign = register({
  name: 'structure.rcBeamDesign', version: '1.0.0',
  assumptions: ['ACI 318-19 as encoded in standards/aci318-19.js (status unverified against printed text)', 'single layer of longitudinal bars each face; compression steel ignored in strength', 'two #-bars minimum each face as detailing (not a code requirement)', 'shear designed for the largest |Vu| anywhere (no reduction at d from the support)', 'stirrups provided along the whole beam at one spacing', 'deflection: the analysis deflection scaled by Ig/Ie of the governing section (uniform Ie along the member)', 'normal-weight concrete, λ = 1; nominal max aggregate 19 mm'],
  inputs: null,
  run({ p, res, L }) {
    const b = p.b * 1000, h = p.h * 1000, cover = p.cover * 1000, fc = p.fc, fy = p.fy, fyt = p.fyt;
    const main = ACI.BARS[p.bar_main], st = ACI.BARS[p.bar_stirrup]; if (!main || !st) throw new Error('unknown bar designation');
    const d = h - cover - st.db - main.db / 2;
    const checks = []; const faces = {};
    for (const [face, Mu_kNm] of [['bottom', res.envelope.Mpos], ['top', -res.envelope.Mneg]]) {
      const Mu = Mu_kNm * 1e6;   // kN·m → N·mm
      const need = asRequired({ b, d, fc, fy, Mu });
      if (need === null) { faces[face] = { error: 'section too small for the moment (no tension-controlled solution)', Mu: Mu_kNm }; checks.push({ name: `flexure ${face}`, clause: '22.3', demand: Mu_kNm, capacity: null, util: Infinity }); continue; }
      const asMin = Mu > 0 ? ACI.AsMin(fc, fy, b, d) : 0;
      const As_req = Math.max(need, asMin);
      let nb = Math.max(2, Math.ceil(As_req / main.area));
      const sClear = (b - 2 * cover - 2 * st.db - nb * main.db) / (nb - 1);
      const sMin = ACI.clearSpacingMin(main.db);
      const fl = flexure({ b, d, As: nb * main.area, fc, fy });
      faces[face] = { Mu: Mu_kNm, As_req, As_min: asMin, n: nb, bar: main.id, As: nb * main.area, clear_spacing: sClear, clear_spacing_min: sMin, ...fl, phiMn_kNm: fl.phiMn / 1e6 };
      if (Mu > 0) checks.push({ name: `flexure ${face} (${nb} ${main.id})`, clause: '9.5.1.1, 22.2, 21.2.2', demand: Mu_kNm, capacity: fl.phiMn / 1e6, util: Mu_kNm / (fl.phiMn / 1e6) });
      if (Mu > 0) checks.push({ name: `minimum steel ${face}`, clause: '9.6.1.2', demand: asMin, capacity: nb * main.area, util: asMin / (nb * main.area) });
      checks.push({ name: `bar spacing ${face}`, clause: '25.2.1', demand: sMin, capacity: sClear, util: sClear > 0 ? sMin / sClear : Infinity });
      if (Mu > 0) checks.push({ name: `net tensile strain ${face} (${fl.class})`, clause: '21.2.2, 9.3.3.1', demand: 0.004, capacity: fl.epsT, util: 0.004 / fl.epsT });
    }
    // shear
    const Vu = res.envelope.Vu * 1000;   // kN → N
    const vc = ACI.Vc(fc, b, d), Av = 2 * st.area;
    const VsReq = Math.max(0, Vu / ACI.PHI_SHEAR - vc);
    let s = VsReq > 0 ? Av * fyt * d / VsReq : Infinity;
    const sMax = ACI.sMaxStirrup(fc, b, d, VsReq);
    s = Math.min(s, sMax);
    const sAvMin = Av / Math.max(0.062 * Math.sqrt(fc) * b / fyt, 0.35 * b / fyt);   // spacing at which Av = Av,min
    s = Math.min(s, sAvMin);
    s = Math.floor(s / 25) * 25;   // detailing: round down to 25 mm
    if (!(s > 0)) throw new Error('stirrup spacing below 25 mm: section too small for the shear');
    const vs = ACI.Vs(Av, fyt, d, s), phiVn = ACI.PHI_SHEAR * (vc + vs);
    checks.push({ name: `shear (${st.id} 2-leg @ ${s} mm)`, clause: '9.5.1.1, 22.5', demand: Vu / 1000, capacity: phiVn / 1000, util: Vu / phiVn });
    checks.push({ name: 'shear section limit', clause: '22.5.1.2', demand: vs / 1000, capacity: ACI.VsMaxSection(fc, b, d) / 1000, util: vs / ACI.VsMaxSection(fc, b, d) });
    checks.push({ name: 'stirrup spacing', clause: '9.7.6.2.2', demand: s, capacity: sMax, util: s / sMax });
    const shear = { Vu_kN: Vu / 1000, Vc_kN: vc / 1000, Av, s, s_max: sMax, Vs_kN: vs / 1000, phiVn_kN: phiVn / 1000 };
    // deflection (service): Ie per 24.2.3.5 at the section of the largest service moment
    const Ecm = ACI.Ec(fc), n_ = ACI.Es / Ecm, Ig = b * h ** 3 / 12, Mcr = ACI.fr(fc) * Ig / (h / 2);   // N·mm
    const sDL = res.combos['S-DL'], sD = res.combos['S-D'], sL = res.combos['S-L'];
    const Ma = Math.max(Math.abs(sDL.Mmax), Math.abs(sDL.Mmin)) * 1e6;
    const tensionFace = Math.abs(sDL.Mmin) > Math.abs(sDL.Mmax) ? 'top' : 'bottom';
    const As = faces[tensionFace]?.As ?? 0, Asc = faces[tensionFace === 'top' ? 'bottom' : 'top']?.As ?? 0;
    const rho = As / (b * d), k = Math.sqrt(2 * rho * n_ + (rho * n_) ** 2) - rho * n_;
    const Icr = b * (k * d) ** 3 / 3 + n_ * As * (d - k * d) ** 2;
    const IeDL = ACI.Ie(Ig, Icr, Mcr, Ma), MaD = Math.max(Math.abs(sD.Mmax), Math.abs(sD.Mmin)) * 1e6, IeD = ACI.Ie(Ig, Icr, Mcr, MaD);
    const dD = sD.wabs * Ig / IeD * 1000, dDL = sDL.wabs * Ig / IeDL * 1000, dL = Math.max(0, dDL - dD);   // mm
    const lamD = ACI.lambdaDelta(Asc / (b * d));
    const span = L * 1000, limit = span / ACI.DEFLECTION_LIMIT_L.ratio;
    checks.push({ name: `immediate deflection due to L (ℓ/${ACI.DEFLECTION_LIMIT_L.ratio})`, clause: '24.2.2, 24.2.3.5', demand: dL, capacity: limit, util: limit > 0 ? dL / limit : 0 });
    const deflection = { Ig, Icr, Mcr_kNm: Mcr / 1e6, Ma_kNm: Ma / 1e6, Ie_D: IeD, Ie_DL: IeDL, immediate_D_mm: dD, immediate_DL_mm: dDL, immediate_L_mm: dL, lambda_delta: lamD, long_term_D_mm: dD * (1 + lamD), limit_L_mm: limit, tension_face: tensionFace };
    // development
    const anchorage = { top: ACI.ld(main.db, fy, fc, { top: h - d > 0 && h > 300 }), bottom: ACI.ld(main.db, fy, fc) };
    const govern = checks.reduce((g, c) => (c.util > (g?.util ?? -1) ? c : g), null);
    return { ruleset: ACI.RULESET, d, faces, shear, deflection, anchorage, checks, governing: govern, bars: { main, stirrup: st } };
  },
});

/**
 * structure.beamBars: the reinforcement as first-class parametric bars, in world coordinates.
 * Longitudinal bars on each face at the design's count, evenly spaced between stirrup legs; a bar
 * runs the length less end cover, extended by its development length into a fixed or pinned support
 * where that face is in tension there (the extension enters the support, which is not modelled here).
 * Stirrups as closed rectangles at the design spacing, the first at s/2 from each end.
 */
export const beamBars = register({
  name: 'structure.beamBars', version: '1.0.0',
  assumptions: ['straight longitudinal bars; anchorage beyond the beam end drawn straight (hooks owed)', 'closed rectangular stirrups drawn without hooks; bend radii are fabrication data (owed)', 'bars centred on the stirrup inside face'],
  inputs: null,
  run({ p, design, beamId }) {
    const L = Math.hypot(p.end[0] - p.start[0], p.end[1] - p.start[1]);
    const ex = [(p.end[0] - p.start[0]) / L, (p.end[1] - p.start[1]) / L], ey = [-ex[1], ex[0]];
    const cv = p.cover, st = design.bars.stirrup.db / 1000, mb = design.bars.main.db / 1000;
    const W = (u, v, z) => [p.start[0] + ex[0] * u + ey[0] * v, p.start[1] + ex[1] * u + ey[1] * v, z];
    const zTop = p.zTop, zBot = p.zTop - p.h, bars = [];
    const inner = p.b / 2 - cv - st - mb / 2;   // bar centre offset from the axis
    let mark = 1;
    for (const face of ['top', 'bottom']) {
      const f = design.faces[face]; if (!f || f.error) continue;
      const z = face === 'top' ? zTop - cv - st - mb / 2 : zBot + cv + st + mb / 2;
      const anch = design.anchorage[face] / 1000;
      const extStart = face === 'top' && p.support_start === 'fixed' ? anch : 0, extEnd = face === 'top' && p.support_end === 'fixed' ? anch : 0;
      for (let i = 0; i < f.n; i++) {
        const v = f.n === 1 ? 0 : -inner + 2 * inner * i / (f.n - 1);
        bars.push({ name: `${beamId}-${face === 'top' ? 'T' : 'B'}${i + 1}`, shape: 'straight', designation: f.bar, diameter: mb, face, mark: `${face === 'top' ? 'T' : 'B'}${mark}`,
          path: [W(cv - extStart, v, z), W(L - cv + extEnd, v, z)], cover: cv, anchorage_start: extStart, anchorage_end: extEnd });
      }
      mark++;
    }
    const s = design.shear.s / 1000, nSt = Math.max(2, Math.floor((L - s) / s) + 1);
    const hw = p.b / 2 - cv - st / 2, zt = zTop - cv - st / 2, zb = zBot + cv + st / 2;
    for (let i = 0; i < nSt; i++) {
      const u = s / 2 + i * s; if (u > L - cv) break;
      bars.push({ name: `${beamId}-S${i + 1}`, shape: 'stirrup', designation: design.bars.stirrup.id, diameter: st, mark: `S${mark}`,
        path: [W(u, -hw, zb), W(u, hw, zb), W(u, hw, zt), W(u, -hw, zt), W(u, -hw, zb)], cover: cv, spacing: s });
    }
    return { bars, count: bars.length };
  },
});
