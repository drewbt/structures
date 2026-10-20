// tower.js - a SYNTHETIC needle tower on a lot facing Central Park, every floor modelled, and the gravity
// summary that can honestly be computed for it.
//
// Not a record of any real building. Its proportions sit in the range published for the slender towers
// on and near Central Park South and West 57th Street (heights of roughly 300-470 m, height-to-width ratios
// up to about 24; secondary sources, unverified). Every element is method "assumed", source
// "needle-tower (synthetic)".
//
// Plan, local axes: x east, y north; the north face (y = depth) is on the Central Park South lot line and
// faces the park across the street. Structure: two full-length concrete shear walls on the east and west
// faces (the tower's flanges in its slender direction), a central concrete core, and two columns on each of
// the north and south faces. The floors span about 5 m between core and walls. Above the taper floor the south
// face steps back every few floors; the north face keeps the park frontage. A crown of wall fins tops it.
// Below grade: two cellars inside a perimeter wall and a mat bearing on rock.

import { register } from './functions.js';
import { createSoilProfile, soilInputs } from './geotech.js';

const P = (v, unit = '') => ({ value: v, unit });
const PROV = note => ({ source: 'needle-tower (synthetic)', trace: '', method: 'assumed', note });
const r3 = v => Math.round(v * 1000) / 1000;

export const TOWER_DEFAULTS = {
  width: 32, depth: 45,                 // m: east-west (the slender direction) and north-south. Chosen for comfort by tools/optimise-comfort.mjs (docs/tower-comfort.json): the tallest form at or under 10 milli-g
  floors: 74, lobby: 9.0, typical: 4.6, mechanical: { floors: [18, 36, 53, 66], height: 9.0 }, crown: 27,   // 74 floors, 389 m: 84 floors (435 m) could not be made comfortable
  taper: { from: 44, every: 5, step: 3, maxSetback: 18 },
  core: { x: [-4, 4], y: [22, 32] },
  slab: 0.25, ext: [[1, 1.4], [21, 1.1], [41, 0.9], [61, 0.6]], coreWall: [[1, 0.6], [41, 0.45]],
  column: [[1, 0.9], [41, 0.75], [61, 0.6]], fc: [[1, 96], [31, 70], [61, 55]],
  lot: null, cellars: 2, cellarHeight: 4.5, mat: 3.5,   // lot: null = the tower's width + 2 m each side
  sdl: 2.0, ll: 1.92,                   // kPa on every floor: finishes + partitions; residential live (40 psf)
  outriggers: { floors: [18, 36, 53, 66], thickness: 0.8 },   // outrigger walls at these storeys (mechanical floors), core to the east and west walls
  damper: { mass: 3200 },               // tuned mass damper at the crown (t); 0 = none
  tube: { thickness: 0.6, solidity: 0.5 },                           // { thickness, solidity }: north and south facades as perforated concrete walls joined to the east and west walls (a tube)
  anchors: { capacity: 2500, edge: 1.5 },   // rock anchors at the mat edges if overturning needs them: working capacity kN each, distance from the edge (m)                  // tuned mass damper at the crown (t); 0 = none
  wallScale: 0.8, coreScale: 1.0,       // multipliers on the wall and core thickness tables
  seismic: { Ss: 0.28, S1: 0.07, site_class: 'B', TL: 6, Ie: 1.0 },
  wind: { V: 51.4, V10: 34.0, exposure: 'C', beta_service: 0.015, beta_ultimate: 0.02 },
};

/** Manhattan ground at the site, ASSUMED: fill over glacial till over Manhattan schist. */
export const MANHATTAN_PROFILE = {
  water_depth: 6.0, fs: 2.5,
  layers: [
    { name: 'Fill', kind: 'fill', top: 0, bottom: 3, gamma: 18 },
    { name: 'Glacial till', kind: 'sand', top: 3, bottom: 10, gamma: 21, N60: 50 },
    { name: 'Manhattan schist', kind: 'rock', top: 10, bottom: 60, gamma: 27, qa: 3830 },
  ],
};

const by = (table, k) => table.reduce((v, [from, x]) => (k >= from ? x : v), table[0][1]);

/**
 * A tower of `floors` storeys with its mechanical floors, outriggers and taper placed at the same fractions of
 * the height as the 84-storey default, so a shorter tower is the same design shortened, not a different one.
 */
export function towerForm({ floors, width, taperFrac = 50 / 84, tube, damper, depth = 45 } = {}) {
  const mech = [0.24, 0.48, 0.71, 0.89].map(f => Math.max(2, Math.round(f * floors)));
  return { ...TOWER_DEFAULTS, floors, width: width ?? TOWER_DEFAULTS.width, depth, mechanical: { floors: mech, height: TOWER_DEFAULTS.mechanical.height },
    outriggers: { floors: mech, thickness: TOWER_DEFAULTS.outriggers.thickness }, taper: { ...TOWER_DEFAULTS.taper, from: Math.round(taperFrac * floors) },
    tube: tube ?? TOWER_DEFAULTS.tube, damper: damper ?? TOWER_DEFAULTS.damper };
}

