// wind.js - wind on a building: ASCE 7-16 along-wind loads with the flexible-building gust effect factor,
// the Commentary C26.11 along-wind acceleration, and the across-wind and vortex-shedding screening.
// Pure functions of stated inputs (SI: m, s, kg, N, Pa); the dynamic properties (frequencies, modal masses)
// come from the stiffness engine's modes, never from rules of thumb. Ruleset: standards/asce7-16-wind.js.
import { register } from './functions.js';
import * as W from './standards/asce7-16-wind.js';

/** Peak factor for a resonant response over T seconds at n Hz (26.11.5 gR; C26.11 gẍ). */
export const peakFactor = (n, T = W.T_PEAK) => { const a = Math.sqrt(2 * Math.log(n * T)); return a + 0.5772 / a; };
const Rl = eta => eta <= 0 ? 1 : 1 / eta - (1 - Math.exp(-2 * eta)) / (2 * eta * eta);

/**
 * wind.gustFlexible: ASCE 7-16 26.11.5 gust effect factor Gf for a flexible building, and the mean wind at
 * the equivalent height (V̄z̄) that the acceleration and across-wind checks reuse.
 *   h height, B width normal to the wind, L depth along it (m); n1 Hz in this direction; beta damping ratio;
 *   V basic wind speed (m/s, 3 s gust); exp exposure letter.
 */
export const gustFlexible = register({
  name: 'wind.gustFlexible', version: '1.0.0', assumptions: [W.EDITION, 'z̄ = 0.6 h, not less than zmin'], inputs: null,
  run({ h, B, L, n1, beta, V, exp }) {
    const e = W.EXPOSURE[exp], zbar = Math.max(0.6 * h, e.zmin);
    const Iz = e.c * (10 / zbar) ** (1 / 6), Lz = e.l * (zbar / 10) ** e.ebar, Q = Math.sqrt(1 / (1 + 0.63 * ((B + h) / Lz) ** 0.63));
    const Vz = e.bbar * (zbar / 10) ** e.abar * V, N1 = n1 * Lz / Vz, Rn = 7.47 * N1 / (1 + 10.3 * N1) ** (5 / 3);
    const Rh = Rl(4.6 * n1 * h / Vz), RB = Rl(4.6 * n1 * B / Vz), RL = Rl(15.4 * n1 * L / Vz);
    const R = Math.sqrt(Rn * Rh * RB * (0.53 + 0.47 * RL) / beta), gR = peakFactor(n1);
    const Gf = 0.925 * (1 + 1.7 * Iz * Math.sqrt(W.G_Q ** 2 * Q ** 2 + gR ** 2 * R ** 2)) / (1 + 1.7 * W.G_V * Iz);
    return { Gf, Iz, Lz, Q, R, Rn, Rh, RB, RL, gR, Vz, zbar };
  },
});

/**
 * wind.alongWindForces: ASCE 7-16 27.3 directional procedure, net windward + leeward pressure on each storey
 * band (z0..z1, face width B at that band), Case 1; Case 2 is 0.75 of it with a torsional moment.
 */
export const alongWindForces = register({
  name: 'wind.alongWindForces', version: '1.0.0', assumptions: [W.EDITION, 'internal pressures cancel on the MWFRS', 'pressures integrated over each band at its mid-height (windward qz) and at roof height (leeward qh)'], inputs: null,
  run({ bands, h, L, B, Gf, V, exp }) {
    const qh = W.qz(h, V, exp), cpl = W.cpLeeward(L / B);
    const F = bands.map(b => { const zm = (b.z0 + b.z1) / 2, p = W.qz(zm, V, exp) * Gf * W.CP_WINDWARD - qh * Gf * cpl; return { z: b.z1, zm, width: b.width, p, F: p * b.width * (b.z1 - b.z0) / 1000 }; });   // kN
    const base_shear = F.reduce((a, f) => a + f.F, 0), base_moment = F.reduce((a, f) => a + f.F * f.zm, 0);
    return { forces: F, qh, cp_leeward: cpl, base_shear, base_moment };
  },
});

/**
 * wind.alongWindAccel: ASCE 7-16 Commentary C26.11, peak along-wind acceleration at the top for a mode with
 * frequency n1, modal mass m1 (kg, shape 1 at the top) and shape exponent xi.
 */
export const alongWindAccel = register({
  name: 'wind.alongWindAccel', version: '1.0.0', assumptions: [W.EDITION + ' Commentary C26.11', 'mode shape (z/h)^ξ with ξ fitted to the engine mode', 'ρ air 1.25 kg/m³'], inputs: null,
  run({ h, B, L, n1, beta, V, exp, m1, xi }) {
    const e = W.EXPOSURE[exp], g = gustFlexible.run({ h, B, L, n1, beta, V, exp });
    const K = 1.65 ** e.ahat / (e.ahat + xi + 1);
    const sigma = 0.85 * W.RHO_AIR * B * h * W.CFX * g.Vz ** 2 / m1 * g.Iz * K * g.R, gx = peakFactor(n1);
    return { a_peak: gx * sigma, sigma, gx, K, ...g };
  },
});

/**
 * wind.acrossWind: across-wind peak acceleration by the NBCC 2015 Commentary I expression (unverified), with
 * its range of validity, and the vortex-shedding critical speed n W / St against the mean speed at the top.
 *   W width across the wind, D depth along it, H height (m); nW Hz across-wind; beta damping; VH mean
 *   hourly speed at the top (m/s); rhoB building density (kg/m³).
 */
export const acrossWind = register({
  name: 'wind.acrossWind', version: '1.0.0', assumptions: ['NBCC 2015 Structural Commentary I across-wind expression (unverified)', `Strouhal number ${W.ACROSS.strouhal} for a rectangular plan (assumed)`, 'outside the expression\'s range the number is indicative only and a wind tunnel test is required'], inputs: null,
  run({ W: Wd, D, H, nW, beta, VH, rhoB }) {
    const s = Math.sqrt(Wd * D), vr = VH / (nW * s), ar = W.ACROSS.ar_coeff * vr ** W.ACROSS.ar_exp;
    const a = nW * nW * peakFactor(nW) * s * ar / (rhoB * 9.81 * Math.sqrt(beta));
    const Vcr = nW * Wd / W.ACROSS.strouhal;
    const inRange = vr <= W.ACROSS.reduced_velocity_max, inAspect = H / s <= W.ACROSS.aspect_max;
    return { a_peak: a, reduced_velocity: vr, aspect: H / s, inRange, inAspect, valid: inRange && inAspect, Vcr, lockin_ratio: Vcr / VH };
  },
});

/** Mean hourly wind speed at height z for a basic speed V (26.11.5 V̄z form, applied at z). */
export const meanSpeed = (z, V, exp) => { const e = W.EXPOSURE[exp]; return e.bbar * (Math.max(z, e.zmin) / 10) ** e.abar * V; };
