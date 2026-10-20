// geotech.js - the ground: a soil profile, the axial capacity of a bored pile in it, and the shortest pile
// that carries a load.
//
// The profile is a model element (type "soil": ground surface, water table, factor of safety, plan extent)
// with one child per layer (type "soil_layer": top and bottom depth below the surface, kind, unit weight and
// the strength the method needs: undrained shear strength su for clay, SPT N60 for sand). Fill carries
// nothing. Every number of a profile is ASSUMED until a site investigation replaces it (ASSUMPTIONS A-21).
//
// Methods (drilled shafts), stated per term and UNVERIFIED against the printed texts:
//   clay side   fs = α su, α = 0.55 for su/pa ≤ 1.5, 0.55 − 0.1(su/pa − 1.5) to 2.5; the top 1.5 m below the
//               surface and the bottom one diameter are excluded              FHWA-NHI-10-016 (GEC 10) §13.3.5.1
//   clay tip    qp = Nc* su, Nc* 6.5 / 8.0 / 9.0 at su 24 / 48 / ≥ 96 kPa (linear between); for a toe less than
//               3 D deep, × 2/3 (1 + z/(6D)); qp ≤ 4 MPa                   GEC 10 §13.3.5.2
//   sand side   fs = β σ′v, β = 1.5 − 0.245 √z (z in m), 0.25 ≤ β ≤ 1.2, × N60/15 when N60 < 15; fs ≤ 200 kPa
//                                                                          O'Neill & Reese 1999 (FHWA-IF-99-025)
//   sand tip    qp = 0.6 pa N60 ≤ 30 pa                                    GEC 10 §13.3.6.2
//   allowable   Qallow = (Qside + Qtip) / FS; pile self-weight and negative skin friction not included.
import { register } from './functions.js';

export const PA = 101.325, GAMMA_W = 9.81, SLICE = 0.05;
const num = (el, name, dflt) => { const p = el.params[name]; return p === undefined ? dflt : p.value; };

/** The model's soil profile as plain inputs, or null when the model has none. */
export function soilInputs(model) {
  const s = model.byType('soil')[0]; if (!s) return null;
  const layers = model.all().filter(e => e.type === 'soil_layer' && e.parent === s.id).map(l => ({ id: l.id, name: l.name, kind: num(l, 'kind', 'clay'), top: num(l, 'top', 0), bottom: num(l, 'bottom', 1), gamma: num(l, 'gamma', 18), su: num(l, 'su', 0), N60: num(l, 'N60', 0) })).sort((a, b) => a.top - b.top);
  return { id: s.id, surface: num(s, 'surface', 0), water_depth: num(s, 'water_depth', Infinity), fs: num(s, 'fs', 2.5), layers };
}

/** Check that the layers start at the surface and touch; return the layer at depth z (the last continues below). */
function layerAt(soil, z) {
  for (const l of soil.layers) if (z < l.bottom) return l;
  return soil.layers[soil.layers.length - 1];
}
export function validateProfile(soil) {
  if (!soil.layers.length) throw new Error('soil profile has no layers');
  if (Math.abs(soil.layers[0].top) > 1e-9) throw new Error(`soil profile: the first layer starts at ${soil.layers[0].top} m, not at the surface`);
  for (let i = 0; i < soil.layers.length; i++) {
    const l = soil.layers[i];
    if (!(l.bottom > l.top)) throw new Error(`soil layer ${l.name}: bottom must be below top`);
    if (i && Math.abs(l.top - soil.layers[i - 1].bottom) > 1e-9) throw new Error(`soil layer ${l.name}: starts at ${l.top} m but the layer above ends at ${soil.layers[i - 1].bottom} m`);
    if (l.kind === 'clay' && !(l.su > 0)) throw new Error(`soil layer ${l.name}: clay needs su > 0`);
    if (l.kind === 'sand' && !(l.N60 > 0)) throw new Error(`soil layer ${l.name}: sand needs N60 > 0`);
    if (!['clay', 'sand', 'fill'].includes(l.kind)) throw new Error(`soil layer ${l.name}: kind "${l.kind}" is not clay, sand or fill`);
  }
}

/** Vertical effective stress (kPa) at depth z below the surface. */
export function sigmaV(soil, z) {
  let s = 0, top = 0;
  const step = (a, b, g) => { if (b <= a) return; const w = soil.water_depth; s += g * (Math.min(b, Math.max(a, w)) - a) + (g - GAMMA_W) * Math.max(0, b - Math.max(a, w)); };
  for (const l of soil.layers) { if (z <= top) break; step(top, Math.min(z, l.bottom), l.gamma); top = l.bottom; }
  if (z > top) step(top, z, soil.layers[soil.layers.length - 1].gamma);
  return s;
}

export const alphaClay = su => { const r = su / PA; return r <= 1.5 ? 0.55 : Math.max(0.45, 0.55 - 0.1 * (r - 1.5)); };
export const ncClay = su => su <= 24 ? 6.5 : su <= 48 ? 6.5 + 1.5 * (su - 24) / 24 : su < 96 ? 8 + (su - 48) / 48 : 9;
export const betaSand = (z, N60) => { const b = Math.min(1.2, Math.max(0.25, 1.5 - 0.245 * Math.sqrt(z))); return N60 < 15 ? b * N60 / 15 : b; };