/** The floor stack: name, elevation, height and kind, from the cellars to the crown. */
export function floorStack(o = TOWER_DEFAULTS) {
  const out = [];
  for (let b = o.cellars; b >= 1; b--) out.push({ name: `B${b}`, k: -b, elevation: -b * o.cellarHeight, height: o.cellarHeight, kind: 'cellar' });
  let z = 0;
  for (let k = 1; k <= o.floors; k++) {
    const h = k === 1 ? o.lobby : o.mechanical.floors.includes(k) ? o.mechanical.height : o.typical;
    out.push({ name: k === 1 ? 'L1 Lobby' : `L${k}${o.mechanical.floors.includes(k) ? ' Mechanical' : ''}`, k, elevation: r3(z), height: h, kind: k === 1 ? 'lobby' : o.mechanical.floors.includes(k) ? 'mechanical' : 'typical' });
    z += h;
  }
  out.push({ name: 'Roof and crown', k: o.floors + 1, elevation: r3(z), height: o.crown, kind: 'crown' });
  return out;
}

/** South-face setback (m) of floor k: the needle's taper. */
export function setback(k, o = TOWER_DEFAULTS) {
  if (k < o.taper.from) return 0;
  return Math.min(o.taper.maxSetback, (Math.floor((k - o.taper.from) / o.taper.every) + 1) * o.taper.step);
}

