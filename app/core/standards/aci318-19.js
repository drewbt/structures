// aci318-19.js - ACI 318-19 (Building Code Requirements for Structural Concrete), SI edition, as
// data and small pure functions. Every value names its clause. Units: MPa and mm unless stated.
//
// SOURCE STATUS: written from the code's provisions as known to the author on 2026-10-17; the code
// text could not be opened from this environment. Each clause reference must be checked against the
// printed code before a result is relied on; until then the ruleset's status is "unverified"
// (FUNCTION_REGISTRY.md). Jurisdiction: chosen because the first public-record project, Fallingwater,
// is in Pennsylvania, USA. The 1936 design predates the code; checks are a present-day assessment.

export const RULESET = { id: 'ACI 318-19', edition: '2019 (SI units)', status: 'unverified against printed text', jurisdiction: 'USA' };

/** 5.3.1 — strength load combinations used here (dead D, live L only). */
export const COMBINATIONS = [
  { id: 'U1', clause: '5.3.1 (5.3.1a)', factors: { D: 1.4 } },
  { id: 'U2', clause: '5.3.1 (5.3.1b)', factors: { D: 1.2, L: 1.6 } },
];
export const SERVICE = [{ id: 'S-D', factors: { D: 1.0 } }, { id: 'S-DL', factors: { D: 1.0, L: 1.0 } }, { id: 'S-L', factors: { L: 1.0 } }];

/** 19.2.2.1(b) — modulus of elasticity of normal-weight concrete, MPa. */
export const Ec = fc => 4700 * Math.sqrt(fc);
/** 19.2.3.1 — modulus of rupture, MPa (λ = 1 normal weight). */
export const fr = (fc, lambda = 1) => 0.62 * lambda * Math.sqrt(fc);
/** 20.2.2.2 — modulus of elasticity of non-prestressed reinforcement, MPa. */
export const Es = 200000;
/** 22.2.2.4.3 (Table 22.2.2.4.3) — β1. */
export function beta1(fc) {
  if (fc <= 28) return 0.85;
  if (fc >= 55) return 0.65;
  return 0.85 - 0.05 * (fc - 28) / 7;
}
/** 21.2.2 (Table 21.2.2) — φ for moment by net tensile strain, with εty = fy/Es. */
export function phiFlexure(epsT, fy) {
  const ety = fy / Es;
  if (epsT >= ety + 0.003) return { phi: 0.90, class: 'tension-controlled' };
  if (epsT <= ety) return { phi: 0.65, class: 'compression-controlled' };
  return { phi: 0.65 + 0.25 * (epsT - ety) / 0.003, class: 'transition' };
}
/** 21.2.1 — φ for shear. */
export const PHI_SHEAR = 0.75;
/** 9.6.1.2 — minimum flexural reinforcement, mm². */
export const AsMin = (fc, fy, bw, d) => Math.max(0.25 * Math.sqrt(fc) / fy, 1.4 / fy) * bw * d;
/** 22.5.5.1 (Table 22.5.5.1 (a), applicable when Av ≥ Av,min) — Vc in N. */
export const Vc = (fc, bw, d, lambda = 1) => 0.17 * lambda * Math.sqrt(fc) * bw * d;
/** 22.5.8.5.3 — Vs of vertical stirrups, N. */
export const Vs = (Av, fyt, d, s) => Av * fyt * d / s;
/** 9.6.3.4 — Av,min per spacing s, mm². */
export const AvMin = (fc, bw, s, fyt) => Math.max(0.062 * Math.sqrt(fc) * bw * s / fyt, 0.35 * bw * s / fyt);
/** 9.7.6.2.2 — maximum stirrup spacing, mm. */
export const sMaxStirrup = (fc, bw, d, VsN) => (VsN <= 0.33 * Math.sqrt(fc) * bw * d ? Math.min(d / 2, 600) : Math.min(d / 4, 300));
/** 22.5.1.2 — upper limit on Vs: Vs ≤ 0.66 √fc bw d (section must be enlarged otherwise), N. */
export const VsMaxSection = (fc, bw, d) => 0.66 * Math.sqrt(fc) * bw * d;
/** 25.2.1 — minimum clear spacing of parallel bars in a layer, mm (dagg = nominal max aggregate). */
export const clearSpacingMin = (db, dagg = 19) => Math.max(25, db, 4 / 3 * dagg);
/** 25.4.2.3 (Table 25.4.2.3, simplified, clear spacing ≥ db and stirrups) — development length of a deformed bar in tension, mm. */
export function ld(db, fy, fc, { top = false, lambda = 1, psiE = 1, psiG = fy <= 420 ? 1.0 : fy <= 550 ? 1.15 : 1.3 } = {}) {
  const psiT = top ? 1.3 : 1.0;
  const divisor = db <= 19.1 ? 2.1 : 1.7;   // #6 and smaller vs #7 and larger
  return Math.max(fy * psiT * psiE * psiG / (divisor * lambda * Math.sqrt(fc)) * db, 300);   // 25.4.2.1(b): ≥ 300 mm
}
/** 24.2.2 (Table 24.2.2) — limit for immediate deflection due to L, floors not supporting elements likely to be damaged. */
export const DEFLECTION_LIMIT_L = { ratio: 360, clause: '24.2.2 (Table 24.2.2)' };
/** 24.2.3.5 (Table 24.2.3.5) — effective moment of inertia, for Ma > (2/3) Mcr. */
export function Ie(Ig, Icr, Mcr, Ma) {
  if (Ma <= 2 / 3 * Mcr) return Ig;
  return Icr / (1 - Math.pow(2 / 3 * Mcr / Ma, 2) * (1 - Icr / Ig));
}
/** 24.2.4.1.1 — long-term multiplier λΔ = ξ / (1 + 50 ρ'), ξ = 2.0 for 5 years or more (Table 24.2.4.1.3). */
export const lambdaDelta = (rhoPrime, xi = 2.0) => xi / (1 + 50 * rhoPrime);
/** 20.5.1.3.1 (Table 20.5.1.3.1) — specified cover, cast-in-place, not exposed to weather or in contact with ground, beams: 40 mm. */
export const COVER_INTERIOR_BEAM = 40;

