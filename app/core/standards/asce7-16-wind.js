// asce7-16-wind.js - the wind ruleset as data: ASCE 7-16 Chapters 26-27 (the edition the 2022 NYC Building
// Code adopts), its Commentary C26.11 along-wind acceleration, and the across-wind and vortex-shedding
// screening Coral uses where ASCE 7 gives no analytical method. A clause per value. Written from the
// engineer's knowledge of the texts and UNVERIFIED against the printed pages, like the ACI ruleset.
//
// SCOPE, from the standard itself: the analytical procedures cover buildings whose response is not
// dominated by across-wind loading, vortex shedding, galloping or flutter (26.1.2, 27.1.3). A needle
// tower is exactly such a building, and Chapter 31 (wind tunnel procedure) is the code route for it.
// Every number produced here is a SCREENING result on the way to that test, never a substitute for it.

export const EDITION = 'ASCE 7-16 (unverified against the printed text)';

/** Table 26.11-1, SI. */
export const EXPOSURE = {
  B: { alpha: 7.0, zg: 365.76, ahat: 1 / 7.0, bhat: 0.84, abar: 1 / 4.0, bbar: 0.45, c: 0.30, l: 97.54, ebar: 1 / 3.0, zmin: 9.14 },
  C: { alpha: 9.5, zg: 274.32, ahat: 1 / 9.5, bhat: 1.00, abar: 1 / 6.5, bbar: 0.65, c: 0.20, l: 152.4, ebar: 1 / 5.0, zmin: 4.57 },
  D: { alpha: 11.5, zg: 213.36, ahat: 1 / 11.5, bhat: 1.07, abar: 1 / 9.0, bbar: 0.80, c: 0.15, l: 198.12, ebar: 1 / 8.0, zmin: 2.13 },
};
export const KD = 0.85;                      // Table 26.6-1, MWFRS of buildings
export const KZT = 1.0;                      // 26.8: no hill or escarpment at the site
export const RHO_AIR = 1.25;                 // kg/m³, C26.11
export const G_Q = 3.4, G_V = 3.4;           // 26.11.5
export const CP_WINDWARD = 0.8;              // Figure 27.3-1
export const CFX = 1.3;                      // C26.11 along-wind acceleration: mean along-wind force coefficient
export const TORSION_ECC = 0.15;             // Figure 27.3-8 Case 2: 0.75 of the pressures with eccentricity 0.15 B
export const T_PEAK = 3600;                  // s, peak factors over an hour

/** Figure 27.3-1 leeward Cp from L/B (0-1: -0.5, 2: -0.3, ≥4: -0.2; linear between). */
export function cpLeeward(LB) { if (LB <= 1) return -0.5; if (LB <= 2) return -0.5 + 0.2 * (LB - 1); if (LB <= 4) return -0.3 + 0.05 * (LB - 2); return -0.2; }

/** Eq. 26.10-1: velocity pressure exposure coefficient. */
export function Kz(z, exp) { const e = EXPOSURE[exp]; const zz = Math.min(Math.max(z, e.zmin), e.zg); return 2.01 * (zz / e.zg) ** (2 / e.alpha); }
/** Eq. 26.10-1: velocity pressure (Pa) at height z for basic wind speed V (m/s, 3 s gust). */
export function qz(z, V, exp) { return 0.613 * Kz(z, exp) * KZT * KD * V * V; }

/**
 * Screening criteria for wind serviceability. Not code requirements (ASCE 7 leaves them to the engineer,
 * Appendix C): the values commonly adopted for residential towers. Project criteria, stated.
 */
export const CRITERIA = {
  drift_ratio: 1 / 500,                      // top deflection / height under the 10-year wind (Appendix C commentary range H/600-H/400)
  storey_drift: 1 / 400,                     // inter-storey under the 10-year wind
  accel_mg: 15,                              // peak resultant acceleration, top occupied floor, 10-year wind, residential (ISO 10137 / CTBUH range 10-18 milli-g)
  comfort_mg: 10,                            // design target: the low end of the residential range, 2/3 of accel_mg; margin for the across-wind screening method (project choice)
};

/** Across-wind screening (NBCC 2015 Structural Commentary I, unverified) and vortex shedding. */
export const ACROSS = {
  ar_coeff: 78.5e-3, ar_exp: 3.3,            // a_r = 78.5e-3 [V_H / (n_W √(WD))]^3.3
  reduced_velocity_max: 10,                  // the formula's stated range of V_H / (n_W √(WD))
  aspect_max: 6,                             // H/√(WD) of the buildings it was drawn from (unverified): beyond it the result is indicative only
  strouhal: 0.12,                            // rectangular prism, order of the tabulated values (assumed)
};
