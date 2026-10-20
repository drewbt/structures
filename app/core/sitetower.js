// sitetower.js - an organic tower on an actual site: the Park Lane Hotel footprint at 36 Central Park South,
// among its real neighbours (app/data/site-park-lane.json, from OpenStreetMap). A DESIGN STUDY: not the owner's
// scheme, not a record of any approved project.
//
// Form, after the twisting and tapering supertalls (Shanghai Tower, Lakhta Center, Jeddah Tower): each floor
// plate is a superellipse that tapers and rotates with height; rotation is tied to the taper so every plate stays
// inside the lot. Structure, as in those towers, does not twist: a straight core and, at each storey, a concrete
// tube on the largest axis-aligned rectangle the plate contains; slab edges cantilever to the curved facade.
// A podium fills the Central Park South frontage on the site footprint. Every element is method "assumed",
// source "park-lane study"; the context buildings are "measured" (OpenStreetMap, ODbL).

import { createSoilProfile } from './geotech.js';
import { MANHATTAN_PROFILE, TOWER_DEFAULTS } from './tower.js';
import { scatterTrees } from './archgeom.js';

const P = (v, unit = '') => ({ value: v, unit });
const PROV = note => ({ source: 'park-lane study (design, synthetic)', trace: '', method: 'assumed', note });
const r2 = v => Math.round(v * 100) / 100;

export const SITE_TOWER_DEFAULTS = {
  floors: 52, lobby: 9.0,   // 52 floors, 279 m: the comfortable organic form chosen by tools/optimise-site.mjs (docs/park-lane-comfort.json)
  typical: 4.6, mechHeight: 9.0, mechFractions: [0.24, 0.48, 0.71, 0.89], crown: 20, cellars: 2, cellarHeight: 4.5, mat: 3.5,
  podium: 6,                                   // storeys of podium on the whole site footprint
  penthouses: 3, penthouseHeight: 6.0, terrace: 2.0,   // double-height penthouses at the top, glass line set back for wrap-around terraces
  crownFins: { height: 20, topScale: 0.45, twist: 20, spacing: 3.2, depth: 0.6 },   // the open crown above the roof
  plan: { cx: 12.65, cy: -24.1, a: 14.0, b: 12.0, n: 3.0, taper: 0.62, taperPower: 1.6, twistDeg: 90, segments: 48 },   // a quarter turn, tapering to 62 %   // base plate fills the 28.5 × 24.4 m block at the back of the lot
  core: { hx: 4.0, hy: 3.0, minScale: 0.6 },   // half-sizes (m): 8 × 6 core at the base, stepping down with the plate as lift banks drop off (not below 60 %)
  tubeT: [[1, 0.9], [21, 0.75], [41, 0.6]], coreT: [[1, 0.6], [41, 0.45]], fc: [[1, 96], [31, 70], [51, 55]],
  tubeSolidity: 0.7, tubeScale: 1.15, facadeSetback: 1.2,       // the tube sits at least this far inside the facade
  outrigger: 0.8, damper: 3200, spire: 0,
  facade: { weight: 0.5, fin: 1.5, finDepth: 0.45 }, slab: 0.25, sdl: 2.0, ll: 1.92,
  wind: TOWER_DEFAULTS.wind, seismic: TOWER_DEFAULTS.seismic, anchors: TOWER_DEFAULTS.anchors,
};
const by = (table, k) => table.reduce((v, [from, x]) => (k >= from ? x : v), table[0][1]);

/** The floor plate of tower storey k of n (1-based above the podium), as a counter-clockwise polygon. */
export const plateScale = (o, f) => 1 - (1 - o.plan.taper) * f ** o.plan.taperPower;
/** Core half-sizes at shaft fraction f, rounded to 0.5 m so the core steps in a few lifts-drop-off zones. */
export const coreAt = (o, f) => { const s = Math.max(o.core.minScale ?? 1, plateScale(o, f)); return { hx: Math.round(o.core.hx * s * 2) / 2, hy: Math.round(o.core.hy * s * 2) / 2 }; };
export function plate(o, f) {   // f: 0 at the base of the shaft, 1 at the top
  const p = o.plan, s = plateScale(o, f), th = (p.twistDeg * Math.PI / 180) * f ** p.taperPower;
  const a = p.a * s, b = p.b * s, e = 2 / p.n, c = Math.cos(th), sn = Math.sin(th), out = [];
  for (let i = 0; i < p.segments; i++) {
    const t = 2 * Math.PI * i / p.segments, ct = Math.cos(t), st = Math.sin(t);
    const x = a * Math.sign(ct) * Math.abs(ct) ** e, y = b * Math.sign(st) * Math.abs(st) ** e;
    out.push([r2(p.cx + x * c - y * sn), r2(p.cy + x * sn + y * c)]);
  }
  return out;
}

