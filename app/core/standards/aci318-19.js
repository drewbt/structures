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
