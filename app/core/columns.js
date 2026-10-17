// columns.js - rectangular tied reinforced-concrete columns to ACI 318-19: the P–M interaction by strain
// compatibility about both axes, biaxial bending by the linear load contour (conservative), nonsway
// slenderness magnification, bar selection, ties and dowels. Units: N, mm inside; kN, kN·m, m at the edges.
import { register } from './functions.js';
import * as ACI from './standards/aci318-19.js';
import { closedLoop, hookedBar, roundPath, spread } from './detail.js';

const num = (el, name, dflt) => { const p = el.params[name]; return p === undefined ? dflt : p.value; };

export function columnInputs(model, el) {
  const l = model.get(el.parent); if (!l || l.type !== 'level') throw new Error(`${el.id}: parent is not a level`);
  const z0 = num(l, 'elevation', 0) + num(el, 'base_offset', 0);
  return { id: el.id, name: el.name, center: num(el, 'center'), b: num(el, 'width', 0.4), h: num(el, 'depth', 0.4), rotation: num(el, 'rotation', 0), z0, height: num(el, 'height', num(l, 'height', 3)),
    fc: num(el, 'fc', 28), fy: num(el, 'fy', 420), cover: num(el, 'cover', 0.04), bar_main: num(el, 'bar_main', '#8'), k: num(el, 'k', 1.0), slab_depth: num(el, 'slab_depth', 0),
    P_D: num(el, 'P_D', 0), P_L: num(el, 'P_L', 0), unit_weight: num(el, 'unit_weight', 23.6), continues_above: num(el, 'continues_above', false) };
}

/** Bar layout: n bars around the perimeter of a b × h section, nx on each b face (corners included), ny on each h face. Coordinates from the centroid, mm. */
export function perimeterBars(b, h, coverToBarCentre, nx, ny) {
  const x = b / 2 - coverToBarCentre, y = h / 2 - coverToBarCentre, out = [];
  for (const xi of spread(-x, x, nx)) { out.push([xi, -y]); out.push([xi, y]); }
  for (const yi of spread(-y, y, ny).slice(1, -1)) { out.push([-x, yi]); out.push([x, yi]); }
  return out;
}

/**
 * Nominal interaction about one axis: bars at coordinates t (mm from the centroid along the bending depth D,
 * positive towards the compression face), width B. Returns points {c, Pn, Mn, epsT, phi, phiPn, phiMn} from pure
 * compression to pure tension. Concrete displaced by compression bars inside the block is deducted.
 */
/** One point of the interaction: neutral axis depth c (mm from the compression face; Infinity = uniform 0.003). */
export function interactionPoint({ B, D, ts, Abar, fc, fy, c }) {
  const b1 = ACI.beta1(fc), Es = ACI.Es, a = Math.min(b1 * c, D), dt = D / 2 - Math.min(...ts);
  let Pn = 0.85 * fc * a * B, Mn = 0.85 * fc * a * B * (D / 2 - a / 2);
  for (const t of ts) {
    const depth = D / 2 - t, eps = c === Infinity ? 0.003 : 0.003 * (c - depth) / c, fs = Math.max(-fy, Math.min(fy, eps * Es));
    const displaced = depth < a ? 0.85 * fc : 0;
    Pn += Abar * (fs - displaced); Mn += Abar * (fs - displaced) * t;
  }
  const epsT = c === Infinity ? -0.003 : 0.003 * (dt - c) / c, { phi } = ACI.phiFlexure(epsT, fy);
  return { c, a, Pn, Mn, epsT, phi };
}
/**
 * Nominal interaction about one axis: bars at coordinates t (mm from the centroid along the bending depth D,
 * positive towards the compression face), width B. Returns points {c, Pn, Mn, epsT, phi, phiPn, phiMn} from pure
 * compression to pure tension. Concrete displaced by compression bars inside the block is deducted.
 */
