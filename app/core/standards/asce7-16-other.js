// asce7-16-other.js - the remaining ASCE 7-16 provisions Coral applies: general structural integrity (Ch. 1),
// hydrostatic uplift (Ch. 3), snow with drifts at setbacks (Ch. 7), and components-and-cladding pressures
// for tall buildings (Ch. 30). A clause per value; UNVERIFIED against the printed text.
import { qz } from './asce7-16-wind.js';

export const EDITION = 'ASCE 7-16 (unverified against the printed text)';
const PSF = 0.04788, FT = 0.3048;   // kPa per psf, m per ft

/** 1.4.3: notional lateral force at each level, 0.01 of the level's dead load. */
export const INTEGRITY_FRACTION = 0.01;

/** 3.2.2 / 2.3: hydrostatic uplift γw · head on the mat; flotation checked as 0.9D against 1.6H... taken here as ASD 0.6D ≥ H (2.4). */
export const GAMMA_W = 9.81;

/**
 * Ch. 7 snow. Flat roof pf = 0.7 Ce Ct Is pg (7.3-1), not less than the minimum pm (7.3.4: Is pg when pg ≤ 20 psf,
 * else 20 Is psf). Drifts (7.7.1): hd = 0.43 lu^(1/3) (pg + 10)^(1/4) − 1.5 (ft, psf), leeward with lu of the upper
 * roof; windward 0.75 hd with lu of the lower roof; the larger governs; w = 4 hd (≤ 8 hc); γ = 0.13 pg + 14 ≤ 30 pcf.
 */
export function snow({ pg, Ce = 0.9, Ct = 1.0, Is = 1.0 }) {
  const pf0 = 0.7 * Ce * Ct * Is * pg, pgPsf = pg / PSF, pm = (pgPsf <= 20 ? Is * pgPsf : 20 * Is) * PSF;
  const pf = Math.max(pf0, pm), gammaPcf = Math.min(0.13 * pgPsf + 14, 30), gamma = gammaPcf * 0.157087;   // pcf → kN/m³
  const hdOf = lu => { const ft = 0.43 * Math.cbrt(lu / FT) * (pgPsf + 10) ** 0.25 - 1.5; return Math.max(0, ft) * FT; };
  return { pf, pf0, pm, gamma, drift({ luUpper, luLower, hc }) {
    const hdL = hdOf(luUpper), hdW = 0.75 * hdOf(luLower), hd = Math.min(Math.max(hdL, hdW), hc), w = Math.min(4 * hd, 8 * hc);
    return { hd, w, pd: hd * gamma, governs: hdL >= hdW ? 'leeward' : 'windward' };
  } };
}

/**
 * Ch. 30 Part 3 (h > 60 ft), Figure 30.5-1, walls: GCp for zones 4 (field) and 5 (corners) at effective areas
 * ≤ 20 ft² and ≥ 500 ft², log-linear between; GCpi ±0.18 enclosed (Table 26.13-1). p = qh (GCp − GCpi), qh at
 * the mean roof height. Returned for the smallest area (glazing units): kPa.
 */
export const CC = { zone4: { pos: [0.9, 0.6], neg: [-0.9, -0.7] }, zone5: { pos: [0.9, 0.6], neg: [-1.8, -1.0] }, GCpi: 0.18, corner_fraction: 0.1 };
export function claddingPressures({ h, V, exp, area_ft2 = 20 }) {
  const qh = qz(h, V, exp) / 1000, t = Math.min(1, Math.max(0, Math.log10(area_ft2 / 20) / Math.log10(500 / 20))), lerp = ([a, b]) => a + (b - a) * t;
  const z = k => ({ positive: qh * (lerp(CC[k].pos) + CC.GCpi), negative: qh * (lerp(CC[k].neg) - CC.GCpi) });
  return { qh, zone4: z('zone4'), zone5: z('zone5'), area_ft2 };
}
