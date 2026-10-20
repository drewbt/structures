// towerdyn.js - the tower's lateral system as a frame for the stiffness engine, read from the model's own
// walls, and the wind and vibration checks that use the engine's answers.
//
// Each storey's walls are grouped into piers by their `pier` tag (east, west, core). A pier is a vertical
// Timoshenko beam through the storey at the pier's centroid, with the gross section of its walls (A, I about
// both axes, St Venant J, shear areas). At every floor the piers are tied by links that are rigid in plan
// (the slab as a diaphragm) and whose out-of-plane bending is the slab's coupling stiffness; an outrigger
// storey ties them at mid-height with the outrigger walls as deep beams. Where a setback moves a pier's
// centroid, a rigid link joins the storey below to the storey above. Masses: walls to their pier; slab,
// superimposed dead and the damper to the piers by plan strip. Fixed at grade.
import { register } from './functions.js';
import * as WR from './standards/asce7-16-wind.js';
import * as SE from './standards/asce7-16-seismic.js';
import * as OT from './standards/asce7-16-other.js';
import { soilInputs } from './geotech.js';
import { gustFlexible, alongWindForces, alongWindAccel, acrossWind, meanSpeed } from './wind.js';

const num = (el, k, d) => { const p = el.params[k]; return p === undefined ? d : p.value; };
export const Ec = fc => 4700 * Math.sqrt(fc) * 1000;               // kN/m², ACI 318-19 19.2.2.1(b)
const RIGID = { area_m2: 1e3, Iy: 1e3, Iz: 1e3, J: 1e3 };
const frameXY = (nodes, i) => nodes[i].p;
export const DYN = {
  slab_coupling_width: 'core depth', slab_cracked: 0.35,             // 1.4 × 0.25 Ig (ACI 6.6.3.1 service stiffness of a flat slab)
  wall_service: 1.0,                                                  // 1.4 × 0.7 Ig ≈ Ig, uncracked walls at service (ACI 6.6.3.1.2 / R6.6.3.1.2)
  density_t: 2.4, strips: { west: 0.25, core: 0.5, east: 0.25, tube: 0.5 }, shear: true,   // shear: Timoshenko shear areas on the piers (tests turn it off to compare with Euler-Bernoulli closed forms)
};

/** Gross section of a set of axis-aligned wall rectangles about their joint centroid. */
export function pierSection(walls, { closed = false } = {}) {
  const R = walls.map(w => {
    const [a, b] = [w.start, w.end], t = w.thickness * (w.solidity ?? 1), alongX = Math.abs(b[1] - a[1]) < 1e-9, alongY = Math.abs(b[0] - a[0]) < 1e-9;
    if (!alongX && !alongY) throw new Error('pierSection: walls must run along x or y');
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, lx: alongX ? L : t, ly: alongX ? t : L, alongX, t, L, a, b };
  });
  const A = R.reduce((s, r) => s + r.lx * r.ly, 0), xc = R.reduce((s, r) => s + r.lx * r.ly * r.cx, 0) / A, yc = R.reduce((s, r) => s + r.lx * r.ly * r.cy, 0) / A;
  const Iyy = R.reduce((s, r) => s + r.ly * r.lx ** 3 / 12 + r.lx * r.ly * (r.cx - xc) ** 2, 0);   // about a y axis: x-direction bending
  const Ixx = R.reduce((s, r) => s + r.lx * r.ly ** 3 / 12 + r.lx * r.ly * (r.cy - yc) ** 2, 0);
  let J, Avx, Avy;
  if (closed) {   // thin-walled closed box: Bredt, J = 4 Ae² / ∮ds/t; shear carried by the webs
    const xs = R.flatMap(r => [r.a[0], r.b[0]]), ys = R.flatMap(r => [r.a[1], r.b[1]]), wx = Math.max(...xs) - Math.min(...xs), wy = Math.max(...ys) - Math.min(...ys);
    J = 4 * (wx * wy) ** 2 / R.reduce((s, r) => s + r.L / r.t, 0);
    Avx = R.filter(r => r.alongX).reduce((s, r) => s + r.lx * r.ly, 0); Avy = R.filter(r => !r.alongX).reduce((s, r) => s + r.lx * r.ly, 0);
  } else { J = R.reduce((s, r) => s + Math.max(r.lx, r.ly) * Math.min(r.lx, r.ly) ** 3 / 3, 0); Avx = Avy = 5 / 6 * A; }
  const xmin = Math.min(...R.map(r => r.cx - r.lx / 2)), xmax = Math.max(...R.map(r => r.cx + r.lx / 2)), ymin = Math.min(...R.map(r => r.cy - r.ly / 2)), ymax = Math.max(...R.map(r => r.cy + r.ly / 2));
  return { A, xc, yc, Iyy, Ixx, J, Avx, Avy, Sy: Iyy / Math.max(xc - xmin, xmax - xc), Sx: Ixx / Math.max(yc - ymin, ymax - yc) };
}