/**
 * geotech.pileCapacity: side and tip resistance of a bored pile of diameter D (m) whose head is at elevation
 * zHead and whose length is L (m), in the profile `soil`. Returns kN.
 */
export const pileCapacity = register({
  name: 'geotech.pileCapacity', version: '1.0.0',
  assumptions: ['drilled-shaft methods as stated in geotech.js, unverified against the printed texts', 'the deepest layer continues below its stated bottom', 'side resistance integrated in 50 mm slices at mid-slice stress', 'pile self-weight, negative skin friction, group efficiency and settlement not considered'],
  inputs: null,
  run({ soil, D, zHead, L }) {
    validateProfile(soil);
    if (!(D > 0) || !(L > 0)) throw new Error('pile capacity: diameter and length must be positive');
    const zt = soil.surface - zHead, zb = zt + L, per = Math.PI * D, byLayer = new Map();
    let Qs = 0;
    for (let a = Math.max(0, zt); a < zb - 1e-9; a += SLICE) {
      const b = Math.min(zb, a + SLICE), z = (a + b) / 2, l = layerAt(soil, z); let fs = 0;
      if (l.kind === 'clay') { if (z >= 1.5 && z <= zb - D) fs = alphaClay(l.su) * l.su; }
      else if (l.kind === 'sand') fs = Math.min(200, betaSand(z, l.N60) * sigmaV(soil, z));
      const q = fs * per * (b - a); Qs += q; byLayer.set(l.name, (byLayer.get(l.name) || 0) + q);
    }
    const lt = layerAt(soil, zb - 1e-9); let qp = 0;
    if (lt.kind === 'clay') qp = Math.min(4000, ncClay(lt.su) * lt.su * (zb < 3 * D ? 2 / 3 * (1 + zb / (6 * D)) : 1));
    else if (lt.kind === 'sand') qp = Math.min(30 * PA, 0.6 * PA * lt.N60);
    const Qb = qp * Math.PI * D * D / 4, Qult = Qs + Qb;
    return { Qside: Qs, Qtip: Qb, qp, Qult, Qallow: Qult / soil.fs, fs: soil.fs, toe_depth: zb, toe_layer: lt.name, side_by_layer: Object.fromEntries(byLayer) };
  },
});

/**
 * geotech.pileLength: the shortest pile, in steps of `step` from Lmin, whose allowable load is at least P (kN).
 * null when none up to Lmax does.
 */
export const pileLength = register({
  name: 'geotech.pileLength', version: '1.0.0',
  assumptions: ['lengths in 0.5 m steps', 'minimum length 3 m (practice for bored piles, not a code rule)', 'maximum 30 m searched'],
  inputs: null,
  run({ soil, D, zHead, P, Lmin = 3, Lmax = 30, step = 0.5 }) {
    for (let L = Lmin; L <= Lmax + 1e-9; L += step) { const c = pileCapacity.run({ soil, D, zHead, L }); if (c.Qallow >= P) return { L: Math.round(L * 1000) / 1000, capacity: c }; }
    return null;
  },
});

/** The assumed profile used when a model has none: stated, editable, and marked as an assumption. */
export const DEFAULT_PROFILE = {
  water_depth: 3.0, fs: 2.5,
  layers: [
    { name: 'Fill', kind: 'fill', top: 0, bottom: 1.0, gamma: 18 },
    { name: 'Stiff clay', kind: 'clay', top: 1.0, bottom: 6.0, gamma: 19, su: 75 },
    { name: 'Dense sand', kind: 'sand', top: 6.0, bottom: 20.0, gamma: 20, N60: 35 },
  ],
};

/** Create a soil profile element with its layers (the default profile unless one is given) covering `extent`. */
export function createSoilProfile(model, { extent, surface = 0, profile = DEFAULT_PROFILE, note = 'ASSUMED generic profile: no site investigation' } = {}) {
  const P = (v, unit = '') => ({ value: v, unit }), prov = { source: 'geotech.DEFAULT_PROFILE', trace: '', method: 'assumed', note };
  const s = model.create({ type: 'soil', name: 'Ground', params: { surface: P(surface, 'm'), water_depth: P(profile.water_depth, 'm'), fs: P(profile.fs), extent: P(extent, 'm') }, provenance: prov });
  for (const l of profile.layers) {
    const params = { kind: P(l.kind), top: P(l.top, 'm'), bottom: P(l.bottom, 'm'), gamma: P(l.gamma, 'kN/m3') };
    if (l.su !== undefined) params.su = P(l.su, 'kPa'); if (l.N60 !== undefined) params.N60 = P(l.N60);
    model.create({ type: 'soil_layer', name: l.name, parent: s.id, params, provenance: prov });
  }
  return s;
}

/** Plan extent of the model's structural elements plus a margin, for a new soil profile. */
export function modelExtent(model, margin = 4) {
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  const add = q => { if (Array.isArray(q) && typeof q[0] === 'number') for (let k = 0; k < 2; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); } };
  for (const e of model.all()) { for (const k of ['start', 'end', 'center']) add(e.params[k]?.value); for (const q of e.params.outline?.value ?? []) add(q); }
  if (!isFinite(min[0])) return [[-10, -10], [10, 10]];
  return [[min[0] - margin, min[1] - margin], [max[0] + margin, max[1] + margin]];
}