function inside([x, y], g) { let c = false; for (let i = 0; i < g.length; i++) { const [x1, y1] = g[i], [x2, y2] = g[(i + 1) % g.length]; if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) c = !c; } return c; }
const distToEdges = ([x, y], g) => Math.min(...g.map((a, i) => { const b = g[(i + 1) % g.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); }));

/** The largest centred, axis-aligned rectangle (aspect a:b) whose corners lie inside the plate at least `gap` from its edge. */
export function inscribedTube(o, outline, gap) {
  const { cx, cy, a, b } = o.plan; let lo = 0, hi = 1;
  const ok = s => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([u, v]) => { const q = [cx + u * a * s, cy + v * b * s]; return inside(q, outline) && distToEdges(q, outline) >= gap; });
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return { hx: Math.floor(a * lo * 10) / 10, hy: Math.floor(b * lo * 10) / 10 };
}

export function siteStack(o) {
  const mech = o.mechFractions.map(fr => Math.max(o.podium + 2, Math.round(fr * o.floors)));
  const out = []; for (let b = o.cellars; b >= 1; b--) out.push({ name: `B${b}`, k: -b, elevation: -b * o.cellarHeight, height: o.cellarHeight, kind: 'cellar' });
  let z = 0;
  for (let k = 1; k <= o.floors; k++) {
    const kind = k === 1 ? 'lobby' : mech.includes(k) ? 'mechanical' : k <= o.podium ? 'podium' : k > o.floors - (o.penthouses || 0) ? 'penthouse' : 'typical';
    const h = k === 1 ? o.lobby : kind === 'mechanical' ? o.mechHeight : kind === 'penthouse' ? o.penthouseHeight : o.typical;
    out.push({ name: k === 1 ? 'L1 Lobby' : `L${k}${kind === 'mechanical' ? ' Mechanical' : kind === 'penthouse' ? ' Penthouse' : ''}`, k, elevation: Math.round(z * 1000) / 1000, height: h, kind }); z += h;
  }
  out.push({ name: 'Crown', k: o.floors + 1, elevation: Math.round(z * 1000) / 1000, height: o.crown, kind: 'crown' });
  return { stack: out, mech };
}