/** The storeys above grade with their piers, outriggers, masses and loads, read from the model. */
export function towerStoreys(model) {
  const levels = model.byType('level').filter(l => num(l, 'floor', null) !== null && num(l, 'floor') >= 1).sort((a, b) => num(a, 'elevation') - num(b, 'elevation'));
  if (!levels.length) throw new Error('no storeys above grade: tower levels carry a floor number from 1');
  const damper = model.byType('damper')[0];
  return levels.map((l, i) => {
    const kids = model.children(l.id), walls = kids.filter(k => k.type === 'wall'), slab = kids.find(k => k.type === 'slab');
    const tag = t => walls.filter(w => num(w, 'pier', null) === t).map(w => ({ id: w.id, start: num(w, 'start'), end: num(w, 'end'), thickness: num(w, 'thickness'), fc: num(w, 'fc', 55), solidity: num(w, 'solidity', 1) }));
    const tube = tag('tube'), piers = tube.length ? { tube, core: tag('core') } : { west: tag('west'), core: tag('core'), east: tag('east') };
    for (const [k, v] of Object.entries(piers)) if (!v.length) throw new Error(`${l.name}: no ${k} pier walls`);
    const vol = id => model.result(id)?.volume_m3 || 0;
    const wallMass = Object.fromEntries(Object.entries(piers).map(([k, v]) => [k, v.reduce((s, w) => s + vol(w.id) * w.solidity, 0) * DYN.density_t]));
    const outriggers = tag('outrigger');
    const slabArea = slab ? model.result(slab.id)?.area_m2 || 0 : 0;
    const slabMass = (slab ? vol(slab.id) * DYN.density_t + slabArea * num(slab, 'sdl', 0) / 9.81 : 0) + outriggers.reduce((s, w) => s + vol(w.id), 0) * DYN.density_t;
    const live = slab ? slabArea * num(slab, 'll', 0) : 0, colMass = kids.filter(k => k.type === 'column').reduce((s, c) => s + vol(c.id), 0) * DYN.density_t;
    const isTop = i === levels.length - 1, dmass = isTop && damper ? num(damper, 'mass', 0) : 0;
    return { id: l.id, name: l.name, z0: num(l, 'elevation'), h: num(l, 'height'), piers, outriggers, wallMass, slabMass: slabMass + colMass, live, slabArea, slabT: slab ? num(slab, 'thickness', 0.25) : 0, damperMass: dmass,
      ...(() => { const ew = walls.filter(w => /east wall|west wall/.test(w.name)), xs = ew.map(w => num(w, 'start')[0]), t = num(ew[0], 'thickness'), e = ew[0]; return { width_x: Math.max(...xs) - Math.min(...xs) + t, depth_y: Math.abs(num(e, 'end')[1] - num(e, 'start')[1]) }; })() };
  });
}

/**
 * tower.frame: the engine model (6 DOF a node) of the lateral system, with lumped masses and the gravity
 * cases D and L. Wind cases are added by towerWindCases once the frequencies are known.
 */
