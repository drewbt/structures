// functions.js - the versioned function registry (REQUIREMENTS §2 "Functional Intelligence").
//
// A function is {name, version, inputs(model, element) -> plain object, run(inputs) -> output,
// assumptions: [...]}. `inputs` gathers everything the computation depends on from the model, in SI
// units, so that hash(canonicalJSON(inputs)) + name@version is the complete cache key: equal key,
// equal answer, by construction. The model's dependency graph decides WHEN to recompute; this
// registry decides WHAT the computation reads. A function that reads the model inside run() would
// break the cache, so run() receives only the inputs object.
//
// Versioning (CONTRACT.md §10 of stiffness, adopted): a change to a number or signature bumps the
// major; widened validity bumps the minor; a patch changes no number.

import { wallMesh, slabMesh, columnMesh } from './geometry.js';

export const registry = new Map();
export function register(fn) { registry.set(fn.name, fn); return fn; }
export function fnFor(type) { for (const f of registry.values()) if (f.forType === type) return f; return null; }

const nz = x => (x === 0 ? 0 : x);   // no negative zero in coordinates
const num = (el, name, dflt) => { const p = el.params[name]; return p === undefined ? dflt : p.value; };

/** Level elevation and height of an element's parent level (or the element itself if it is a level). */
function levelOf(model, el) {
  const lvl = el.type === 'level' ? el : model.get(el.parent);
  if (!lvl || lvl.type !== 'level') throw new Error(`${el.id}: parent "${el.parent}" is not a level`);
  return { elevation: num(lvl, 'elevation', 0), height: num(lvl, 'height', 3) };
}

register({
  name: 'geometry.wall', version: '1.0.0', forType: 'wall',
  assumptions: ['straight centreline', 'constant thickness', 'rectangular openings measured along the centreline from start', 'height defaults to the level height'],
  inputs(model, el) {
    const lvl = levelOf(model, el);
    const openings = model.all().filter(o => o.type === 'opening' && num(o, 'host') === el.id)
      .map(o => ({ offset: num(o, 'offset', 0), width: num(o, 'width', 1), height: num(o, 'height', 2.1), sill: num(o, 'sill', 0) }))
      .sort((a, b) => a.offset - b.offset);
    return { start: num(el, 'start'), end: num(el, 'end'), thickness: num(el, 'thickness', 0.2), height: num(el, 'height', lvl.height), z0: lvl.elevation + num(el, 'base_offset', 0), openings };
  },
  run: wallMesh,
});

register({
  name: 'geometry.slab', version: '1.0.0', forType: 'slab',
  assumptions: ['simple polygon outline, no holes', 'uniform thickness', 'top of slab at level elevation plus offset'],
  inputs(model, el) { const lvl = levelOf(model, el); return { outline: num(el, 'outline'), thickness: num(el, 'thickness', 0.2), zTop: lvl.elevation + num(el, 'offset', 0) }; },
  run: slabMesh,
});

register({
  name: 'geometry.column', version: '1.0.0', forType: 'column',
  assumptions: ['rectangular section', 'vertical', 'height defaults to the level height'],
  inputs(model, el) { const lvl = levelOf(model, el); return { center: num(el, 'center'), width: num(el, 'width', 0.3), depth: num(el, 'depth', 0.3), rotation_deg: num(el, 'rotation', 0), height: num(el, 'height', lvl.height), z0: lvl.elevation + num(el, 'base_offset', 0) }; },
  run: columnMesh,
});

/**
 * Drawing calibration: pixel -> world. A drawing element carries the MEASUREMENT: two calibration
 * pixels (cal_p1, cal_p2) and the real distance between them (cal_distance, m), the pixel that is
 * world [0,0] (origin_px) and the rotation (deg, counter-clockwise: the direction of world +x as
 * drawn, measured from image +x with image y pointing down). Scale is derived here, never stored, so
 * a corrected distance propagates to every component re-derived from this drawing.
 */
register({
  name: 'trace.pixelToWorld', version: '2.0.0', forType: 'drawing',
  assumptions: ['similarity transform: uniform scale, rotation, translation; no lens or paper distortion', 'the two calibration points lie on the drawing plane'],
  inputs(model, el) { return { cal_p1: num(el, 'cal_p1', null), cal_p2: num(el, 'cal_p2', null), cal_distance_m: num(el, 'cal_distance', NaN), origin_px: num(el, 'origin_px', [0, 0]), rotation_deg: num(el, 'rotation', 0) }; },
  run({ cal_p1, cal_p2, cal_distance_m, origin_px, rotation_deg }) {
    if (!cal_p1 || !cal_p2 || !(cal_distance_m > 0)) throw new Error('drawing is not calibrated: two calibration points and a positive distance are needed');
    const scale = calibrateScale.run({ p1: cal_p1, p2: cal_p2, distance_m: cal_distance_m }).scale_m_per_px;
    const r = -rotation_deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return {
      scale, origin_px, rotation_deg, cal_pixels: Math.hypot(cal_p2[0] - cal_p1[0], cal_p2[1] - cal_p1[1]),
      toWorld(px) { const dx = (px[0] - origin_px[0]) * scale, dy = -(px[1] - origin_px[1]) * scale; return [nz(c * dx - s * dy), nz(s * dx + c * dy)]; },
      toPixel(w) { const dx = c * w[0] + s * w[1], dy = -s * w[0] + c * w[1]; return [nz(origin_px[0] + dx / scale), nz(origin_px[1] - dy / scale)]; },
    };
  },
});

/** Scale from two calibration pixels and the real distance between them. Pure, so it is a function here. */
export const calibrateScale = register({
  name: 'trace.calibrateScale', version: '1.0.0',
  assumptions: ['the two points lie on the drawing plane and the stated distance is the true distance between them'],
  inputs: null,
  run({ p1, p2, distance_m }) {
    const px = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (!(px > 0)) throw new Error('calibration points coincide');
    if (!(distance_m > 0)) throw new Error('calibration distance must be positive');
    return { scale_m_per_px: distance_m / px, pixels: px };
  },
});

/** Concrete volume of a set of generated meshes (model-level quantity). */
export const concreteVolume = register({
  name: 'quantity.concreteVolume', version: '1.0.0',
  assumptions: ['volumes are the exact prism volumes of the generated geometry; overlaps at wall junctions are not deducted (owed)'],
  inputs: null,
  run({ volumes }) { return { total_m3: volumes.reduce((s, v) => s + v, 0), count: volumes.length }; },
});
