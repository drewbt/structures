// foundations.js - pile caps and bored piles to ACI 318-19 chapter 13, and the load takedown that feeds them.
//
// The load path is one pure function (structure.loadTakedown): slab column reactions (flatSlabDesign),
// beam support reactions (the engine via beamResults), column self-weight and any loads stated on a column
// arrive at each column; each column with its cap's self-weight arrives at the cap; a rigid cap shares it
// among its piles by statics. Global equilibrium (Σ pile reactions = Σ everything applied) is a gate.
//
// Geotechnical capacity is NOT computed: the allowable pile load is an input with provenance "assumed"
// until a site investigation gives it (ASSUMPTIONS A-21).
import { register } from './functions.js';
import * as ACI from './standards/aci318-19.js';
import { criticalPerimeter, sectionProps } from './slabs.js';
import { helix, hookedBar, roundPath, spread } from './detail.js';

const num = (el, name, dflt) => { const p = el.params[name]; return p === undefined ? dflt : p.value; };

/** Standard pile layouts (unit spacing s), centred on the column. */
export function pileLayout(n, s) {
  const h = s / 2, t = s * Math.sqrt(3) / 2, q = s / Math.SQRT2;
  const L = { 1: [[0, 0]], 2: [[-h, 0], [h, 0]], 3: [[-h, -t / 3], [h, -t / 3], [0, 2 * t / 3]], 4: [[-h, -h], [h, -h], [h, h], [-h, h]], 5: [[-q, -q], [q, -q], [q, q], [-q, q], [0, 0]],   /* quincunx: corners at s/√2 so the centre pile is s from each */ 6: [[-s, -h], [0, -h], [s, -h], [-s, h], [0, h], [s, h]] };
  if (L[n]) return L[n];
  if (n === 7) return [[0, 0], ...Array.from({ length: 6 }, (_, k) => [s * Math.cos(k * Math.PI / 3), s * Math.sin(k * Math.PI / 3)])];   // hexagon round a centre pile
  const out = []; for (const y of [-s, 0, s]) for (const x of [-s, 0, s]) out.push([x, y]); return out;   // 8 and 9: the full 3 × 3 grid, so the group stays centred
}

/**
 * structure.loadTakedown: per column, per cap and per pile, D and L service loads and factored loads
 * (max of 1.4D and 1.2D + 1.6L, 5.3.1), with the slab's unbalanced moments carried to the column and its cap.
 */