export const towerFrame = register({
  name: 'tower.frame', version: '1.0.0',
  assumptions: ['piers as vertical Timoshenko beams with the gross section of their walls (service stiffness ≈ Ig, ACI R6.6.3.1.2)', 'floors rigid in plan; slab coupling 0.35 Ig over the core depth', 'outriggers as deep beams at the mid-height of their storey', 'columns carry gravity only and are not in the frame', 'fixed at grade: the cellars and the ground are taken as rigid', 'lumped translational masses; rotary inertia comes from the spread of mass between the piers'],
  inputs: null,
  run({ storeys, modes = 6 }) {
    const nodes = [], members = [], meta = [], key = new Map(), mass = [];
    const node = (p, tag, z, x, y, fixed = false) => {
      const k = `${p}|${z.toFixed(4)}|${x.toFixed(4)}|${y.toFixed(4)}`; if (key.has(k)) return key.get(k);
      const i = nodes.length; nodes.push({ mark: `${p}@${z.toFixed(2)}`, p: [x, y, z], restrained: fixed ? [1, 1, 1, 1, 1, 1] : [0, 0, 0, 0, 0, 0] }); meta.push({ pier: p, z, tag }); mass.push(0); key.set(k, i); return i;
    };
    const sections = [];   // per member: the pier section for stresses (kept out of the engine model)
    const beam = (a, b, s, E, G, mark, sec = null) => { sections.push(sec); members.push({ mark, a, b, beam: true, E, G, ...s }); };
    const floorNodes = new Map();   // z → {west, core, east} node at the floor (the storey above's bottom node)
    let prevTop = null;
    storeys.forEach((st, k) => {
      const zb = st.z0, zt = st.z0 + st.h, here = {};
      const P = Object.keys(st.piers), outer = P.filter(p => p !== 'core');
      for (const p of P) {
        const sec = pierSection(st.piers[p], { closed: p === 'core' || p === 'tube' }), fc = Math.min(...st.piers[p].map(w => w.fc)), E = Ec(fc) * DYN.wall_service, G = E / 2.4;
        const s = { area_m2: sec.A, Iy: sec.Iyy, Iz: sec.Ixx, J: sec.J, ...(DYN.shear ? { Avz: sec.Avx, Avy: sec.Avy } : {}) };
        const nb = node(p, 'floor', zb, sec.xc, sec.yc, zb <= 1e-9 && k === 0), nt = node(p, 'floor', zt, sec.xc, sec.yc);
        if (prevTop && prevTop[p] !== nb) beam(prevTop[p], nb, RIGID, Ec(fc), Ec(fc) / 2.4, `${st.name} ${p} offset`);   // the setback moves the centroid
        if (st.outriggers.length) {   // split at mid-height for the outrigger
          const nm = node(p, 'mid', zb + st.h / 2, sec.xc, sec.yc); beam(nb, nm, s, E, G, `${st.name} ${p} lower`, sec); beam(nm, nt, s, E, G, `${st.name} ${p} upper`, sec); here[p + 'Mid'] = nm;
        } else beam(nb, nt, s, E, G, `${st.name} ${p}`, sec);
        here[p] = { b: nb, t: nt, sec, E };
        // masses: walls half to each end
        mass[nb] += st.wallMass[p] / 2; mass[nt] += st.wallMass[p] / 2;
        mass[nb] += (st.slabMass) * DYN.strips[p];
      }
      if (st.damperMass) mass[here.core.t] += st.damperMass;
      // coupling (wide-column model): rigid arms from each pier's centroid to its face, and the slab (every floor)
      // or the outrigger (mid-height of an outrigger storey) across the clear gap between the core and the walls
      const Es = Ec(55), cw = st.piers.core.flatMap(w => [w.start, w.end]), cxmin = Math.min(...cw.map(q => q[0])) , cxmax = Math.max(...cw.map(q => q[0])), cyc = here.core.sec.yc;
      const depthCore = Math.max(...cw.map(q => q[1])) - Math.min(...cw.map(q => q[1])), slabI = DYN.slab_cracked * depthCore * st.slabT ** 3 / 12, tc = Math.min(...st.piers.core.map(w => w.thickness));
      const faceOf = (p, side) => { const ws = st.piers[p].filter(w => Math.abs(w.start[0] - w.end[0]) < 1e-9 && (side === 'W' ? w.start[0] < 0 : w.start[0] > 0)); const w = ws[0]; return side === 'W' ? w.start[0] + w.thickness / 2 : w.start[0] - w.thickness / 2; };
      const arm = (from, p, x, y, z, E) => { const n = node(p + '#arm', 'arm', z, x, y); beam(from, n, RIGID, E, E / 2.4, `${st.name} ${p} arm`); return n; };
      const couple = (z, nodeCore, nodePier, p, side, props, E, mark) => {
        const xc = side === 'W' ? cxmin - tc / 2 : cxmax + tc / 2, xp = faceOf(p, side);
        const a = arm(nodeCore, 'core' + side + p, xc, cyc, z, E), b = arm(nodePier, p + side, xp, cyc, z, E);
        beam(a, b, props, E, E / 2.4, mark);
      };
      for (const p of outer) for (const side of (p === 'tube' ? ['W', 'E'] : [p === 'west' ? 'W' : 'E'])) {
        if (st.slabT > 0) couple(zb, here.core.b, here[p].b, p, side, { area_m2: 1e3, Iy: Math.max(slabI, 1e-6), Iz: 1e3, J: Math.max(depthCore * st.slabT ** 3 / 3 * DYN.slab_cracked, 1e-6) }, Es, `${st.name} slab ${p}${side}`);
        if (st.outriggers.length) {
          const ws = st.outriggers.filter(w => (side === 'W' ? w.start[0] + w.end[0] < 0 : w.start[0] + w.end[0] > 0)), t = ws.reduce((s, w) => s + w.thickness, 0);
          if (t > 0) { const Eo = Ec(Math.min(...ws.map(w => w.fc))); couple(zb + st.h / 2, here.coreMid, here[p + 'Mid'], p, side, { area_m2: t * st.h, Iy: t * st.h ** 3 / 12, Iz: 1e3, J: st.h * t ** 3 / 3, Avz: 5 / 6 * t * st.h }, Eo, `${st.name} outrigger ${p}${side}`); }
        }
      }
      floorNodes.set(zb, Object.fromEntries(P.map(p => [p, here[p].b])));
      prevTop = Object.fromEntries(P.map(p => [p, here[p].t]));
      if (k === storeys.length - 1) floorNodes.set(zt, Object.fromEntries(P.map(p => [p, here[p].t])));
    });
    // roof diaphragm
    const zTop = storeys.at(-1).z0 + storeys.at(-1).h, top = floorNodes.get(zTop), Es = Ec(55);
    for (const p of Object.keys(top).filter(p => p !== 'core')) { const pc = frameXY(nodes, top.core), pp = frameXY(nodes, top[p]); if (Math.hypot(pc[0] - pp[0], pc[1] - pp[1]) > 1e-6) beam(top.core, top[p], { area_m2: 1e3, Iy: 1e-2, Iz: 1e3, J: 1e-2 }, Es, Es / 2.4, `roof ${p}`); else beam(top.core, node(p + '#roof', 'arm', zTop, pp[0] + 1, pp[1]), RIGID, Es, Es / 2.4, 'roof arm'), beam(node(p + '#roof', 'arm', zTop, pp[0] + 1, pp[1]), top[p], { area_m2: 1e3, Iy: 1e-2, Iz: 1e3, J: 1e-2 }, Es, Es / 2.4, `roof ${p}`); }
    const N = nodes.length, zero = () => new Array(6 * N).fill(0), mass_t = zero(), D = zero(), L = zero();
    mass.forEach((m, i) => { mass_t[6 * i] = mass_t[6 * i + 1] = mass_t[6 * i + 2] = m; D[6 * i + 2] = -m * 9.81; });
    storeys.forEach(st => { const f = floorNodes.get(st.z0); for (const p of Object.keys(f)) L[6 * f[p] + 2] -= st.live * DYN.strips[p]; });
    const engine = { youngs_modulus_kN_per_m2: Ec(55), dofs_per_node: 6, nodes, members, cases: [{ name: 'D', loads: D }, { name: 'L', loads: L }], mass_t, modes_wanted: modes };
    const floors = [...floorNodes.entries()].sort((a, b) => a[0] - b[0]).map(([z, n]) => ({ z, ...n }));
    return { engine, meta, sections, floors, total_mass_t: mass.reduce((a, b) => a + b, 0), height: zTop };
  },
});

/** Direction of a mode from its shape: effective mass in x, in y, or neither (torsion). */
export function classifyModes(frame, modes) {
  const m = frame.engine.mass_t, N = frame.engine.nodes.length;
  return modes.map((md, k) => {
    let Lx = 0, Ly = 0, Mt = 0; for (let i = 0; i < N; i++) { Lx += m[6 * i] * md.shape[6 * i]; Ly += m[6 * i] * md.shape[6 * i + 1]; Mt += m[6 * i]; }
    const ex = Lx * Lx / Mt, ey = Ly * Ly / Mt, dir = ex > 0.1 && ex >= ey ? 'x' : ey > 0.1 ? 'y' : 't';
    return { k, n: md.frequency_hz, dir, mx: ex, my: ey };
  });
}

/** The fundamental mode in a direction: frequency, modal mass with the top = 1, and the shape exponent. */
export function modeIn(frame, modes, dir) {
  const cls = classifyModes(frame, modes), c = cls.find(q => q.dir === dir); if (!c) return null;
  const md = modes[c.k], top = frame.floors.at(-1).core, d = dir === 'x' ? 0 : 1, psiTop = md.shape[6 * top + d];
  const H = frame.height, mid = frame.floors.reduce((best, f) => Math.abs(f.z - H / 2) < Math.abs(best.z - H / 2) ? f : best), phiMid = md.shape[6 * mid.core + d] / psiTop;
  const xi = phiMid > 0 && phiMid < 1 ? Math.log(phiMid) / Math.log(mid.z / H) : 1.5;
  return { n: c.n, k: c.k, m1_kg: 1000 / (psiTop * psiTop), xi };
}