/** ASTM A615 / A706 inch-pound bar designations: nominal diameter and area (exact inch values converted). */
const IN = 25.4;
export const BARS = Object.fromEntries([
  ['#3', 0.375, 0.11], ['#4', 0.500, 0.20], ['#5', 0.625, 0.31], ['#6', 0.750, 0.44], ['#7', 0.875, 0.60],
  ['#8', 1.000, 0.79], ['#9', 1.128, 1.00], ['#10', 1.270, 1.27], ['#11', 1.410, 1.56],
].map(([id, d, a]) => [id, { id, db: d * IN, area: a * IN * IN, source: 'ASTM A615/A615M Table 1 (nominal dimensions)' }]));

// ---- live-load patterning --------------------------------------------------------------------------
/** 6.4.2 — factored L on the span and alternate spans (max +M), on adjacent spans only (max −M at a support). Also all spans. */
export function livePatterns(nSpans) {
  const all = Array.from({ length: nSpans }, (_, i) => i), pats = [{ id: 'all', spans: all, clause: '6.4.2 (all spans)' }];
  if (nSpans > 1) {
    pats.push({ id: 'odd', spans: all.filter(i => i % 2 === 0), clause: '6.4.2(a)' }, { id: 'even', spans: all.filter(i => i % 2 === 1), clause: '6.4.2(a)' });
    for (let j = 1; j < nSpans; j++) pats.push({ id: `adj${j}`, spans: [j - 1, j], clause: '6.4.2(b)' });
  }
  return pats.filter((p, k, a) => p.spans.length && a.findIndex(q => q.spans.join() === p.spans.join()) === k);
}