export const loadTakedown = register({
  name: 'structure.loadTakedown', version: '1.0.0',
  assumptions: ['tributary-area slab reactions (flatSlabDesign)', 'beam reactions applied to the column whose footprint contains the support point when the beam is above the column base, otherwise to the cap whose footprint contains it', 'unbalanced slab moments carried unreduced from column top to cap (conservative for a fixed-base column)', 'one storey of columns between the slab and the caps'],
  inputs: null,
  run({ columns, slabReactions = [], beamReactions = [], caps = [] }) {
    const inside = (pt, cx, cy, wx, wy) => Math.abs(pt[0] - cx) <= wx / 2 + 1e-6 && Math.abs(pt[1] - cy) <= wy / 2 + 1e-6;
    const applied = { slab: 0, columns: 0, beams: 0, caps: 0, stated: 0 };
    const col = columns.map(c => {
      const sr = slabReactions.filter(r => r.column === c.id), self = c.unit_weight * c.b * c.h * c.height;
      const onColumn = r => inside(r.at, c.center[0], c.center[1], c.b, c.h) && (r.z === undefined || c.z0 === undefined || r.z > c.z0 + 1e-6);   // a beam below the column's base bears on the cap, not the column
      const beams = beamReactions.filter(onColumn);
      const D = sr.reduce((a, r) => a + r.D_kN, 0) + self + beams.reduce((a, r) => a + r.D, 0) + c.P_D, L = sr.reduce((a, r) => a + r.L_kN, 0) + beams.reduce((a, r) => a + r.L, 0) + c.P_L;
      applied.slab += sr.reduce((a, r) => a + r.D_kN + r.L_kN, 0); applied.columns += self; applied.beams += beams.reduce((a, r) => a + r.D + r.L, 0); applied.stated += c.P_D + c.P_L;
      const Mx = sr.reduce((a, r) => a + r.Mx_kNm, 0), My = sr.reduce((a, r) => a + r.My_kNm, 0);
      return { column: c.id, name: c.name, D, L, Pu: Math.max(1.4 * D, 1.2 * D + 1.6 * L), Mux: Mx, Muy: My, beams: beams.map(b => b.beam), slab: sr.length > 0 };
    });
    const capLoads = caps.map(cp => {
      const cl = col.find(q => q.column === cp.column), beams = beamReactions.filter(r => !columns.some(c => inside(r.at, c.center[0], c.center[1], c.b, c.h) && (r.z === undefined || c.z0 === undefined || r.z > c.z0 + 1e-6)) && inside(r.at, cp.center[0], cp.center[1], cp.size[0], cp.size[1]));
      const self = cp.unit_weight * cp.size[0] * cp.size[1] * cp.H;
      applied.caps += self; applied.beams += beams.reduce((a, r) => a + r.D + r.L, 0);
      const D = (cl?.D ?? 0) + self + beams.reduce((a, r) => a + r.D, 0), L = (cl?.L ?? 0) + beams.reduce((a, r) => a + r.L, 0);
      return { cap: cp.id, column: cp.column, D, L, Pu: Math.max(1.4 * D, 1.2 * D + 1.6 * L), Mux: cl?.Mux ?? 0, Muy: cl?.Muy ?? 0, self };
    });
    return { columns: col, caps: capLoads, applied, total: Object.values(applied).reduce((a, v) => a + v, 0) };
  },
});

/** Inputs of a cap element. Piles are its children. */
export function capInputs(model, cap) {
  const piles = model.all().filter(e => e.type === 'pile' && e.parent === cap.id).map(p => ({ id: p.id, at: num(p, 'center'), D: num(p, 'diameter', 0.45), length: num(p, 'length', 12), fc: num(p, 'fc', 28), fy: num(p, 'fy', 420) }));
  return { id: cap.id, name: cap.name, column: num(cap, 'column', null), center: num(cap, 'center'), size: num(cap, 'size'), H: num(cap, 'thickness', 0.9), zTop: num(cap, 'top', 0),
    fc: num(cap, 'fc', 28), fy: num(cap, 'fy', 420), cover: num(cap, 'cover', 0.075), embed: num(cap, 'pile_embed', 0.075), bar: num(cap, 'bar', '#7'), unit_weight: num(cap, 'unit_weight', 23.6),
    pile_D: num(cap, 'pile_diameter', 0.45), pile_length: num(cap, 'pile_length', 12), Qallow: num(cap, 'pile_allowable_kN', 900), spacing: num(cap, 'pile_spacing', 3 * num(cap, 'pile_diameter', 0.45)), edge: num(cap, 'pile_edge', 0.15), piles };
}

/**
 * structure.pileCapLayout: the number of piles from the service load and the assumed allowable pile load,
 * the standard layout at the stated spacing, and the cap plan size with the stated edge distance.
 */
export const pileCapLayout = register({
  name: 'structure.pileCapLayout', version: '1.0.0',
  assumptions: ['allowable pile load is an input (geotechnical, assumed until a site investigation gives it)', 'service load includes the cap self-weight at a first-guess thickness; moments raise the count by checking the corner pile', 'layouts 1–6 as drawn, 7 as a hexagon round a centre pile, 8 and 9 as a 3 × 3 grid (8 rounds up to 9 so the group stays centred)'],
  inputs: null,
  run({ cap, D, L, Mx = 0, My = 0 }) {
    for (let n = 1; n <= 9; n++) {
      const lay = pileLayout(n, cap.spacing), xs = lay.map(q => q[0]), ys = lay.map(q => q[1]);
      const sx = Math.max(...xs) - Math.min(...xs) + cap.pile_D + 2 * cap.edge, sy = Math.max(...ys) - Math.min(...ys) + cap.pile_D + 2 * cap.edge;
      const self = cap.unit_weight * sx * sy * cap.H, P = D + L + self, Sx = xs.reduce((a, x) => a + x * x, 0), Sy = ys.reduce((a, y) => a + y * y, 0);
      const max = Math.max(...lay.map(([x, y]) => P / n + (Sx > 0 ? Mx * Math.abs(x) / Sx : 0) + (Sy > 0 ? My * Math.abs(y) / Sy : 0)));
      if (max <= cap.Qallow || n === 9) return { n: lay.length, layout: lay, size: [sx, sy], Pservice: P, maxService: max };
    }
  },
});