/** Static wind cases for the frame: Case 1 in x and y at a wind speed V, and Case 2 (0.75 with torsion) in x. */
export function towerWindCases(frame, storeys, { V, exp, gf }) {
  const N = frame.engine.nodes.length, H = frame.height, out = [];
  for (const dir of ['x', 'y']) {
    const bands = storeys.map(s => ({ z0: s.z0, z1: s.z0 + s.h, width: dir === 'x' ? s.depth_y : s.width_x }));
    const Bref = dir === 'x' ? storeys[0].depth_y : storeys[0].width_x, Lref = dir === 'x' ? storeys[0].width_x : storeys[0].depth_y;
    const aw = alongWindForces.run({ bands, h: H, L: Lref, B: Bref, Gf: gf[dir], V, exp });
    const loads = new Array(6 * N).fill(0), loadsT = new Array(6 * N).fill(0);
    aw.forces.forEach((f, i) => { const fl = frame.floors.find(q => Math.abs(q.z - f.z) < 1e-6); const d = dir === 'x' ? 0 : 1; loads[6 * fl.core + d] += f.F; loadsT[6 * fl.core + d] += 0.75 * f.F; loadsT[6 * fl.core + 5] += 0.75 * f.F * WR.TORSION_ECC * f.width; });
    out.push({ name: `W${dir}`, loads, aw }); if (dir === 'x') out.push({ name: `W${dir}T`, loads: loadsT, aw });
  }
  return out;
}

/**
 * tower.windChecks: the screening checks from the engine's modes and static results.
 */