export function interaction({ B, D, ts, Abar, fc, fy, points = 60 }) {
  const ey = fy / ACI.Es, Ag = B * D, Ast = ts.length * Abar, P0 = ACI.P0(fc, fy, Ag, Ast), PnMax = ACI.PN_MAX_TIED * P0, phiPnMax = ACI.PN_MAX_TIED * 0.65 * P0;
  const dt = D / 2 - Math.min(...ts), pts = [];
  const sweep = []; for (let i = 0; i <= points; i++) sweep.push(Math.exp(Math.log(4 * D) + (Math.log(0.02 * D) - Math.log(4 * D)) * i / points));
  for (const c of [Infinity, ...sweep]) { const q = interactionPoint({ B, D, ts, Abar, fc, fy, c }); pts.push({ ...q, phiPn: Math.min(q.phi * q.Pn, phiPnMax), phiMn: q.phi * q.Mn, capped: q.phi * q.Pn > phiPnMax }); }
  pts.push({ c: 0, Pn: -Ast * fy, Mn: 0, epsT: Infinity, phi: 0.9, phiPn: -0.9 * Ast * fy, phiMn: 0 });   // pure tension
  return { P0, PnMax, phiPnMax, points: pts, balanced: { c: 0.003 * dt / (0.003 + ey) } };
}
/** φMn available at axial load Pu (N) from an interaction curve (linear between points). */
export function phiMnAt(curve, Pu) {
  const p = curve.points; if (Pu > curve.phiPnMax) return 0;
  let best = 0;
  for (let i = 0; i + 1 < p.length; i++) { const a = p[i], b = p[i + 1]; const lo = Math.min(a.phiPn, b.phiPn), hi = Math.max(a.phiPn, b.phiPn); if (Pu < lo || Pu > hi || hi === lo) continue; const t = (Pu - a.phiPn) / (b.phiPn - a.phiPn); best = Math.max(best, a.phiMn + t * (b.phiMn - a.phiMn)); }
  return best;
}

/**
 * structure.columnDesign: bars for factored axial load and biaxial moments (with the nonsway magnifier and
 * the minimum moment), ρ limits, bar spacing, ties, and the dowel length into the base. Loads in kN, kN·m.
 */