/**
 * structure.pileCapDesign: rigid-cap pile reactions; cap flexure at the column faces (13.2.7.1), one-way shear
 * at d from the faces (13.2.7.2) and two-way shear at the column and around the most loaded pile, each with
 * the pile-in-section rule of 13.4.2.5; minimum depth (13.3.1.2) and steel (0.0018 Ag); dowel development
 * (25.4.9.2); pile service load against the assumed allowable and pile structural strength (13.4.2.1).
 */
export const pileCapDesign = register({
  name: 'structure.pileCapDesign', version: '1.0.0',
  assumptions: ['ACI 318-19 as encoded (unverified)', 'rigid cap: Pi = P/n ± Mx xi/Σx² ± My yi/Σy²', 'cap self-weight in the pile reactions; not deducted from the flexural moment (conservative)', 'sectional design; a cap with a pile within d of the column face is deep, and for 2- and 4-pile layouts it is designed by strut-and-tie (Ch. 23) with the sectional shear rows kept for information', 'column square to the cap axes'],
  inputs: null,
  run({ cap, col, load }) {
    const n = cap.piles.length; if (!n) throw new Error('cap has no piles');
    const fc = cap.fc, fy = cap.fy, bar = ACI.BARS[cap.bar], H = cap.H * 1000, d = H - cap.cover * 1000 - cap.embed * 1000 - bar.db;   // two layers: average d
    const rel = cap.piles.map(p => [p.at[0] - cap.center[0], p.at[1] - cap.center[1]]);
    const Sx = rel.reduce((a, q) => a + q[0] ** 2, 0), Sy = rel.reduce((a, q) => a + q[1] ** 2, 0);
    const share = (P, M1, M2) => rel.map(([x, y]) => P / n + (Sx > 0 ? M1 * x / Sx : 0) + (Sy > 0 ? M2 * y / Sy : 0));
    const Pu = share(load.Pu, load.Mux, load.Muy), Ps = share(load.D + load.L, load.Mux / 1.4, load.Muy / 1.4);   // service moments ≈ factored / 1.4 (conservative mean factor)
    const checks = [], cx = col.b * 1000 / 2, cy = col.h * 1000 / 2, Dp = cap.pile_D * 1000;
    // flexure and one-way shear each direction
    const faces = {};
    for (const [axis, k, half, width] of [['x', 0, cx, cap.size[1] * 1000], ['y', 1, cy, cap.size[0] * 1000]]) {
      for (let i = 0; i < n; i++) {
        const t = Math.abs(rel[i][k]) * 1000;   // pile centre distance from the column centre along this axis
        const sM = ACI.pileShareOutside(t - half, Dp), sV = ACI.pileShareOutside(t - half - d, Dp);
        faces[axis] = faces[axis] || { Mpos: 0, Mneg: 0, Vpos: 0, Vneg: 0 };
        const side = rel[i][k] >= 0 ? 'pos' : 'neg';
        faces[axis]['M' + side] += sM * Pu[i] * 1000 * Math.max(0, t - half);   // N·mm
        faces[axis]['V' + side] += sV * Pu[i] * 1000;
      }
      const f = faces[axis], M = Math.max(f.Mpos, f.Mneg), V = Math.max(f.Vpos, f.Vneg), b = width;
      const k_ = fy / (2 * 0.85 * fc * b), disc = (fy * d) ** 2 - 4 * fy * k_ * M / 0.9, need = disc < 0 ? null : (fy * d - Math.sqrt(disc)) / (2 * fy * k_);
      const As = Math.max(need ?? Infinity, ACI.FOOTING_AS_MIN_RATIO * b * H), nb = Math.max(4, Math.ceil(As / bar.area)), Asp = nb * bar.area;
      const a = Asp * fy / (0.85 * fc * b), phiMn = 0.9 * Asp * fy * (d - a / 2), phiVc = ACI.PHI_SHEAR * ACI.Vc(fc, b, d) * ACI.lambdaS(d);
      Object.assign(f, { Mu_kNm: M / 1e6, Vu_kN: V / 1000, As_req: need, As_min: ACI.FOOTING_AS_MIN_RATIO * b * H, n: nb, As: Asp, phiMn_kNm: phiMn / 1e6, phiVc_kN: phiVc / 1000, spacing: (b - 2 * cap.cover * 1000) / (nb - 1) });
      checks.push({ name: `cap flexure about the ${axis === 'x' ? 'y' : 'x'} face (${nb} ${bar.id}, bars along ${axis})`, clause: `${ACI.CAP_SECTIONS.moment}, 22.2`, demand: M / 1e6, capacity: phiMn / 1e6, util: M / phiMn });
      checks.push({ name: `cap minimum steel, bars along ${axis}`, clause: '13.3.2.1, 7.6.1.1', demand: ACI.FOOTING_AS_MIN_RATIO * b * H, capacity: Asp, util: ACI.FOOTING_AS_MIN_RATIO * b * H / Asp });
      checks.push({ name: `cap one-way shear at d from the face, ${axis}`, clause: `${ACI.CAP_SECTIONS.shear}, ${ACI.CAP_SECTIONS.pileInSection}, 22.5.5.1`, demand: V / 1000, capacity: phiVc / 1000, util: V / phiVc });
      const nearest = Math.min(...rel.map(q => Math.abs(q[k]) * 1000 - half)); if (n > 1 && nearest < d) checks.push({ name: `deep cap along ${axis}: a pile within d of the column face (strut-and-tie owed)`, clause: '13.2.6.3, Ch. 23', demand: d, capacity: nearest, util: 1.0 });
    }
    // two-way at the column
    const capRect = { x0: cap.center[0] - cap.size[0] / 2, x1: cap.center[0] + cap.size[0] / 2, y0: cap.center[1] - cap.size[1] / 2, y1: cap.center[1] + cap.size[1] / 2 };
    const segC = criticalPerimeter({ x: cap.center[0], y: cap.center[1], ax: col.b / 2, ay: col.h / 2, e: d / 2000 }, capRect), PC = sectionProps(segC, d / 1000);
    let VuC = 0; rel.forEach(([x, y], i) => { const out = Math.max(Math.abs(x) * 1000 - cx - d / 2, Math.abs(y) * 1000 - cy - d / 2); VuC += ACI.pileShareOutside(out, Dp) * Pu[i] * 1000; });
    if (!segC.length || VuC <= 0) checks.push({ name: 'cap two-way shear at the column: no pile reaction outside the critical section', clause: `22.6.4.1, ${ACI.CAP_SECTIONS.pileInSection}`, demand: 0, capacity: null, util: 0 });
    else {
      const vcC = ACI.vcTwoWay(fc, Math.max(col.b, col.h) / Math.min(col.b, col.h), 40, d, PC.bo * 1000), vuC = VuC / (PC.bo * 1000 * d);
      checks.push({ name: 'cap two-way shear at the column', clause: `22.6.1.2, 22.6.5.2, ${ACI.CAP_SECTIONS.pileInSection}`, demand: vuC, capacity: ACI.PHI_SHEAR * vcC, util: vuC / (ACI.PHI_SHEAR * vcC) });
    }
    // two-way around the most loaded pile (perimeter at d/2 from the pile, truncated by the cap edges)
    // a circular pile is taken as the square of equal area, side D√π/2 (22.6.4.1 / R22.6.4.1 practice for circular sections)
    const iMax = Pu.reduce((m, v, i) => (v > Pu[m] ? i : m), 0), pr = cap.piles[iMax];
    const eqHalf = Dp / 1000 * Math.sqrt(Math.PI) / 4, segP = criticalPerimeter({ x: pr.at[0], y: pr.at[1], ax: eqHalf, ay: eqHalf, e: d / 2000 }, capRect), PP = sectionProps(segP, d / 1000);
    if (!segP.length) checks.push({ name: `cap two-way shear around pile ${iMax + 1}: not applicable, the critical section lies wholly outside the cap (the pile bears the column directly)`, clause: '22.6.4.1', demand: null, capacity: null, util: 0 });
    else {
      const sides = segP.filter(([a, b]) => Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9).length, αs = sides >= 4 ? 40 : sides === 3 ? 30 : 20;
      const vcP = ACI.vcTwoWay(fc, 1, αs, d, PP.bo * 1000), vuP = Pu[iMax] * 1000 / (PP.bo * 1000 * d);
      checks.push({ name: `cap two-way shear around pile ${iMax + 1} (${sides} sides)`, clause: '22.6.1.2, 22.6.5.2', demand: vuP, capacity: ACI.PHI_SHEAR * vcP, util: vuP / (ACI.PHI_SHEAR * vcP) });
    }
    // strut-and-tie for deep 2- and 4-pile caps (Ch. 23): column node at the top, a strut to each pile node at the tie level
    const deep = checks.some(c => c.name.startsWith('deep cap'));
    let stm = null;
    if (deep && (n === 2 || n === 4)) {
      stm = strutAndTie({ cap, col, Pu, rel, bar, d, H, checks });
      for (const c of checks) if (/one-way shear|two-way shear around pile|^deep cap/.test(c.name)) { c.superseded = 'deep cap: designed by strut-and-tie (Ch. 23); sectional row for information'; }
      for (const axis of ['x', 'y']) { const need = stm.tieAs[axis]; if (need > 0) { const f = faces[axis], nb = Math.max(f.n, Math.ceil(need / bar.area)); f.n = nb; f.As = nb * bar.area; f.tie_As = need; } }
    }
    checks.push({ name: 'cap depth above the bottom steel', clause: '13.3.1.2', demand: ACI.CAP_MIN_DEPTH_ABOVE_STEEL, capacity: H - cap.cover * 1000 - cap.embed * 1000 - 2 * bar.db, util: ACI.CAP_MIN_DEPTH_ABOVE_STEEL / (H - cap.cover * 1000 - cap.embed * 1000 - 2 * bar.db) });
    if (col.dowel_db) { const ldc = ACI.ldc(col.dowel_db, col.fy, fc), avail = H - cap.cover * 1000 - cap.embed * 1000 - 2 * bar.db; checks.push({ name: 'column dowel development into the cap', clause: '25.4.9.2', demand: ldc, capacity: avail, util: ldc / avail }); }
    // piles
    const piles = cap.piles.map((p, i) => {
      const Ag = Math.PI * (p.D * 1000) ** 2 / 4, phiPn = ACI.PILE_AXIAL.phi * ACI.PILE_AXIAL.coeff * p.fc * Ag / 1000;
      checks.push({ name: `pile ${i + 1} service load vs allowable (assumed geotechnical)`, clause: 'geotechnical input', demand: Ps[i], capacity: cap.Qallow, util: Ps[i] / cap.Qallow });
      checks.push({ name: `pile ${i + 1} structural axial strength`, clause: ACI.PILE_AXIAL.clause, demand: Pu[i], capacity: phiPn, util: Pu[i] / phiPn });
      if (Pu[i] < 0) checks.push({ name: `pile ${i + 1} in tension (uplift): tension design owed`, clause: '13.4', demand: -Pu[i], capacity: 0, util: Infinity });
      return { id: p.id, Pu_kN: Pu[i], Pservice_kN: Ps[i], phiPn_kN: phiPn };
    });
    const governing = checks.filter(k => !k.superseded).reduce((g, k) => (k.util > (g?.util ?? -1) ? k : g), null);
    return { ruleset: ACI.RULESET, d, faces, piles, stm, reactions: { Pu, Ps }, sumPu: Pu.reduce((a, v) => a + v, 0), checks, governing, bar: bar.id, zones: { column: segC, pile: segP } };
  },
});