export const towerWindChecks = register({
  name: 'tower.windChecks', version: '1.0.0',
  assumptions: [WR.EDITION, 'serviceability under the 10-year wind with the stated damping; strength under the basic (ultimate) wind', 'across-wind by the NBCC expression where it applies; otherwise indicative and the wind tunnel is required (ASCE 7-16 27.1.3, Chapter 31)', 'mat bearing: rigid mat, linear pressure, ASD 0.6D + 0.6W and D + 0.6W'],
  inputs: null,
  run({ frame, storeys, modes, service, ultimate, site, gravity, mat }) {
    const H = frame.height, top = frame.floors.at(-1), checks = [], res = {};
    const disp = (cs, node, d) => cs.d[6 * node + d];
    for (const dir of ['x', 'y']) {
      const d = dir === 'x' ? 0 : 1, mode = modeIn(frame, modes, dir), other = modeIn(frame, modes, dir === 'x' ? 'y' : 'x');
      const B = dir === 'x' ? storeys[0].depth_y : storeys[0].width_x, L = dir === 'x' ? storeys[0].width_x : storeys[0].depth_y;
      const sv = service.cases.find(c => c.name === `W${dir}`);
      const drift = Math.abs(disp(sv, top.core, d));
      let maxStorey = 0; for (let i = 1; i < frame.floors.length; i++) { const dz = frame.floors[i].z - frame.floors[i - 1].z; maxStorey = Math.max(maxStorey, Math.abs(disp(sv, frame.floors[i].core, d) - disp(sv, frame.floors[i - 1].core, d)) / dz); }
      const along = alongWindAccel.run({ h: H, B, L, n1: mode.n, beta: site.beta_service, V: site.V10, exp: site.exposure, m1: mode.m1_kg, xi: mode.xi });
      const totalMass = frame.total_mass_t * 1000, rhoB = totalMass / (storeys.reduce((s, q) => s + q.width_x * q.depth_y * q.h, 0));
      const VH = meanSpeed(H, site.V10, site.exposure), across = acrossWind.run({ W: B, D: L, H, nW: other.n, beta: site.beta_service, VH, rhoB });
      const VHu = meanSpeed(H, site.V, site.exposure);
      res[dir] = { mode, other, drift, maxStorey, along, across, VH, VHu, lockin_ultimate: across.Vcr / VHu };
      checks.push({ name: `wind from ${dir === 'x' ? 'east or west' : 'north or south (the park)'}: top drift, 10-year wind`, clause: 'project criterion (ASCE 7-16 App. C)', demand: drift, capacity: H * WR.CRITERIA.drift_ratio, util: drift / (H * WR.CRITERIA.drift_ratio) });
      checks.push({ name: `wind ${dir}: worst storey drift ratio, 10-year wind`, clause: 'project criterion (ASCE 7-16 App. C)', demand: maxStorey, capacity: WR.CRITERIA.storey_drift, util: maxStorey / WR.CRITERIA.storey_drift });
      checks.push({ name: `wind ${dir}: along-wind peak acceleration, mode ${mode.k + 1} at ${mode.n.toFixed(3)} Hz (milli-g)`, clause: 'C26.11; criterion ISO 10137 range', demand: along.a_peak / 9.81 * 1000, capacity: WR.CRITERIA.accel_mg, util: along.a_peak / 9.81 * 1000 / WR.CRITERIA.accel_mg });
      checks.push({ name: `wind ${dir}: across-wind peak acceleration at ${other.n.toFixed(3)} Hz (milli-g)${across.valid ? '' : ` — INDICATIVE: ${!across.inRange ? `reduced velocity ${across.reduced_velocity.toFixed(1)} > ${WR.ACROSS.reduced_velocity_max}` : ''}${!across.inRange && !across.inAspect ? ', ' : ''}${!across.inAspect ? `H/√(WD) ${across.aspect.toFixed(1)} > ${WR.ACROSS.aspect_max}` : ''}; wind tunnel required`}`, clause: 'NBCC 2015 Comm. I (screening)', demand: across.a_peak / 9.81 * 1000, capacity: WR.CRITERIA.accel_mg, util: across.a_peak / 9.81 * 1000 / WR.CRITERIA.accel_mg, indicative: !across.valid });
    }
    // strength: base of each pier under 1.2D + 1.0W + 0.5L and 0.9D + 1.0W (elastic section screening; engine N tension +)
    const caseOf = n => ultimate.cases.find(c => c.name === n);
    let worst = { c: 0, t: 0 };
    frame.engine.members.forEach((m, i) => {
      const sec = frame.sections[i]; if (!sec || frame.engine.nodes[m.a].p[2] > 1e-9) return;
      const N = n => caseOf(n).N[i], Mo = (n, k) => caseOf(n).F[12 * i + k];
      for (const w of ['Wx', 'Wy', 'WxT']) for (const [a, l] of [[1.2, 0.5], [0.9, 0]]) {
        const Nc = a * N('D') + l * N('L') + N(w), My = a * Mo('D', 4) + l * Mo('L', 4) + Mo(w, 4), Mz = a * Mo('D', 5) + l * Mo('L', 5) + Mo(w, 5);
        const bend = Math.abs(My) / sec.Sy + Math.abs(Mz) / sec.Sx;
        worst.c = Math.max(worst.c, (-Nc / sec.A + bend) / 1000); worst.t = Math.max(worst.t, (Nc / sec.A + bend) / 1000);
      }
    });
    const fcBase = Math.min(...Object.values(storeys[0].piers).flat().map(w => w.fc));
    checks.push({ name: 'pier base: peak compressive stress, 1.2D + 1.0W + 0.5L / 0.9D + 1.0W (elastic section, MPa)', clause: 'screening vs φ 0.85 f′c, φ 0.65', demand: worst.c, capacity: 0.65 * 0.85 * fcBase, util: worst.c / (0.65 * 0.85 * fcBase) });
    const rho = Math.max(0, worst.t) / (0.9 * 420);
    checks.push({ name: 'pier base: vertical steel for the peak tensile stress (ratio)', clause: 'screening vs 2 % practical limit (ACI 18.10 / 11.6)', demand: rho, capacity: 0.02, util: rho / 0.02 });
    // mat bearing and overturning (ASD). Where the resultant leaves the middle third, rock anchors along the
    // windward edge are sized to bring it back: (M − T a) / (P + T) = L/6 with a = L/2 − edge.
    for (const dir of ['x', 'y']) {
      const aw = ultimate.aw[dir], Lm = dir === 'x' ? mat.lx : mat.ly, Bm = dir === 'x' ? mat.ly : mat.lx;
      const M = 0.6 * aw.forces.reduce((s, f) => s + f.F * (f.zm - mat.zBottom), 0), A = Bm * Lm, Sm = Bm * Lm * Lm / 6;
      const P1 = 0.6 * gravity.D_kN, arm = Lm / 2 - mat.anchors.edge;
      const T = Math.max(0, (M - P1 * Lm / 6) / (arm + Lm / 6)), nAnch = Math.ceil(T / mat.anchors.capacity), fit = Math.floor(Bm / 1.5) * 2;   // two rows at 1.5 m
      checks.push({ name: `mat, wind ${dir}: rock anchors to keep 0.6D + 0.6W in the middle third: ${nAnch} × ${mat.anchors.capacity} kN (${fit} fit in two rows at 1.5 m)`, clause: 'ASCE 7-16 2.4 combination 7; rigid mat; anchor capacity assumed', demand: nAnch, capacity: fit, util: fit ? nAnch / fit : Infinity });
      const P2 = gravity.D_kN + T, e2 = (M - T * arm) / P2, q2 = P2 / A + P2 * Math.max(e2, 0) / Sm;
      checks.push({ name: `mat, wind ${dir}: edge pressure under D + 0.6W (with anchor load) vs rock allowable (kPa)`, clause: 'ASCE 7-16 2.4 combination 5; rock qa assumed', demand: q2, capacity: mat.qa, util: q2 / mat.qa });
      res[dir].mat = { M, T, anchors: nAnch, q2 };
    }
    const governing = checks.filter(c => !c.indicative).reduce((g, c) => (c.util > (g?.util ?? -1) ? c : g), null);
    const indicative = checks.filter(c => c.indicative);
    return { checks, governing, indicative, res, modes: classifyModes(frame, modes) };
  },
});

/** Equivalent added damping of a tuned mass damper of mass ratio μ (Den Hartog optimum, half the damper's own ratio; approximation, unverified). */
export const tmdDamping = mu => mu > 0 ? 0.5 * Math.sqrt(3 * mu / (8 * (1 + mu) ** 3)) : 0;

/**
 * The whole wind and vibration analysis of a tower model. `run(engineModel)` returns the engine's output
 * (the service's /analyse, or the binary in a tool). Two engine runs: modes with the gravity cases, then
 * the wind cases at the ultimate and the 10-year speeds with the gust factors those modes give.
 */