export const columnDesign = register({
  name: 'structure.columnDesign', version: '1.0.0',
  assumptions: ['ACI 318-19 as encoded (unverified against printed text)', 'tied rectangular column, bars evenly around the perimeter', 'biaxial bending by the linear load contour Mux/φMnx + Muy/φMny ≤ 1 (conservative relative to Bresler)', 'nonsway (braced) frame; k as given (default 1.0); single curvature assumed, M1/M2 = −1, Cm = 1', 'βdns = 0.6 for (EI)eff', 'lu = storey height less the slab depth above'],
  inputs: null,
  run({ c, Pu_kN, Mux_kNm = 0, Muy_kNm = 0 }) {
    const b = c.b * 1000, h = c.h * 1000, fc = c.fc, fy = c.fy, main = ACI.BARS[c.bar_main]; if (!main) throw new Error('unknown bar');
    const tie = ACI.BARS[ACI.tieSize(main.db)], cv = c.cover * 1000, toBar = cv + tie.db + main.db / 2, Ag = b * h, Pu = Pu_kN * 1000;
    // slenderness
    const lu = (c.height - c.slab_depth) * 1000, rx = 0.3 * h, ry = 0.3 * b, limit = ACI.slendernessLimitNonsway(-1);
    const Ec = ACI.Ec(fc), mag = (dim, r) => { const sl = c.k * lu / r; if (sl <= limit) return { slenderness: sl, delta: 1, Pc: null }; const m = ACI.magnifier({ Pu, Ec, Ig: dim === 'x' ? b * h ** 3 / 12 : h * b ** 3 / 12, k: c.k, lu }); return { slenderness: sl, ...m }; };
    const sx = mag('x', rx), sy = mag('y', ry);
    const Mx = Math.max(Math.abs(Mux_kNm) * 1e6, ACI.M2min(Pu, h)) * sx.delta, My = Math.max(Math.abs(Muy_kNm) * 1e6, ACI.M2min(Pu, b)) * sy.delta;
    // choose the bar count: grow nx, ny until utilisation ≤ 1 and ρ, spacing hold
    let chosen = null; const trials = [];
    for (let nf = 2; nf <= 12 && !chosen; nf++) for (const [nx, ny] of [[nf, nf], [nf, nf + 1], [nf + 1, nf]]) {
      const bars = perimeterBars(b, h, toBar, nx, ny), Ast = bars.length * main.area, rho = Ast / Ag;
      if (rho > ACI.COLUMN_RHO.max) continue;
      const clearX = (b - 2 * toBar) / (nx - 1) - main.db, clearY = (h - 2 * toBar) / (ny - 1) - main.db, sMin = ACI.columnClearSpacingMin(main.db);
      if (Math.min(clearX, clearY) < sMin) continue;
      const cx = interaction({ B: b, D: h, ts: bars.map(q => q[1]), Abar: main.area, fc, fy }), cy = interaction({ B: h, D: b, ts: bars.map(q => q[0]), Abar: main.area, fc, fy });
      const mx = phiMnAt(cx, Pu), my = phiMnAt(cy, Pu), uAx = Pu / cx.phiPnMax, uM = (mx > 0 ? Mx / mx : Infinity) + (my > 0 ? My / my : Infinity);
      const t = { nx, ny, n: bars.length, Ast, rho, bars, cx, cy, phiMnx: mx, phiMny: my, util: Math.max(uAx, uM, ACI.COLUMN_RHO.min / rho), clearX, clearY, sMin };
      trials.push(t); if (t.util <= 1 && rho >= ACI.COLUMN_RHO.min) { chosen = t; break; }
    }
    if (!chosen) chosen = trials.reduce((m, t) => (!m || t.util < m.util ? t : m), null);
    if (!chosen) throw new Error('no bar arrangement fits the section');
    const sTie = Math.floor(ACI.tieSpacing(main.db, tie.db, Math.min(b, h)) / 25) * 25;
    const dowel = { lap: Math.max(ACI.lapCompression(main.db, fy), ACI.lapTensionB(ACI.ld(main.db, fy, fc))), ldc: ACI.ldc(main.db, fy, fc) };
    const checks = [
      { name: `axial (${chosen.n} ${main.id})`, clause: '22.4.2.1, 21.2.2', demand: Pu_kN, capacity: chosen.cx.phiPnMax / 1000, util: Pu / chosen.cx.phiPnMax },
      { name: 'biaxial bending, load contour', clause: '22.4, R22.4', demand: Mx / 1e6 + My / 1e6, capacity: null, util: (Mx / chosen.phiMnx) + (My / chosen.phiMny) },
      { name: 'minimum longitudinal steel', clause: '10.6.1.1', demand: ACI.COLUMN_RHO.min, capacity: chosen.rho, util: ACI.COLUMN_RHO.min / chosen.rho },
      { name: 'maximum longitudinal steel', clause: '10.6.1.1', demand: chosen.rho, capacity: ACI.COLUMN_RHO.max, util: chosen.rho / ACI.COLUMN_RHO.max },
      { name: 'bar clear spacing', clause: '25.2.3', demand: chosen.sMin, capacity: Math.min(chosen.clearX, chosen.clearY), util: chosen.sMin / Math.min(chosen.clearX, chosen.clearY) },
      { name: `slenderness x (kℓu/r ${sx.slenderness.toFixed(1)} vs ${limit})`, clause: '6.2.5.1, 6.6.4.5', demand: sx.delta, capacity: null, util: Number.isFinite(sx.delta) ? 0 : Infinity },
      { name: `slenderness y (kℓu/r ${sy.slenderness.toFixed(1)} vs ${limit})`, clause: '6.2.5.1, 6.6.4.5', demand: sy.delta, capacity: null, util: Number.isFinite(sy.delta) ? 0 : Infinity },
      { name: `tie spacing (${tie.id} @ ${sTie} mm)`, clause: '25.7.2.1', demand: sTie, capacity: ACI.tieSpacing(main.db, tie.db, Math.min(b, h)), util: sTie / ACI.tieSpacing(main.db, tie.db, Math.min(b, h)) },
    ];
    const governing = checks.reduce((g, k) => (k.util > (g?.util ?? -1) ? k : g), null);
    return { ruleset: ACI.RULESET, Pu_kN, Mux_kNm: Mx / 1e6, Muy_kNm: My / 1e6, slender: { x: sx, y: sy, limit, lu }, layout: { nx: chosen.nx, ny: chosen.ny, n: chosen.n, bar: main.id, Ast: chosen.Ast, rho: chosen.rho, coords: chosen.bars },
      phiPnMax_kN: chosen.cx.phiPnMax / 1000, phiMnx_kNm: chosen.phiMnx / 1e6, phiMny_kNm: chosen.phiMny / 1e6, curveX: chosen.cx.points.map(q => [q.phiMn / 1e6, q.phiPn / 1000]), curveY: chosen.cy.points.map(q => [q.phiMn / 1e6, q.phiPn / 1000]),
      ties: { bar: tie.id, s: sTie }, dowel, checks, governing, bars: { main, tie } };
  },
});