export function createSiteTower(app, site, opts = {}) {
  const o = { ...SITE_TOWER_DEFAULTS, ...opts, plan: { ...SITE_TOWER_DEFAULTS.plan, ...(opts.plan || {}) } }, m = app.model, ids = { levels: [] };
  const { stack, mech } = siteStack(o), shaftTop = stack.at(-1).elevation, shaftBase = stack.find(s => s.k === o.podium + 1)?.elevation ?? 0;
  const lot = site.site.outline, lx = lot.map(q => q[0]), ly = lot.map(q => q[1]);
  m.batch('park lane study', () => {
    // ground, park and the real city
    createSoilProfile(m, { extent: [[Math.min(...lx) - 20, Math.min(...ly) - 20], [Math.max(...lx) + 20, Math.max(...ly) + 20]], surface: 0, profile: MANHATTAN_PROFILE, note: 'ASSUMED midtown Manhattan profile (no borings): fill, glacial till, Manhattan schist from 10 m' });
    const pk = site.park, R = 680;
    m.create({ type: 'context', name: 'Central Park', params: { outline: P([[pk.x0, pk.south_edge_y], [pk.x1, pk.south_edge_y], [pk.x1, pk.south_edge_y + 4000], [pk.x0, pk.south_edge_y + 4000]], 'm'), kind: P('park') }, provenance: PROV(`${pk.note}; about 4 km long to 110th Street`) });
    m.create({ type: 'context', name: 'City ground', params: { outline: P([[-30000, -30000], [30000, -30000], [30000, 30000], [-30000, 30000]], 'm'), kind: P('street') }, provenance: PROV('the ground of the city to the horizon (streets and plazas around the modelled blocks)') });
    void R;
    m.create({ type: 'context', name: 'Midtown buildings (OpenStreetMap)', params: { kind: P('buildings'), buildings: P(site.buildings, 'm') }, provenance: { source: site.source, trace: 'app/data/site-park-lane.json', method: 'measured', note: `${site.buildings.length} buildings within 650 m: footprints and heights from OpenStreetMap (NYC building import, extract 2015-12-30); ${site.buildings.filter(b => b.added).length} later towers added from published heights at approximate positions; ${site.buildings.filter(b => b.estimated).length} heights estimated. Data (c) OpenStreetMap contributors, ODbL.` } });
    m.create({ type: 'context', name: 'Park trees (illustrative)', params: { kind: P('trees'), trees: P(scatterTrees({ x0: pk.x0 + 10, y0: pk.south_edge_y + 6, x1: pk.x1 - 10, y1: pk.south_edge_y + 520, n: 1600 }), 'm') }, provenance: PROV('illustrative trees, for setting') });
    m.create({ type: 'wind', name: 'Wind (site)', params: { V: P(o.wind.V, 'm/s'), V10: P(o.wind.V10, 'm/s'), exposure: P(o.wind.exposure), beta_service: P(o.wind.beta_service), beta_ultimate: P(o.wind.beta_ultimate), snow_pg: P(1.2, 'kPa'), anchor_capacity: P(o.anchors.capacity, 'kN'), anchor_edge: P(o.anchors.edge, 'm') }, provenance: PROV('as the needle study (ASSUMPTIONS A-26): ASCE 7-16 maps from memory, Exposure C for the open park to the north') });
    m.create({ type: 'seismic', name: 'Earthquake (site)', params: { Ss: P(o.seismic.Ss, 'g'), S1: P(o.seismic.S1, 'g'), site_class: P(o.seismic.site_class), TL: P(o.seismic.TL, 's'), Ie: P(o.seismic.Ie) }, provenance: PROV('as the needle study (ASSUMPTIONS A-25/26)') });
    // foundation: mat on the site footprint
    const fnd = m.create({ type: 'level', name: 'Foundation', params: { elevation: P(-o.cellars * o.cellarHeight - o.mat, 'm'), height: P(o.mat, 'm') }, provenance: PROV(`mat ${o.mat} m on rock over the site footprint`) });
    ids.levels.push(fnd.id);
    m.create({ type: 'slab', name: 'Mat (on rock)', parent: fnd.id, params: { outline: P(lot, 'm'), thickness: P(o.mat, 'm'), offset: P(o.mat, 'm'), fc: P(55, 'MPa'), role: P('mat') }, provenance: PROV('mat over the whole site footprint') });
    const { cx, cy } = o.plan;
    for (const f of stack) {
      const lvl = m.create({ type: 'level', name: f.name, params: { elevation: P(f.elevation, 'm'), height: P(f.height, 'm'), floor: P(f.k), kind: P(f.kind) }, provenance: PROV(`${f.kind} storey ${f.height} m`) });
      ids.levels.push(lvl.id);
      const k = Math.max(1, f.k), fc = by(o.fc, k), tt = Math.round(by(o.tubeT, k) * (o.tubeScale ?? 1) * 100) / 100, tc = by(o.coreT, k);
      const shaft = f.kind !== 'cellar' && f.kind !== 'podium' && f.k !== 1, frac = shaft ? Math.max(0, (f.elevation - shaftBase) / Math.max(1, shaftTop - shaftBase)) : 0;
      const pl = plate(o, frac), tube = inscribedTube(o, pl, o.facadeSetback + tt / 2), core = coreAt(o, frac);
      if (pl.some(q => !inside(q, lot))) throw new Error(`${f.name}: the floor plate leaves the lot: less twist or more taper`);
      if (tube.hx < core.hx + 2 || tube.hy < core.hy + 2) throw new Error(`${f.name}: the plate is too small for the core (tube ${2 * tube.hx} × ${2 * tube.hy} m): less taper`);
      const wall = (name, a, b, t, note, pier, extra = {}) => m.create({ type: 'wall', name, parent: lvl.id, params: { start: P(a, 'm'), end: P(b, 'm'), thickness: P(t, 'm'), fc: P(fc, 'MPa'), pier: P(pier), ...extra }, provenance: PROV(note) });
      const slabOutline = f.kind === 'cellar' || f.kind === 'podium' || f.k === 1 ? lot : pl;
      if (f.k !== -o.cellars) m.create({ type: 'slab', name: `${f.name} slab`, parent: lvl.id, params: { outline: P(slabOutline, 'm'), thickness: P(f.kind === 'mechanical' || f.kind === 'crown' || f.k === 1 ? 0.4 : o.slab, 'm'), offset: P(0, 'm'), fc: P(Math.min(fc, 70), 'MPa'), sdl: P(f.kind === 'crown' ? 1.0 : o.sdl, 'kN/m2'), ll: P(f.kind === 'mechanical' ? 7.2 : f.kind === 'crown' ? 1.0 : o.ll, 'kN/m2') }, provenance: PROV(slabOutline === lot ? 'floor over the site footprint' : 'organic floor plate: superellipse, tapered and turned at this height; edge cantilevers from the tube') });
      if (f.kind === 'cellar') for (let i = 0; i < lot.length; i++) { const a = lot[i], b = lot[(i + 1) % lot.length]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 2) wall(`${f.name} perimeter ${i + 1}`, a, b, 0.6, 'cellar perimeter wall on the site footprint', 'perimeter'); }
      // the tube: four walls on the inscribed rectangle; the north and south ones perforated (windows)
      const X0 = cx - tube.hx, X1 = cx + tube.hx, Y0 = cy - tube.hy, Y1 = cy + tube.hy, sol = { solidity: P(o.tubeSolidity) };
      if (f.kind !== 'crown') {   // the open crown carries no tube: only the core rises through it (lift overrun)
      wall(`${f.name} tube east`, [r2(X1 - tt / 2), r2(Y0)], [r2(X1 - tt / 2), r2(Y1)], tt, `tube ${tt} m, ${Math.round(o.tubeSolidity * 100)} % solid`, 'tube', sol);
      wall(`${f.name} tube west`, [r2(X0 + tt / 2), r2(Y0)], [r2(X0 + tt / 2), r2(Y1)], tt, `tube ${tt} m, ${Math.round(o.tubeSolidity * 100)} % solid`, 'tube', sol);
      wall(`${f.name} tube south`, [r2(X0 + tt), r2(Y0 + tt / 2)], [r2(X1 - tt), r2(Y0 + tt / 2)], tt, `tube ${tt} m, perforated`, 'tube', sol);
      wall(`${f.name} tube north`, [r2(X0 + tt), r2(Y1 - tt / 2)], [r2(X1 - tt), r2(Y1 - tt / 2)], tt, `tube ${tt} m, perforated`, 'tube', sol);
      }
      const cc = [[cx - core.hx, cy - core.hy], [cx + core.hx, cy - core.hy], [cx + core.hx, cy + core.hy], [cx - core.hx, cy + core.hy]].map(q => q.map(r2));
      for (let i = 0; i < 4; i++) wall(`${f.name} core ${'SENW'[i]}`, cc[i], cc[(i + 1) % 4], tc, `core wall ${tc} m`, 'core');
      if (mech.includes(f.k)) for (const y of [cy - core.hy, cy + core.hy]) for (const [xa, xb, side] of [[X0 + tt, cx - core.hx, 'west'], [cx + core.hx, X1 - tt, 'east']])
        wall(`${f.name} outrigger ${side} y${r2(y)}`, [r2(xa), r2(y)], [r2(xb), r2(y)], o.outrigger, `outrigger wall ${o.outrigger} m, storey-deep`, 'outrigger');
      if (f.kind === 'podium' || f.k === 1) for (const [x, y] of [[-8, 10], [5, 10], [-8, 2], [5, 2], [4, -6]]) m.create({ type: 'column', name: `${f.name} podium col ${x},${y}`, parent: lvl.id, params: { center: P([x, y], 'm'), width: P(0.8, 'm'), depth: P(0.8, 'm'), rotation: P(0, 'deg'), fc: P(fc, 'MPa'), fy: P(420, 'MPa') }, provenance: PROV('podium column carrying the frontage floors (gravity only)') });
      if (f.kind === 'penthouse') {   // glass line set back from the slab edge: wrap-around terraces behind a glass balustrade
        const n = pl.length, c = [pl.reduce((s, q) => s + q[0], 0) / n, pl.reduce((s, q) => s + q[1], 0) / n], rbar = pl.reduce((s, q) => s + Math.hypot(q[0] - c[0], q[1] - c[1]), 0) / n, kk = 1 - o.terrace / rbar;
        const inset = pl.map(q => [r2(c[0] + (q[0] - c[0]) * kk), r2(c[1] + (q[1] - c[1]) * kk)]);
        m.create({ type: 'curtain_wall', name: `${f.name} facade`, parent: lvl.id, params: { outline: P(inset, 'm'), kind: P('lobby'), weight: P(o.facade.weight, 'kPa'), fin_spacing: P(o.facade.fin, 'm'), fin_depth: P(o.facade.finDepth, 'm') }, provenance: PROV(`double-height penthouse glazing, about ${o.terrace} m back from the slab edge`) });
        m.create({ type: 'curtain_wall', name: `${f.name} terrace balustrade`, parent: lvl.id, params: { outline: P(pl, 'm'), kind: P('balustrade'), height: P(1.2, 'm'), weight: P(0.4, 'kPa') }, provenance: PROV('1.2 m glass balustrade at the terrace edge') });
      } else if (f.kind === 'crown') {   // the flourish: an open crown of blades, lit at the tips; open, so little wind area
        const cf = o.crownFins;
        m.create({ type: 'curtain_wall', name: 'Crown blades', parent: lvl.id, params: { outline: P(pl, 'm'), kind: P('crownfins'), height: P(cf.height, 'm'), top_scale: P(cf.topScale), twist: P(cf.twist, 'deg'), fin_spacing: P(cf.spacing, 'm'), fin_depth: P(cf.depth, 'm'), weight: P(1.0, 'kPa') }, provenance: PROV(`open crown: ${cf.height} m blades every ${cf.spacing} m leaning in to ${Math.round(cf.topScale * 100)} % and turning ${cf.twist}°, lit at the tips; an open lattice (its wind area is the blades, not the outline)`) });
      } else if (f.kind !== 'cellar') {
        const fo = f.kind === 'podium' || f.k === 1 ? lot : pl;
        m.create({ type: 'curtain_wall', name: `${f.name} facade`, parent: lvl.id, params: { outline: P(fo, 'm'), kind: P(f.k === 1 ? 'lobby' : f.kind === 'podium' ? 'typical' : f.kind), weight: P(o.facade.weight, 'kPa'), fin_spacing: P(o.facade.fin, 'm'), fin_depth: P(o.facade.finDepth, 'm') }, provenance: PROV(f.kind === 'crown' ? 'glass crown lantern following the turned plate, lit' : f.kind === 'mechanical' ? 'louvred mechanical floor' : fo === lot ? 'podium glazing on the site footprint' : 'curtain wall on the organic plate, fins at 1.5 m') });
        if (f.kind === 'crown' && o.spire > 0) m.create({ type: 'spire', name: 'Spire', parent: lvl.id, params: { center: P([cx, cy], 'm'), height: P(o.spire, 'm'), base_radius: P(2.0, 'm') }, provenance: PROV(`spire ${o.spire} m, architectural; its wind design is owed (ASCE 7 Ch. 29)`) });
      }
    }
    if (o.damper > 0) { const crown = m.byType('level').find(l => l.params.kind?.value === 'crown'); m.create({ type: 'damper', name: 'Tuned mass damper', parent: crown.id, params: { mass: P(o.damper, 't'), center: P([cx, cy], 'm'), size: P([5, 5], 'm'), height: P(3, 'm') }, provenance: PROV(`tuned mass damper ${o.damper} t in the crown (assumed)`) }); }
  });
  app.regenerate();
  return ids;
}