export async function analyseTower(model, run, { gravityInputs, towerGravity }) {
  const ws = model.byType('wind')[0]; if (!ws) throw new Error('no wind site in the model');
  const site = Object.fromEntries(['V', 'V10', 'exposure', 'beta_service', 'beta_ultimate'].map(k => [k, ws.params[k]?.value]));
  const storeys = towerStoreys(model), frame = towerFrame.run({ storeys });
  const r1 = await run(frame.engine);
  const modes = r1.modes || []; if (modes.length < 2) throw new Error('the engine returned fewer than two modes');
  const mx = modeIn(frame, modes, 'x'), my = modeIn(frame, modes, 'y'); if (!mx || !my) throw new Error('no translational mode found in x or in y');
  const damper = model.byType('damper').reduce((s, d) => s + (d.params.mass?.value ?? 0), 0) * 1000;   // kg
  const added = { x: tmdDamping(damper / mx.m1_kg), y: tmdDamping(damper / my.m1_kg) };
  const beta = d => ({ service: site.beta_service + added[d], ultimate: site.beta_ultimate + added[d] });
  const H = frame.height, dims = d => ({ B: d === 'x' ? storeys[0].depth_y : storeys[0].width_x, L: d === 'x' ? storeys[0].width_x : storeys[0].depth_y });
  const gf = (V, b) => Object.fromEntries(['x', 'y'].map(d => [d, gustFlexible.run({ h: H, ...dims(d), n1: (d === 'x' ? mx : my).n, beta: beta(d)[b], V, exp: site.exposure }).Gf]));
  const gfU = gf(site.V, 'ultimate'), gfS = gf(site.V10, 'service');
  const ult = towerWindCases(frame, storeys, { V: site.V, exp: site.exposure, gf: gfU }), srv = towerWindCases(frame, storeys, { V: site.V10, exp: site.exposure, gf: gfS });
  const { mass_t, modes_wanted, ...base } = frame.engine; void mass_t; void modes_wanted;
  const ss = model.byType('seismic')[0], seis = ss ? Object.fromEntries(['Ss', 'S1', 'site_class', 'TL', 'Ie'].map(k => [k, ss.params[k]?.value])) : null;
  const elf = seis ? seismicELF.run({ site: seis, frame, Tx: 1 / mx.n, Ty: 1 / my.n }) : null, eqc = elf ? seismicCases(frame, storeys, elf) : [];
  const engine2 = { ...base, cases: [...base.cases, ...ult.map(c => ({ name: c.name, loads: c.loads })), ...srv.map(c => ({ name: 'S' + c.name, loads: c.loads })), ...eqc] };
  const r2 = await run(engine2);
  const ultimate = { cases: r2.cases.filter(c => !c.name.startsWith('S') && !c.name.startsWith('E')), aw: { x: ult.find(c => c.name === 'Wx').aw, y: ult.find(c => c.name === 'Wy').aw } };
  const service = { cases: r2.cases.filter(c => c.name.startsWith('SW')).map(c => ({ ...c, name: c.name.slice(1) })), aw: { x: srv.find(c => c.name === 'Wx').aw, y: srv.find(c => c.name === 'Wy').aw } };
  const gi = gravityInputs(model), gravity = towerGravity.run(gi);
  const siteDamped = { ...site, beta_service: Math.min(beta('x').service, beta('y').service) };
  const anchors = model.byType('wind')[0].params.anchor_capacity ? { capacity: model.byType('wind')[0].params.anchor_capacity.value, edge: model.byType('wind')[0].params.anchor_edge.value } : { capacity: 2500, edge: 1.5 };
  const checks = towerWindChecks.run({ frame, storeys, modes, service, ultimate, site: siteDamped, gravity, mat: { ...gi.mat, anchors } });
  const seismic = elf ? { elf, ...seismicChecks.run({ frame, storeys, elf, cases: r2.cases, gravity, mat: { ...gi.mat, anchors }, site: seis }) } : null;
  if (seismic) { checks.checks.push(...seismic.checks); checks.governing = checks.checks.filter(c => !c.indicative).reduce((g, c) => (c.util > (g?.util ?? -1) ? c : g), null); }
  const windBase = { x: ult.find(c => c.name === 'Wx').aw.base_shear, y: ult.find(c => c.name === 'Wy').aw.base_shear };
  const extras = towerOtherLoads.run({ storeys, frame, site, pg: ws.params.snow_pg?.value ?? 1.2, soil: soilInputs(model), mat: gi.mat, gravity, windAw: ultimate.aw, elf, cases: r2.cases });
  checks.checks.push(...extras.checks); checks.governing = checks.checks.filter(c => !c.indicative).reduce((g, c) => (c.util > (g?.util ?? -1) ? c : g), null);
  return { site, seis, seismic, windBase, extras, added, gf: { ultimate: gfU, service: gfS }, frame: { nodes: frame.engine.nodes.length, members: frame.engine.members.length, mass_t: frame.total_mass_t, height: H }, gravity, engine: [frame.engine, engine2], ...checks };
}

/**
 * tower.seismicELF: ASCE 7-16 12.8 equivalent lateral force for the tower frame: SDC, period (the engine's,
 * capped at Cu·Ta), Cs, base shear and its distribution to the floors by weight × height^k.
 */
export const seismicELF = register({
  name: 'tower.seismicELF', version: '1.0.0',
  assumptions: [SE.EDITION, 'effective seismic weight = dead + superimposed dead (+ damper) above grade; residential live load excluded (12.7.2)', 'base at grade: cellars and mat below are not part of the ELF height', 'floor weights from the frame\'s lumped masses'],
  inputs: null,
  run({ site, frame, Tx, Ty }) {
    const s = SE.SITE[site.site_class]; if (!s) throw new Error(`site class ${site.site_class}: only rock (A or B) is encoded`);
    const SMS = s.Fa * site.Ss, SM1 = s.Fv * site.S1, SDS = 2 / 3 * SMS, SD1 = 2 / 3 * SM1, cat = SE.sdc(SDS, SD1), sys = SE.SYSTEM;
    if (!sys.permitted.includes(cat)) throw new Error(`SDC ${cat}: ${sys.name} not permitted; a special system and its height limits are not encoded`);
    const hn = frame.height, ta = SE.Ta(hn), cap = SE.Cu(SD1) * ta;
    // floor weights: every node's mass to the nearest floor level
    const zs = frame.floors.map(f => f.z), wts = new Array(zs.length).fill(0);
    frame.engine.nodes.forEach((n, i) => { const m = frame.engine.mass_t[6 * i]; if (!m) return; let j = 0; for (let k = 1; k < zs.length; k++) if (Math.abs(zs[k] - n.p[2]) < Math.abs(zs[j] - n.p[2])) j = k; wts[j] += m * 9.81; });
    const W = wts.reduce((a, b) => a + b, 0);
    const dir = T0 => {
      const T = Math.min(T0, cap), c = SE.Cs({ SDS, SD1, T, TL: site.TL, R: sys.R, Ie: site.Ie }), V = c.Cs * W, k = SE.kExp(T);
      const sum = wts.reduce((a, w, i) => a + w * zs[i] ** k, 0), F = wts.map((w, i) => V * w * zs[i] ** k / sum);
      return { T0, T, Cs: c.Cs, governs: c.governs, V, k, F };
    };
    return { SMS, SM1, SDS, SD1, sdc: cat, system: sys, Ta: ta, CuTa: cap, W, wts, x: dir(Tx), y: dir(Ty), z: zs };
  },
});