export function createNeedleTower(app, opts = {}) {
  const o = { ...TOWER_DEFAULTS, ...opts }, m = app.model, ids = { levels: [] };
  if (!opts.lot) o.lot = { x: [-(o.width / 2 + 2), o.width / 2 + 2], y: [-3, o.depth] };   // the lot follows the tower: 2 m each side, 3 m to the south
  const W = o.width / 2, [lx0, lx1] = o.lot.x, [ly0, ly1] = o.lot.y;
  m.batch('needle tower', () => {
    ids.soil = createSoilProfile(m, { extent: [[lx0 - 20, ly0 - 20], [lx1 + 20, ly1 + 20]], surface: 0, profile: MANHATTAN_PROFILE, note: 'ASSUMED midtown Manhattan profile: fill, glacial till, Manhattan schist from 10 m; rock bearing 3830 kPa is of the order of the NYC Building Code presumptive value for medium-hard rock (unverified); no borings' }).id;
    for (const c of [{ name: 'Central Park (context)', outline: [[-400, ly1 + 30], [400, ly1 + 30], [400, ly1 + 430], [-400, ly1 + 430]], kind: 'park', note: 'the park as context: 400 m deep, starting across the street; not to survey' },
      { name: 'Central Park South (street)', outline: [[-400, ly1], [400, ly1], [400, ly1 + 30], [-400, ly1 + 30]], kind: 'street', note: 'street and sidewalks, 30 m assumed' }])
      m.create({ type: 'context', name: c.name, params: { outline: P(c.outline, 'm'), kind: P(c.kind) }, provenance: PROV(c.note) });
    ids.wind = m.create({ type: 'wind', name: 'Wind (site)', params: { V: P(o.wind.V, 'm/s'), V10: P(o.wind.V10, 'm/s'), exposure: P(o.wind.exposure), beta_service: P(o.wind.beta_service), beta_ultimate: P(o.wind.beta_ultimate), snow_pg: P(o.snow_pg ?? 1.2, 'kPa'), anchor_capacity: P(o.anchors.capacity, 'kN'), anchor_edge: P(o.anchors.edge, 'm') }, provenance: PROV('ASCE 7-16 basic wind speed for Risk Category II at Manhattan, 115 mph, and the 10-year serviceability speed, 76 mph (both read from the maps from memory, unverified); Exposure C because the open park lies within 20 H upwind to the north (26.7.3); ground snow 1.20 kPa (25 psf, ASCE 7-16 Figure 7.2-1, unverified); inherent damping 1.5 % service, 2 % ultimate (assumed)') }).id;
    ids.seismic = m.create({ type: 'seismic', name: 'Earthquake (site)', params: { Ss: P(o.seismic.Ss, 'g'), S1: P(o.seismic.S1, 'g'), site_class: P(o.seismic.site_class), TL: P(o.seismic.TL, 's'), Ie: P(o.seismic.Ie) }, provenance: PROV('ASCE 7-16 mapped MCER accelerations for midtown Manhattan, Ss 0.28 g and S1 0.07 g, from memory of the USGS values (unverified: take them from the ASCE hazard tool); site class B on Manhattan schist (needs a measured shear-wave velocity, 20.3); long-period transition TL 6 s (Figure 22-14); Risk Category II, Ie 1.0') }).id;
    const fnd = m.create({ type: 'level', name: 'Foundation', params: { elevation: P(r3(-o.cellars * o.cellarHeight - o.mat), 'm'), height: P(o.mat, 'm') }, provenance: PROV(`mat ${o.mat} m thick bearing on rock`) });
    ids.levels.push(fnd.id);
    ids.mat = m.create({ type: 'slab', name: 'Mat (on rock)', parent: fnd.id, params: { outline: P([[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]], 'm'), thickness: P(o.mat, 'm'), offset: P(o.mat, 'm'), fc: P(55, 'MPa'), role: P('mat') }, provenance: PROV(`${o.mat} m mat over the whole lot, top at the lowest cellar floor`) }).id;
    for (const f of floorStack(o)) {
      const lvl = m.create({ type: 'level', name: f.name, params: { elevation: P(f.elevation, 'm'), height: P(f.height, 'm'), floor: P(f.k), kind: P(f.kind) }, provenance: PROV(`${f.kind} storey ${f.height} m`) });
      ids.levels.push(lvl.id);
      const k = Math.max(1, f.k), fc = by(o.fc, k), s = f.kind === 'cellar' ? 0 : setback(k, o), y0 = s, y1 = o.depth;
      const te = r3(by(o.ext, k) * o.wallScale), tc = r3(by(o.coreWall, k) * o.coreScale), cb = by(o.column, k), wall = (name, a, b, t, note, pier, extra = {}) => m.create({ type: 'wall', name, parent: lvl.id, params: { start: P(a, 'm'), end: P(b, 'm'), thickness: P(t, 'm'), fc: P(fc, 'MPa'), pier: P(pier), ...extra }, provenance: PROV(note) });
      // slab at the base of every storey above the mat (the lowest cellar's floor is the mat itself)
      if (f.k !== -o.cellars) {
        const outline = f.kind === 'cellar' ? [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]] : [[-W, y0], [W, y0], [W, y1], [-W, y1]];
        m.create({ type: 'slab', name: `${f.name} slab`, parent: lvl.id, params: { outline: P(outline, 'm'), thickness: P(f.kind === 'mechanical' || f.kind === 'lobby' || f.kind === 'crown' ? 0.4 : o.slab, 'm'), offset: P(0, 'm'), fc: P(Math.min(fc, 70), 'MPa'), sdl: P(f.kind === 'crown' ? 1.0 : o.sdl, 'kN/m2'), ll: P(f.kind === 'mechanical' ? 7.2 : f.kind === 'crown' ? 1.0 : o.ll, 'kN/m2') }, provenance: PROV(`floor slab; SDL ${o.sdl} kPa, live ${f.kind === 'mechanical' ? 7.2 : o.ll} kPa; core openings not cut`) });
      }
      if (f.kind === 'cellar') {   // perimeter foundation walls
        const c = [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]];
        for (let i = 0; i < 4; i++) wall(`${f.name} perimeter ${'SENW'[i]}`, c[i], c[(i + 1) % 4], 0.6, 'cellar perimeter wall retaining the street and neighbours', 'perimeter');
      }
      const tube = o.tube && f.kind !== 'cellar';
      wall(`${f.name} east wall`, [W - te / 2, y0], [W - te / 2, y1], te, `east shear wall ${te} m, f′c ${fc} MPa`, tube ? 'tube' : 'east');
      wall(`${f.name} west wall`, [-W + te / 2, y0], [-W + te / 2, y1], te, `west shear wall ${te} m, f′c ${fc} MPa`, tube ? 'tube' : 'west');
      if (tube) for (const [y, face] of [[y0 + o.tube.thickness / 2, 'south'], [y1 - o.tube.thickness / 2, 'north']]) {
        wall(`${f.name} ${face} facade wall`, [-W + te, y], [W - te, y], o.tube.thickness, `${face} facade: perforated concrete wall ${o.tube.thickness} m, ${Math.round(o.tube.solidity * 100)} % solid (windows), joined to the east and west walls as a tube`, 'tube', { solidity: P(o.tube.solidity) });
      }
      const [cx0, cx1] = o.core.x, [cy0, cy1] = o.core.y, cc = [[cx0, cy0], [cx1, cy0], [cx1, cy1], [cx0, cy1]];
      for (let i = 0; i < 4; i++) wall(`${f.name} core ${'SENW'[i]}`, cc[i], cc[(i + 1) % 4], tc, `core wall ${tc} m (lifts, stairs, risers; door openings not modelled)`, 'core');
      if (o.outriggers.floors.includes(f.k)) for (const y of [cy0, cy1]) for (const [xa, xb, side] of [[-W + te, cx0, 'west'], [cx1, W - te, 'east']])
        wall(`${f.name} outrigger ${side} y${y}`, [xa, y], [xb, y], o.outriggers.thickness, `outrigger wall ${o.outriggers.thickness} m, storey-deep, core to the ${side} wall`, 'outrigger');
      if (f.kind !== 'crown' && !tube) for (const [x, y, face] of [[-4.5, y0 + cb / 2, 'south'], [4.5, y0 + cb / 2, 'south'], [-4.5, y1 - cb / 2, 'north'], [4.5, y1 - cb / 2, 'north']])
        m.create({ type: 'column', name: `${f.name} ${face} col ${x < 0 ? 'W' : 'E'}`, parent: lvl.id, params: { center: P([x, r3(y)], 'm'), width: P(cb, 'm'), depth: P(cb, 'm'), rotation: P(0, 'deg'), fc: P(fc, 'MPa'), fy: P(420, 'MPa') }, provenance: PROV(`${face}-face column ${cb} m square${face === 'south' && s ? `, moved ${s} m north with the setback (a transfer is owed where it moves)` : ''}`) });
    }
    if (o.damper.mass > 0) {
      const crown = m.byType('level').find(l => l.params.kind?.value === 'crown');
      ids.damper = m.create({ type: 'damper', name: 'Tuned mass damper', parent: crown.id, params: { mass: P(o.damper.mass, 't'), center: P([0, (o.core.y[0] + o.core.y[1]) / 2], 'm'), size: P([6, 6], 'm'), height: P(3, 'm') }, provenance: PROV(`tuned mass damper ${o.damper.mass} t in the crown, tuned to the fundamental modes (assumed)`) }).id;
    }
  });
  app.regenerate();
  return ids;
}