/**
 * structure.pileCapBars: bottom mats both ways (x outer) with 90° hooks turned up at the cap edges, sitting on
 * the pile heads, plus each pile's cage (longitudinal bars over the top third, at least 3 m, projecting into the
 * cap) and its spiral.
 */
export const pileCapBars = register({
  name: 'structure.pileCapBars', version: '1.0.0',
  assumptions: ['pile cage: 6 bars #6 at ρ ≥ 0.5 %, over max(L/3, 3 m), projecting into the cap to 100 mm below its top less cover: firm practice, not an ACI 318-19 requirement outside seismic design (18.13)', 'spiral #3 at 150 mm pitch, 75 mm cover: assumed', 'no top mat (no uplift) unless a check row reports tension'],
  inputs: null,
  run({ cap, design }) {
    const bar = ACI.BARS[cap.bar], db = bar.db / 1000, cv = cap.cover, zb = cap.zTop - cap.H, zx = zb + cap.embed + db / 2, zy = zx + db, bars = [];
    const x0 = cap.center[0] - cap.size[0] / 2 + cv, x1 = cap.center[0] + cap.size[0] / 2 - cv, y0 = cap.center[1] - cap.size[1] / 2 + cv, y1 = cap.center[1] + cap.size[1] / 2 - cv, up = [0, 0, 1];
    spread(y0 + db, y1 - db, design.faces.x.n).forEach((y, i) => bars.push({ name: `${cap.name}-BX${i + 1}`, shape: 'hooked', designation: bar.id, diameter: db, mark: 'BX', face: 'bottom', path: roundPath(hookedBar([x0, y, zx], [x1, y, zx], db, { hookStart: up, hookEnd: up })), cover: cv }));
    spread(x0 + db, x1 - db, design.faces.y.n).forEach((x, i) => bars.push({ name: `${cap.name}-BY${i + 1}`, shape: 'hooked', designation: bar.id, diameter: db, mark: 'BY', face: 'bottom', path: roundPath(hookedBar([x, y0, zy], [x, y1, zy], db, { hookStart: up, hookEnd: up })), cover: cv }));
    for (const [i, p] of cap.piles.entries()) {
      const lb = ACI.BARS['#6'], sp = ACI.BARS['#3'], Ag = Math.PI * (p.D * 1000) ** 2 / 4, nl = Math.max(6, Math.ceil(0.005 * Ag / lb.area)), pc = 0.075;
      const rC = p.D / 2 - pc - sp.db / 1000 - lb.db / 2000, zHead = zb + cap.embed, zTopBar = cap.zTop - cv - 0.1, cage = Math.max(p.length / 3, 3);
      for (let k = 0; k < nl; k++) { const a = 2 * Math.PI * k / nl; bars.push({ name: `${cap.name}-P${i + 1}-L${k + 1}`, shape: 'straight', designation: lb.id, diameter: lb.db / 1000, mark: 'PL', path: roundPath([[p.at[0] + rC * Math.cos(a), p.at[1] + rC * Math.sin(a), zHead - cage], [p.at[0] + rC * Math.cos(a), p.at[1] + rC * Math.sin(a), zTopBar]]), cover: pc, pile: p.id }); }
      bars.push({ name: `${cap.name}-P${i + 1}-SP`, shape: 'spiral', designation: sp.id, diameter: sp.db / 1000, mark: 'PS', path: roundPath(helix(p.at[0], p.at[1], p.D / 2 - pc - sp.db / 2000, zHead - cage, zHead, 0.15)), cover: pc, pitch: 0.15, pile: p.id });
    }
    return { bars, count: bars.length };
  },
});