/** Engine load vectors for E in x, E in y and E in x with accidental torsion (unfactored QE). */
export function seismicCases(frame, storeys, elf) {
  const N = frame.engine.nodes.length, out = [];
  for (const d of ['x', 'y']) {
    const loads = new Array(6 * N).fill(0), loadsT = new Array(6 * N).fill(0), B = d === 'x' ? storeys[0].depth_y : storeys[0].width_x;
    elf[d].F.forEach((F, i) => { const n = frame.floors[i].core; loads[6 * n + (d === 'x' ? 0 : 1)] += F; loadsT[6 * n + (d === 'x' ? 0 : 1)] += F; loadsT[6 * n + 5] += F * SE.ACCIDENTAL_ECC * B; });
    out.push({ name: `E${d}`, loads }, { name: `E${d}T`, loads: loadsT });
  }
  return out;
}

/** tower.seismicChecks: drift (Cd δe / Ie), stability coefficient, pier base stresses and mat overturning. */
export const seismicChecks = register({
  name: 'tower.seismicChecks', version: '1.0.0',
  assumptions: [SE.EDITION, 'drift from the strength-level ELF forces (conservative: 12.8.6.2 would allow the uncapped period)', 'ρ = 1 (SDC B)', 'P in the stability coefficient: unfactored D + L above the storey'],
  inputs: null,
  run({ frame, storeys, elf, cases, gravity, mat, site }) {
    const checks = [], caseOf = n => cases.find(c => c.name === n), Cd = elf.system.Cd, Ie = site.Ie, fl = frame.floors, res = {};
    for (const d of ['x', 'y']) {
      const c = caseOf(`E${d}T`), k = d === 'x' ? 0 : 1; let worst = 0, theta = 0;
      const live = fl.map(f => { const st = storeys.find(q => Math.abs(q.z0 - f.z) < 1e-6); return st ? st.live : 0; });
      for (let i = 1; i < fl.length; i++) {   // storey between floors i−1 and i
        const h = fl[i].z - fl[i - 1].z, de = Math.abs(c.d[6 * fl[i].core + k] - c.d[6 * fl[i - 1].core + k]), dlt = Cd * de / Ie;
        worst = Math.max(worst, dlt / h);
        const Vx = elf[d].F.slice(i).reduce((s, F) => s + F, 0), Px = elf.wts.slice(i).reduce((s, w) => s + w, 0) + live.slice(i).reduce((s, l) => s + l, 0);   // everything above the storey, unfactored D + L
        theta = Math.max(theta, Px * dlt * Ie / (Vx * h * Cd));
      }
      res[d] = { storey_drift: worst, theta };
      checks.push({ name: `seismic ${d}: worst storey drift Cd·δe/Ie over hsx (SDC ${elf.sdc}, T ${elf[d].T.toFixed(2)} s, Cs ${elf[d].Cs.toFixed(4)} by ${elf[d].governs})`, clause: 'ASCE 7-16 12.8.6, Table 12.12-1', demand: worst, capacity: SE.DRIFT_LIMIT, util: worst / SE.DRIFT_LIMIT });
      checks.push({ name: `seismic ${d}: stability coefficient θ (P-delta)`, clause: 'ASCE 7-16 12.8.7', demand: theta, capacity: SE.THETA_PDELTA, util: theta / SE.THETA_PDELTA });
    }
    // pier base stresses: (1.2 + 0.2 SDS) D + E + 0.5 L and (0.9 − 0.2 SDS) D + E
    let wc = 0, wt = 0;
    frame.engine.members.forEach((m, i) => {
      const sec = frame.sections[i]; if (!sec || frame.engine.nodes[m.a].p[2] > 1e-9) return;
      const N = n => caseOf(n).N[i], Mo = (n, k) => caseOf(n).F[12 * i + k];
      for (const e of ['Ex', 'ExT', 'Ey', 'EyT']) for (const [a, l] of [[1.2 + 0.2 * elf.SDS, 0.5], [0.9 - 0.2 * elf.SDS, 0]]) {
        const Nc = a * N('D') + l * N('L') + SE.RHO * N(e), My = a * Mo('D', 4) + l * Mo('L', 4) + Mo(e, 4), Mz = a * Mo('D', 5) + l * Mo('L', 5) + Mo(e, 5);
        const bend = Math.abs(My) / sec.Sy + Math.abs(Mz) / sec.Sx; wc = Math.max(wc, (-Nc / sec.A + bend) / 1000); wt = Math.max(wt, (Nc / sec.A + bend) / 1000);
      }
    });
    const fcBase = Math.min(...Object.values(storeys[0].piers).flat().map(w => w.fc));
    checks.push({ name: 'seismic: pier base peak compressive stress, (1.2 + 0.2 SDS)D + E + 0.5L / (0.9 − 0.2 SDS)D + E (MPa)', clause: 'ASCE 7-16 2.3.6; screening vs φ 0.85 f′c', demand: wc, capacity: 0.65 * 0.85 * fcBase, util: wc / (0.65 * 0.85 * fcBase) });
    checks.push({ name: 'seismic: pier base vertical steel for the peak tensile stress (ratio)', clause: 'screening vs 2 %', demand: Math.max(0, wt) / (0.9 * 420), capacity: 0.02, util: Math.max(0, wt) / (0.9 * 420) / 0.02 });
    // mat: (0.6 − 0.14 SDS) D + 0.7 E (ASD combination 8), with the same rock-anchor rule as wind
    for (const d of ['x', 'y']) {
      const Lm = d === 'x' ? mat.lx : mat.ly, Bm = d === 'x' ? mat.ly : mat.lx, M = 0.7 * elf[d].F.reduce((s, F, i) => s + F * (elf.z[i] - mat.zBottom), 0);
      const P1 = (0.6 - 0.14 * elf.SDS) * gravity.D_kN, arm = Lm / 2 - mat.anchors.edge, T = Math.max(0, (M - P1 * Lm / 6) / (arm + Lm / 6)), n = Math.ceil(T / mat.anchors.capacity), fit = Math.floor(Bm / 1.5) * 2;
      checks.push({ name: `seismic, mat ${d}: rock anchors to keep (0.6 − 0.14 SDS)D + 0.7E in the middle third: ${n} × ${mat.anchors.capacity} kN`, clause: 'ASCE 7-16 2.4.5 combination 8', demand: n, capacity: fit, util: fit ? n / fit : Infinity });
      res[d].mat = { M, T, anchors: n };
    }
    return { checks, res };
  },
});