/** The inputs of structure.towerGravity read from a model: concrete volumes, floor slabs, the mat and its rock. */
export function gravityInputs(m) {
  let concrete = 0;
  for (const e of m.all()) { if (['rebar', 'punching_zone', 'soil', 'soil_layer', 'context', 'damper'].includes(e.type)) continue; concrete += m.result(e.id)?.volume_m3 || 0; }
  const slabs = m.byType('slab'), mat = slabs.find(s => s.params.role?.value === 'mat');
  const floors = slabs.filter(s => s !== mat).map(s => ({ area: m.result(s.id)?.area_m2 || 0, sdl: s.params.sdl?.value ?? 0, ll: s.params.ll?.value ?? 0 }));
  if (!mat) return null;
  const lvl = m.get(mat.parent), soil = soilInputs(m), zBot = (lvl?.params.elevation?.value ?? 0) + (mat.params.offset?.value ?? 0) - mat.params.thickness.value;
  const depth = soil ? soil.surface - zBot : null, layer = soil?.layers.find(l => depth >= l.top - 1e-9 && depth < l.bottom) || soil?.layers.at(-1);
  const xs = mat.params.outline.value.map(q => q[0]), ys = mat.params.outline.value.map(q => q[1]);
  const damper = m.byType('damper').reduce((s, d) => s + (d.params.mass?.value ?? 0), 0);
  return { concrete_m3: concrete, floors, extra_kN: damper * 9.81, mat: { area: m.result(mat.id)?.area_m2 || 0, qa: layer?.kind === 'rock' ? layer.qa : null, layer: layer ? `${layer.name} at ${depth.toFixed(1)} m` : null, lx: Math.max(...xs) - Math.min(...xs), ly: Math.max(...ys) - Math.min(...ys), zBottom: zBot } };
}

/**
 * structure.towerGravity: the gravity load of a multi-storey model and the average bearing pressure under its
 * mat. Self-weight from the generated concrete volumes, superimposed dead and live from each floor slab's
 * area and stated loads (no live-load reduction: conservative). Gross pressure; the weight of excavated
 * ground is not credited (conservative). Wind, seismic and dynamics are NOT included.
 */
export const towerGravity = register({
  name: 'structure.towerGravity', version: '1.0.0',
  assumptions: ['reinforced high-strength concrete 24 kN/m³', 'no live-load reduction', 'gross bearing pressure, excavation relief not credited', 'uniform pressure under a rigid mat (no overturning: wind not analysed)'],
  inputs: null,
  run({ concrete_m3, floors, mat, gamma = 24, extra_kN = 0 }) {
    const self = concrete_m3 * gamma, SDL = floors.reduce((a, f) => a + f.area * f.sdl, 0) + extra_kN, L = floors.reduce((a, f) => a + f.area * f.ll, 0);
    const D = self + SDL, q = (D + L) / mat.area;
    return { self_kN: self, sdl_kN: SDL, D_kN: D, L_kN: L, total_kN: D + L, q_kPa: q, qa_kPa: mat.qa, util: mat.qa ? q / mat.qa : null, mat_area: mat.area, bearing_layer: mat.layer };
  },
});
