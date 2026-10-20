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

import { wallMesh, slabMesh, columnMesh, beamMesh, rebarMesh, cylinderMesh, boxMesh, segmentsMesh } from './geometry.js';

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

register({
  name: 'geometry.beam', version: '1.0.0', forType: 'beam',
  assumptions: ['straight, horizontal, rectangular section', 'top of beam at level elevation + top_offset (default: the level height, i.e. under the next floor)'],
  inputs(model, el) { const lvl = levelOf(model, el); return { start: num(el, 'start'), end: num(el, 'end'), width: num(el, 'width', 0.3), depth: num(el, 'depth', 0.6), zTop: lvl.elevation + num(el, 'top_offset', lvl.height) }; },
  run: beamMesh,
});

register({
  name: 'geometry.rebar', version: '1.0.0', forType: 'rebar',
  assumptions: ['polyline path, sharp corners; drawn as an equal-area square prism', 'steel density 7850 kg/m³'],
  inputs(model, el) { return { path: num(el, 'path'), diameter: num(el, 'diameter') }; },
  run: rebarMesh,
});

register({
  name: 'geometry.pilecap', version: '1.0.0', forType: 'pilecap',
  assumptions: ['rectangular, axis-aligned; top at the stated level z (the column base)'],
  inputs(model, el) { const H = num(el, 'thickness', 0.9), top = num(el, 'top', 0); return { center: num(el, 'center'), size: num(el, 'size'), z0: top - H, z1: top }; },
  run: boxMesh,
});
register({
  name: 'geometry.pile', version: '1.0.0', forType: 'pile',
  assumptions: ['straight vertical bored pile; head embedded in the cap by the cap’s pile_embed'],
  inputs(model, el) { const cap = model.get(el.parent); const H = cap ? num(cap, 'thickness', 0.9) : 0, top = cap ? num(cap, 'top', 0) : 0, emb = cap ? num(cap, 'pile_embed', 0.075) : 0; const zHead = top - H + emb; return { center: num(el, 'center'), diameter: num(el, 'diameter', 0.45), z0: zHead - num(el, 'length', 12), z1: zHead }; },
  run: cylinderMesh,
});
register({
  name: 'geometry.drop_panel', version: '1.0.0', forType: 'drop_panel',
  assumptions: ['rectangular, axis-aligned, under the soffit of its parent slab'],
  inputs(model, el) { const slab = model.get(el.parent); if (!slab || slab.type !== 'slab') throw new Error(`${el.id}: a drop panel's parent is its slab`); const lvl = levelOf(model, slab); const soffit = lvl.elevation + num(slab, 'offset', lvl.height) - num(slab, 'thickness', 0.2); return { center: num(el, 'center'), size: num(el, 'size'), z0: soffit - num(el, 'projection', 0.15), z1: soffit }; },
  run: boxMesh,
});
/** The ground: one translucent box per soil layer over the profile's plan extent. Earth is not concrete, so its volume is stated as earth_m3. */
const soilOf = (model, el) => { const s = model.get(el.parent); if (!s || s.type !== 'soil') throw new Error(`${el.id}: a soil layer's parent is its soil profile`); return s; };
const earthBox = inp => { const m = boxMesh(inp); m.earth_m3 = m.volume_m3; delete m.volume_m3; return m; };
register({
  name: 'geometry.soil_layer', version: '1.0.0', forType: 'soil_layer',
  assumptions: ['horizontal layer between its top and bottom depths below the ground surface, over the profile\'s plan extent'],
  inputs(model, el) { const s = soilOf(model, el), surf = num(s, 'surface', 0), [[x0, y0], [x1, y1]] = num(s, 'extent'); return { center: [(x0 + x1) / 2, (y0 + y1) / 2], size: [x1 - x0, y1 - y0], z0: surf - num(el, 'bottom', 1), z1: surf - num(el, 'top', 0) }; },
  run: earthBox,
});
register({
  name: 'geometry.soil', version: '1.0.0', forType: 'soil',
  assumptions: ['the ground surface drawn as a 10 mm sheet whose top is 5 mm below the stated surface, so elements built to the surface show above it'],
  inputs(model, el) { const surf = num(el, 'surface', 0), [[x0, y0], [x1, y1]] = num(el, 'extent'); return { center: [(x0 + x1) / 2, (y0 + y1) / 2], size: [x1 - x0, y1 - y0], z: surf }; },
  run({ center, size, z }) { const m = boxMesh({ center, size, z0: z - 0.015, z1: z - 0.005 }); delete m.volume_m3; return m; },
});
/** Site context (a park, a street): a flat sheet just under the ground surface. Not structure; no volume. */
register({
  name: 'geometry.context', version: '1.0.0', forType: 'context',
  assumptions: ['drawn as a 300 mm slab whose top is 20 mm below elevation 0, so it never hides the ground surface or structure and its faces stay apart in the depth buffer at city scale'],
  inputs(model, el) { return { outline: num(el, 'outline') }; },
  run({ outline }) { const m = slabMesh({ outline, thickness: 0.3, zTop: -0.02 }); m.context_m2 = m.area_m2; delete m.volume_m3; return m; },
});
register({
  name: 'geometry.damper', version: '1.0.0', forType: 'damper',
  assumptions: ['a tuned mass damper drawn as a block of its stated plan size and height, 2 m below the top of its storey'],
  inputs(model, el) { const lvl = levelOf(model, el), h = num(el, 'height', 3); return { center: num(el, 'center'), size: num(el, 'size'), z1: lvl.elevation + lvl.height - 2, z0: lvl.elevation + lvl.height - 2 - h }; },
  run(inp) { const m = boxMesh(inp); delete m.volume_m3; return m; },
});
register({
  name: 'geometry.punching_zone', version: '1.0.0', forType: 'punching_zone',
  assumptions: ['the critical perimeter drawn at slab mid-depth as separate segments'],
  inputs(model, el) { return { pairs: num(el, 'path'), width: 0.03 }; },
  run: segmentsMesh,
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