/**
 * tower.otherLoads: the remaining ASCE 7-16 chapters for the tower: snow on the roof and the setback terraces
 * (Ch. 7), hydrostatic uplift on the mat (Ch. 3), cladding pressures (Ch. 30), the 1.4.3 notional lateral load
 * against wind (Ch. 1), and gravity strength combinations with snow at the pier bases (Ch. 2).
 */
export const towerOtherLoads = register({
  name: 'tower.otherLoads', version: '1.0.0',
  assumptions: [OT.EDITION, 'terraces: the strip a setback leaves, with a leeward drift from the plate above; drift averaged over the terrace depth', 'snow distributed to the piers like live load for the gravity combinations', 'the roof over a setback strip is not modelled as a slab (owed)'],
  inputs: null,
  run({ storeys, frame, site, pg, soil, mat, gravity, windAw, elf, cases }) {
    // snow
    const sn = OT.snow({ pg }), roof = storeys.at(-1);
    let S = sn.pf * roof.slabArea, worstDrift = sn.drift({ luUpper: 1, luLower: 1, hc: 1 });
    for (let i = 0; i < storeys.length - 1; i++) {
      const a = storeys[i], b = storeys[i + 1], strip = Math.max(0, a.slabArea - b.slabArea); if (strip < 1e-6) continue;
      const depth = Math.max(0, a.depth_y - b.depth_y), dr = sn.drift({ luUpper: b.depth_y, luLower: depth, hc: b.h - sn.pf / sn.gamma });
      const avg = depth >= dr.w ? dr.pd * dr.w / 2 / depth : dr.pd * (1 - depth / (2 * dr.w));
      S += strip * (sn.pf + avg); if (dr.hd > worstDrift.hd) worstDrift = dr;
    }
    // hydrostatic uplift
    const head = soil ? Math.max(0, (soil.surface - mat.zBottom) - soil.water_depth) : 0, H = OT.GAMMA_W * head * mat.area;
    // cladding
    const cladding = OT.claddingPressures({ h: frame.height, V: site.V, exp: site.exposure });
    // integrity: storey shear of 0.01 × weight above against the ultimate wind storey shear, both directions
    let ratio = 0;
    if (elf) for (const d of ['x', 'y']) { const F = windAw[d].forces; for (let i = 1; i < elf.wts.length; i++) { const vn = OT.INTEGRITY_FRACTION * elf.wts.slice(i).reduce((s, w) => s + w, 0), vw = F.slice(i - 1).reduce((s, f) => s + f.F, 0); if (vw > 0) ratio = Math.max(ratio, vn / vw); } }
    // gravity combinations at the pier bases, snow as live-distributed
    const caseOf = n => cases.find(c => c.name === n), sOverL = gravity.L_kN > 0 ? S / gravity.L_kN : 0;
    let wc = 0;
    frame.engine.members.forEach((m, i) => {
      const sec = frame.sections[i]; if (!sec || frame.engine.nodes[m.a].p[2] > 1e-9) return;
      const N = n => caseOf(n).N[i], Mo = (n, k) => caseOf(n).F[12 * i + k];
      for (const [d, l, s] of [[1.4, 0, 0], [1.2, 1.6, 0.5], [1.2, 1.0, 1.6]]) {
        const Nc = d * N('D') + (l + s * sOverL) * N('L'), My = d * Mo('D', 4) + (l + s * sOverL) * Mo('L', 4), Mz = d * Mo('D', 5) + (l + s * sOverL) * Mo('L', 5);
        wc = Math.max(wc, (-Nc / sec.A + Math.abs(My) / sec.Sy + Math.abs(Mz) / sec.Sx) / 1000);
      }
    });
    const fcBase = Math.min(...Object.values(storeys[0].piers).flat().map(w => w.fc));
    const checks = [
      { name: 'gravity: pier base peak compressive stress, 1.4D / 1.2D + 1.6L + 0.5S / 1.2D + 1.6S + L (MPa)', clause: 'ASCE 7-16 2.3.1; screening vs φ 0.85 f′c', demand: wc, capacity: 0.65 * 0.85 * fcBase, util: wc / (0.65 * 0.85 * fcBase) },
      { name: `mat: hydrostatic uplift, ${head.toFixed(1)} m head, against 0.6D`, clause: 'ASCE 7-16 3.2.2, 2.4.1 (0.6D + H)', demand: H, capacity: 0.6 * gravity.D_kN, util: H / (0.6 * gravity.D_kN) },
      { name: 'structural integrity: 0.01 W notional storey shear enveloped by the ultimate wind storey shear', clause: 'ASCE 7-16 1.4.3', demand: ratio, capacity: 1, util: ratio },
    ];
    return { snow: { pg, pf: sn.pf, pf0: sn.pf0, pm: sn.pm, drift: worstDrift, S_kN: S }, buoyancy: { head, H, D: gravity.D_kN, util: H / (0.6 * gravity.D_kN) }, cladding, integrity: { ratio }, checks };
  },
});