/**
 * Strut-and-tie model of a deep 2- or 4-pile cap (ACI 318-19 Ch. 23). Top node: a CCC node under the column,
 * depth assumed 0.15 H, each strut starting at the column quarter point towards its pile. Bottom nodes: CCT
 * nodes over the piles at the tie centroid (one bar diameter above the pile head). Strut i carries Pi / sin θi;
 * its horizontal component is resisted by ties along x and y between the piles. Checks: strut at its narrower
 * end, top and pile nodes in bearing, tie steel, strut angle ≥ 25°. Struts treated as βs = 0.4 (no 23.5 steel).
 */
function strutAndTie({ cap, col, Pu, rel, bar, d, H, checks }) {
  const fc = cap.fc, fy = cap.fy, phi = ACI.PHI_STM, wTop = 0.15 * H, zTop = H - wTop / 2, zTie = cap.embed * 1000 + bar.db, lever = zTop - zTie;   // mm, from the cap soffit
  const lb = cap.pile_D * 1000 * Math.sqrt(Math.PI) / 2, wt = 2 * (zTie - cap.embed * 1000);   // pile bearing as the equal-area square; tie zone height
  const tieAs = { x: 0, y: 0 }, struts = [];
  rel.forEach(([x, y], i) => {
    const r = Math.hypot(x, y) * 1000, start = Math.min(col.b, col.h) * 1000 / 4, horiz = Math.max(r - start, 1);   // from the column quarter point
    const θ = Math.atan2(lever, horiz), F = Pu[i] * 1000 / Math.sin(θ), Hf = Pu[i] * 1000 / Math.tan(θ);
    const wBot = lb * Math.sin(θ) + wt * Math.cos(θ), wTopS = (Math.min(col.b, col.h) * 1000 / 2) * Math.sin(θ) + wTop * Math.cos(θ), w = Math.min(wBot, wTopS);
    const Fns = ACI.fce(fc, ACI.BETA_S_DEFAULT) * w * lb;   // strut thickness taken as the pile's equal-area width
    checks.push({ name: `strut to pile ${i + 1} (θ ${(θ * 180 / Math.PI).toFixed(1)}°, w ${w.toFixed(0)} mm)`, clause: '23.4.1, 23.4.3 (βs 0.4)', demand: F / 1000, capacity: phi * Fns / 1000, util: F / (phi * Fns) });
    checks.push({ name: `strut angle to tie, pile ${i + 1}`, clause: '23.2.7', demand: ACI.STM_MIN_ANGLE, capacity: θ * 180 / Math.PI, util: ACI.STM_MIN_ANGLE / (θ * 180 / Math.PI) });
    const pileNode = ACI.fce(fc, ACI.BETA_N.CCT) * lb * lb;
    checks.push({ name: `CCT node over pile ${i + 1}, bearing`, clause: '23.9.1, 23.9.2', demand: Pu[i], capacity: phi * pileNode / 1000, util: Pu[i] * 1000 / (phi * pileNode) });
    const ux = r > 0 ? Math.abs(x) * 1000 / r : 0, uy = r > 0 ? Math.abs(y) * 1000 / r : 0;
    tieAs.x = Math.max(tieAs.x, Hf * ux / (phi * fy)); tieAs.y = Math.max(tieAs.y, Hf * uy / (phi * fy));
    struts.push({ pile: i, theta_deg: θ * 180 / Math.PI, F_kN: F / 1000, H_kN: Hf / 1000, width_mm: w });
  });
  const Pcol = Pu.reduce((a, v) => a + v, 0) * 1000, topNode = ACI.fce(fc, ACI.BETA_N.CCC) * col.b * col.h * 1e6;
  checks.push({ name: 'CCC node under the column, bearing', clause: '23.9.1, 23.9.2', demand: Pcol / 1000, capacity: phi * topNode / 1000, util: Pcol / (phi * topNode) });
  for (const axis of ['x', 'y']) if (tieAs[axis] > 0) checks.push({ name: `tie along ${axis} (As ≥ T/φfy)`, clause: '23.7.1, 23.7.2', demand: tieAs[axis], capacity: null, util: 0, note: 'sets the bottom mat; anchored by the 90° hooks beyond the pile nodes (23.8.3)' });
  return { lever_mm: lever, struts, tieAs, method: 'ACI 318-19 Ch. 23' };
}