// ---- two-way slabs -----------------------------------------------------------------------------
/** 8.3.1.1 (Table 8.3.1.1), fy = 420 MPa, slabs without interior beams: minimum h (mm) from the clear span ℓn (mm). */
export function slabMinThickness(lnMm, { drops, exterior, edgeBeams = false }) {
  const div = drops ? (exterior && !edgeBeams ? 33 : 36) : (exterior && !edgeBeams ? 30 : 33);
  return { h: Math.max(lnMm / div, drops ? 100 : 125), divisor: div, clause: '8.3.1.1 (Table 8.3.1.1), 8.3.1.1(a)/(b)' };
}
/** 8.2.4 — a drop panel used to reduce slab steel or thickness projects ≥ h/4 below the slab and extends ≥ ℓ/6 each way from the column centreline. */
export const DROP_PANEL = { projectionMin: h => h / 4, extentMin: l => l / 6, clause: '8.2.4' };
/** 8.6.1.1 (Table 8.6.1.1 via 24.4.3.2) — minimum slab flexural steel, Grade 420 deformed bars: 0.0018 Ag. */
export const SLAB_AS_MIN_RATIO = 0.0018;
/** 8.7.2.2 — maximum bar spacing at critical sections of a two-way slab: min(2h, 450 mm). */
export const slabMaxSpacing = h => Math.min(2 * h, 450);
/** 8.10.2 — Direct Design Method applicability (each limit returned with its clause). */
export function ddmLimits({ spansX, spansY, l1, l2, qD, qL }) {
  const succ = a => a.every((x, i) => i === 0 || Math.abs(x - a[i - 1]) <= Math.max(x, a[i - 1]) / 3);
  return [
    { clause: '8.10.2.1', text: '≥ 3 continuous spans each direction', ok: spansX.length >= 3 && spansY.length >= 3 },
    { clause: '8.10.2.2', text: 'successive spans differ by ≤ 1/3 of the longer', ok: succ(spansX) && succ(spansY) },
    { clause: '8.10.2.3', text: 'panel long/short ≤ 2', ok: Math.max(l1, l2) / Math.min(l1, l2) <= 2 },
    { clause: '8.10.2.6', text: 'unfactored L ≤ 2 D', ok: qL <= 2 * qD },
  ];
}
/** 8.10.3.2 — total factored static moment M0 = qu ℓ2 ℓn² / 8, with ℓn ≥ 0.65 ℓ1 (8.10.3.2.1). */
export const M0 = (qu, l2, ln, l1) => qu * l2 * Math.max(ln, 0.65 * l1) ** 2 / 8;
/** 8.10.4.1 / 8.10.4.2 (Table 8.10.4.2, flat plates and flat slabs without beams between interior supports and without edge beams). */
export const DDM_LONGITUDINAL = {
  interior: { neg: 0.65, pos: 0.35, clause: '8.10.4.1' },
  end: { extNeg: 0.26, pos: 0.52, intNeg: 0.70, clause: '8.10.4.2 (Table 8.10.4.2, no edge beam)' },
};
/** 8.10.5 — column strip shares with αf1 ℓ2/ℓ1 = 0 (no beams) and βt = 0 (no edge beam). */
export const DDM_COLUMN_STRIP = { intNeg: 0.75, extNeg: 1.00, pos: 0.60, clause: '8.10.5.1, 8.10.5.2, 8.10.5.5' };
/** 8.4.1.5 — column strip width each side of the column centreline: 0.25 min(ℓ1, ℓ2). */
export const columnStripHalf = (l1, l2) => 0.25 * Math.min(l1, l2);
/** 8.10.7.2 — interior unbalanced moment to the columns; edge columns take 0.3 M0 (8.10.4.? as carried from 318-14 8.10.4.? — clause number to verify). */
export const interiorMsc = (qDu, qLu, l2, ln, qDu2 = qDu, l22 = l2, ln2 = ln) => 0.07 * ((qDu + 0.5 * qLu) * l2 * ln * ln - qDu2 * l22 * ln2 * ln2);
export const EDGE_COLUMN_MSC = 0.3;

