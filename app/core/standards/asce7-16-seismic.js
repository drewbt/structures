// asce7-16-seismic.js - the earthquake ruleset as data: ASCE 7-16 Chapters 11-12 (adopted by the 2022 NYC
// Building Code, whose own amendments are not encoded). A clause per value; UNVERIFIED against the printed text.

export const EDITION = 'ASCE 7-16 Ch. 11-12 (unverified against the printed text)';

/** Tables 11.4-1 and 11.4-2, site classes A and B (rock). */
export const SITE = { A: { Fa: 0.8, Fv: 0.8 }, B: { Fa: 0.9, Fv: 0.8 } };

/** Tables 11.6-1 and 11.6-2, Risk Category I-III: the worse of the two governs. */
export function sdc(SDS, SD1) {
  const a = SDS < 0.167 ? 'A' : SDS < 0.33 ? 'B' : SDS < 0.5 ? 'C' : 'D', b = SD1 < 0.067 ? 'A' : SD1 < 0.133 ? 'B' : SD1 < 0.2 ? 'C' : 'D';
  return a > b ? a : b;
}

/** Table 12.2-1 (bearing wall systems): ordinary reinforced concrete shear walls, no height limit in SDC B and C. */
export const SYSTEM = { name: 'ordinary reinforced concrete shear walls (bearing wall system)', R: 4, Omega0: 2.5, Cd: 4, permitted: ['A', 'B', 'C'] };

/** 12.8.2.1: approximate period Ta = Ct hn^x (SI: Ct 0.0488, x 0.75, "all other structural systems"); Table 12.8-1 Cu. */
export const Ta = hn => 0.0488 * hn ** 0.75;
export const Cu = SD1 => SD1 >= 0.3 ? 1.4 : SD1 >= 0.2 ? 1.5 : SD1 >= 0.15 ? 1.6 : 1.7;

/** 12.8.1.1: seismic response coefficient. */
export function Cs({ SDS, SD1, T, TL, R, Ie }) {
  const top = SDS / (R / Ie), lim = T <= TL ? SD1 / (T * R / Ie) : SD1 * TL / (T * T * R / Ie), min = Math.max(0.044 * SDS * Ie, 0.01);
  return { Cs: Math.max(Math.min(top, lim), min), top, lim, min, governs: Math.min(top, lim) < min ? 'minimum, Eq. 12.8-5' : lim < top ? (T <= TL ? 'Eq. 12.8-3' : 'Eq. 12.8-4') : 'Eq. 12.8-2' };
}
/** 12.8.3: vertical distribution exponent. */
export const kExp = T => T <= 0.5 ? 1 : T >= 2.5 ? 2 : 1 + (T - 0.5) / 2;

export const DRIFT_LIMIT = 0.020;            // Table 12.12-1, all other structures, Risk Category I/II: Δa = 0.020 hsx
export const ACCIDENTAL_ECC = 0.05;          // 12.8.4.2
export const RHO = 1.0;                      // 12.3.4.1: SDC B and C
export const THETA_PDELTA = 0.10;            // 12.8.7: below it P-delta may be neglected
export const thetaMax = (Cd, beta = 1) => Math.min(0.5 / (beta * Cd), 0.25);   // Eq. 12.8-17, β taken as 1 (conservative)