/**
 * structure.columnBars: longitudinal bars from the base to the top (hooked into the slab when the column
 * stops there, lapped above otherwise), dowels from the cap's bottom mat to a lap above the base, closed
 * perimeter ties at the design spacing with cross-ties so no bar is farther than 150 mm clear from a
 * supported one (25.7.2.3).
 */
export const columnBars = register({
  name: 'structure.columnBars', version: '1.0.0',
  assumptions: ['bars rotate with the column', 'top hooks turn towards the column centre under the slab top cover', 'dowels hook on the cap bottom mat (90°) and lap the column bars above the base', 'first tie s/2 above the base'],
  inputs: null,
  run({ c, design, base = null }) {
    const r = c.rotation * Math.PI / 180, ca = Math.cos(r), sa = Math.sin(r), W = (x, y, z) => [c.center[0] + ca * x - sa * y, c.center[1] + sa * x + ca * y, z];
    const db = design.bars.main.db / 1000, dt = design.bars.tie.db / 1000, cv = c.cover, bars = [];
    const zb = c.z0, zt = c.z0 + c.height, topCover = 0.04;
    design.layout.coords.forEach(([xm, ym], i) => {
      const x = xm / 1000, y = ym / 1000, ztop = c.continues_above ? zt + design.dowel.lap / 1000 : zt - topCover - db / 2;
      const len = Math.hypot(x, y) || 1, hk = c.continues_above ? null : [-x / len * ca + y / len * sa, -x / len * sa - y / len * ca, 0];
      bars.push({ name: `${c.name}-L${i + 1}`, shape: c.continues_above ? 'straight' : 'hooked', designation: design.layout.bar, diameter: db, mark: 'L', path: roundPath(hookedBar(W(x, y, zb + 0.0), W(x, y, ztop), db, { hookEnd: hk })), cover: cv });
      if (base) {
        const zd0 = base.zBottomMat, zd1 = zb + design.dowel.lap / 1000;
        bars.push({ name: `${c.name}-D${i + 1}`, shape: 'hooked', designation: design.layout.bar, diameter: db, mark: 'D', path: roundPath(hookedBar(W(x, y, zd1), W(x, y, zd0), db, { hookEnd: [x / len * ca - y / len * sa, x / len * sa + y / len * ca, 0] })), cover: cv, role: 'dowel into the base' });
      }
    });
    const bx = c.b / 2 - cv - dt / 2, by = c.h / 2 - cv - dt / 2, s = design.ties.s / 1000; let k = 0;
    // cross-ties: for each face, intermediate bars more than 150 mm clear from the nearest supported bar get a leg across
    const xs = [...new Set(design.layout.coords.map(q => q[0]))].sort((a, b) => a - b), ys = [...new Set(design.layout.coords.map(q => q[1]))].sort((a, b) => a - b);
    const needLeg = (vals) => vals.slice(1, -1).filter((v, i, arr) => { const sup = [vals[0], vals[vals.length - 1]]; const near = Math.min(...sup.map(s0 => Math.abs(s0 - v))) - design.bars.main.db; return near > ACI.TIE_UNSUPPORTED_CLEAR; });
    const legsX = needLeg(xs), legsY = needLeg(ys);
    for (let z = zb + s / 2; z <= zt - 0.05; z += s) {
      k++; bars.push({ name: `${c.name}-T${k}`, shape: 'tie', designation: design.ties.bar, diameter: dt, mark: 'T', path: roundPath(closedLoop([W(-bx, -by, z), W(bx, -by, z), W(bx, by, z), W(-bx, by, z)])), cover: cv, spacing: s });
      legsX.forEach((x, j) => bars.push({ name: `${c.name}-T${k}x${j + 1}`, shape: 'crosstie', designation: design.ties.bar, diameter: dt, mark: 'X', path: roundPath([W(x / 1000, -by, z), W(x / 1000, by, z)]), cover: cv }));
      legsY.forEach((y, j) => bars.push({ name: `${c.name}-T${k}y${j + 1}`, shape: 'crosstie', designation: design.ties.bar, diameter: dt, mark: 'X', path: roundPath([W(-bx, y / 1000, z), W(bx, y / 1000, z)]), cover: cv }));
    }
    return { bars, count: bars.length };
  },
});