/** 22.5.5.1.3 — size-effect factor λs = √(2 / (1 + 0.004 d)) ≤ 1 (d in mm); applies to two-way shear through 22.6.5.2. */
export const lambdaS = d => Math.min(1, Math.sqrt(2 / (1 + 0.004 * d)));
/** 22.6.5.2 (Table 22.6.5.2) — vc for two-way shear without shear reinforcement, MPa. αs 40 interior, 30 edge, 20 corner. */
export function vcTwoWay(fc, beta, alphaS, d, bo, lambda = 1) {
  const ls = lambdaS(d), r = Math.sqrt(fc) * lambda * ls;
  return Math.min(0.33 * r, 0.17 * (1 + 2 / beta) * r, 0.083 * (2 + alphaS * d / bo) * r);
}
/** 22.6.6.1 (Table 22.6.6.1) — vc with headed shear studs, at the inner section; 0.17 λs λ √fc outside the reinforced zone. */
export const vcWithStuds = (fc, d, lambda = 1) => 0.25 * lambdaS(d) * lambda * Math.sqrt(fc);
export const vcOutside = (fc, d, lambda = 1) => 0.17 * lambdaS(d) * lambda * Math.sqrt(fc);
/** 22.6.6.2 — upper limit of vu with headed studs, MPa: 0.66 √fc. */
export const vuMaxStuds = fc => 0.66 * Math.sqrt(fc);
/** 8.4.2.2.2 — fraction of unbalanced moment by flexure γf = 1 / (1 + (2/3)√(b1/b2)); by shear γv = 1 − γf (8.4.4.2.2). */
export const gammaF = (b1, b2) => 1 / (1 + 2 / 3 * Math.sqrt(b1 / b2));
/** 8.7.7.1.2 — headed stud spacing: first ≤ d/2 from the face; s ≤ 0.75 d if vu ≤ φ 0.5 √fc, else 0.5 d. */
export const studSpacing = (vu, fc, d) => ({ s0: d / 2, s: vu <= PHI_SHEAR * 0.5 * Math.sqrt(fc) ? 0.75 * d : 0.5 * d, clause: '8.7.7.1.2' });

// ---- columns ------------------------------------------------------------------------------------
/** 22.4.2.1 / Table 22.4.2.1 — Pn,max for tied columns = 0.80 P0; P0 = 0.85 fc (Ag − Ast) + fy Ast (22.4.2.2). */
export const P0 = (fc, fy, Ag, Ast) => 0.85 * fc * (Ag - Ast) + fy * Ast;
export const PN_MAX_TIED = 0.80;
/** 10.6.1.1 — longitudinal steel 0.01 Ag ≤ Ast ≤ 0.08 Ag. */
export const COLUMN_RHO = { min: 0.01, max: 0.08, clause: '10.6.1.1' };
/** 10.7.3.1 — at least 4 bars in a rectangular tied column. */
export const COLUMN_MIN_BARS = 4;
/** 25.7.2.2 — #3 ties for bars #10 and smaller, #4 for larger. 25.7.2.1 — tie spacing ≤ min(16 db, 48 dtie, least dimension). */
export const tieSize = db => (db <= 32.3 ? '#3' : '#4');
export const tieSpacing = (db, dtie, least) => Math.min(16 * db, 48 * dtie, least);
/** 6.2.5.1 — slenderness may be neglected in a nonsway column when kℓu/r ≤ min(34 + 12 M1/M2, 40). r = 0.3 h (6.2.5.2). */
export const slendernessLimitNonsway = (M1overM2 = -0.5) => Math.min(34 + 12 * M1overM2, 40);
/** 6.6.4.5.4 — minimum moment M2,min = Pu (15 + 0.03 h) (N, mm). */
export const M2min = (Pu, h) => Pu * (15 + 0.03 * h);
/** 6.6.4.5 — nonsway magnifier δ = Cm / (1 − Pu / 0.75 Pc) ≥ 1, Pc = π²(EI)eff/(kℓu)², (EI)eff = 0.4 Ec Ig/(1 + βdns) (6.6.4.4.4(a)). */
export function magnifier({ Pu, Ec, Ig, k, lu, Cm = 1, betaDns = 0.6 }) {
  const EIeff = 0.4 * Ec * Ig / (1 + betaDns), Pc = Math.PI ** 2 * EIeff / (k * lu) ** 2;
  return { Pc, delta: Pu >= 0.75 * Pc ? Infinity : Math.max(1, Cm / (1 - Pu / (0.75 * Pc))) };
}
/** 25.5.5.1 — compression lap splice, fy ≤ 420 MPa: 0.071 fy db ≥ 300 mm. */
export const lapCompression = (db, fy) => Math.max(0.071 * fy * db, 300);
/** 25.5.2.1 — tension lap, Class B: 1.3 ld ≥ 300 mm. */
export const lapTensionB = ldT => Math.max(1.3 * ldT, 300);

// ---- hooks --------------------------------------------------------------------------------------
/** 25.3.1 (Table 25.3.1) — standard 90° hook: inside bend diameter 6db (#3–#8), 8db (#9–#11); straight extension 12 db. */
export const hook90 = db => ({ bend: db <= 25.4 ? 6 * db : 8 * db, ext: 12 * db, clause: '25.3.1' });
/** 25.4.3.1(a) — ldh = (fy ψe ψr ψo ψc / (23 λ √fc)) db^1.5, ≥ max(8 db, 150 mm). Conservative factors: ψr 1.6 (no confinement), ψo 1.25, ψc per fc. */
export function ldh(db, fy, fc, { psiE = 1, psiR = 1.6, psiO = 1.25, lambda = 1 } = {}) {
  const psiC = fc < 42 ? fc / 105 + 0.6 : 1.0;
  return Math.max(fy * psiE * psiR * psiO * psiC / (23 * lambda * Math.sqrt(fc)) * Math.pow(db, 1.5), 8 * db, 150);
}
/** 9.7.3.8.4 — at least 1/3 of negative steel extends beyond the inflection point ≥ max(d, 12 db, ℓn/16). */
export const negExtension = (d, db, ln) => Math.max(d, 12 * db, ln / 16);
/** 9.7.3.8.2 — at continuous supports at least 1/4 of positive steel extends ≥ 150 mm into the support. */
export const POS_INTO_SUPPORT = 150;

// ---- foundations ----------------------------------------------------------------------------------
/** 13.4.2.1 (Table 13.4.2.1) — deep foundation axial strength, uncased cast-in-place drilled or augered: Pn = 0.85 fc Ag, φ = 0.55. */
export const PILE_AXIAL = { coeff: 0.85, phi: 0.55, clause: '13.4.2.1 (Table 13.4.2.1)' };
/** 13.3.1.2 — depth of a pile cap above the bottom reinforcement ≥ 300 mm. */
export const CAP_MIN_DEPTH_ABOVE_STEEL = 300;
/** 13.2.7.1 — critical section for moment at the face of the column; 13.2.7.2 one-way shear at d from the face; 13.4.2.5 pile reactions within the section. */
export const CAP_SECTIONS = { moment: '13.2.7.1', shear: '13.2.7.2', pileInSection: '13.4.2.5' };
/** 13.4.2.5 — share of a pile's reaction that acts outside a critical section: 0 when its centre is ≥ dp/2 inside, 1 when ≥ dp/2 outside, linear between. */
export const pileShareOutside = (dist, dp) => Math.max(0, Math.min(1, 0.5 + dist / dp));   // dist > 0 outside the section
/** 7.6.1.1 / 13.3.2.1 via 24.4.3.2 — minimum flexural steel of footings and caps: 0.0018 Ag. */
export const FOOTING_AS_MIN_RATIO = 0.0018;
/** 25.4.9.2 — development length of a deformed bar in compression: max(0.24 fy ψr/(λ√fc), 0.043 fy ψr) db ≥ 200 mm (ψr = 1). */
export const ldc = (db, fy, fc, lambda = 1) => Math.max(Math.max(0.24 * fy / (lambda * Math.sqrt(fc)), 0.043 * fy) * db, 200);
/** 25.2.3 — minimum clear spacing of longitudinal column bars: max(40 mm, 1.5 db, 4/3 dagg). */
export const columnClearSpacingMin = (db, dagg = 19) => Math.max(40, 1.5 * db, 4 / 3 * dagg);
/** 25.7.2.3 — every corner and alternate bar laterally supported; no unsupported bar farther than 150 mm clear from a supported bar. */
export const TIE_UNSUPPORTED_CLEAR = 150;

// ---- strut-and-tie (Chapter 23) ----------------------------------------------------------------------
/** 21.2.1 — φ for struts, ties, nodal zones and bearing: 0.75. */
export const PHI_STM = 0.75;
/** 23.4.3 (Table 23.4.3(a)) — strut coefficient βs: 0.4 for "all other cases" (no distributed reinforcement per 23.5 is provided here). βc = 1. */
export const BETA_S_DEFAULT = 0.4;
/** 23.9.2 (Table 23.9.2) — nodal coefficient βn: CCC 1.0, CCT 0.8, CTT 0.6. */
export const BETA_N = { CCC: 1.0, CCT: 0.8, CTT: 0.6 };
/** 23.4.3 / 23.9.2 — effective compressive strength fce = 0.85 βc β fc. */
export const fce = (fc, beta, betaC = 1) => 0.85 * betaC * beta * fc;
/** 23.2.7 — angle between a strut and a tie meeting at a node ≥ 25°. */
export const STM_MIN_ANGLE = 25;
