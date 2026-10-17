// slabs.js - two-way flat plates and flat slabs with drop panels on a rectangular column grid, to ACI 318-19:
// the Direct Design Method (8.10) for strip moments, minimum thickness (8.3.1.1), drop panel geometry (8.2.4),
// punching shear on the true critical perimeters with unbalanced moment transfer (8.4.4.2, 22.6), headed-stud
// rails where needed (8.7.7, 22.6.6, 22.6.8), the bottom and top mats with the bar extensions of Fig. 8.7.4.1.3,
// and the column reactions the load path carries down. Units: kN, kN/m², m at the edges; N, mm inside checks.
import { register } from './functions.js';
import * as ACI from './standards/aci318-19.js';
import { hookedBar, roundPath, spread, closedLoop } from './detail.js';

const num = (el, name, dflt) => { const p = el.params[name]; return p === undefined ? dflt : p.value; };
/**
 * Positions of n bars at spacing s (m) across a strip: column strips are laid symmetrically about the column
 * line (pairs at ±s/2, ±3s/2 … so two bars pass through the column core, 8.7.4.2.1), skipping positions outside
 * the strip; middle strips evenly. Shared by the design check and the bar generator so they cannot disagree.
 */
export function stripPositions(range, n, s, lineAt = null) {
  if (lineAt === null) return spread(range[0] + s / 2, range[1] - s / 2, n);
  const out = []; for (let k = 0; out.length < n && k < 4 * n + 4; k++) for (const sign of [-1, 1]) { const v = lineAt + sign * (k + 0.5) * s; if (v >= range[0] + 1e-9 && v <= range[1] - 1e-9 && out.length < n) out.push(v); }
  return out.sort((a, b) => a - b);
}
const uniq = a => [...new Set(a.map(v => Math.round(v * 1000) / 1000))].sort((p, q) => p - q);

/** Everything the slab system's design reads: the slab, the columns under it, its drop panels. */
export function slabInputs(model, slab) {
  const l = model.get(slab.parent); if (!l || l.type !== 'level') throw new Error(`${slab.id}: parent is not a level`);
  const outline = num(slab, 'outline'), xsO = outline.map(p => p[0]), ysO = outline.map(p => p[1]);
  const rect = { x0: Math.min(...xsO), x1: Math.max(...xsO), y0: Math.min(...ysO), y1: Math.max(...ysO) };
  const area = rect => (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
  const polyArea = Math.abs(outline.reduce((s, p, i) => { const q = outline[(i + 1) % outline.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const zTop = num(l, 'elevation', 0) + num(slab, 'offset', num(l, 'height', 3)), h = num(slab, 'thickness', 0.25);
  const cols = model.byType('column').filter(c => {
    const lc = model.get(c.parent); if (!lc) return false;
    const top = num(lc, 'elevation', 0) + num(c, 'base_offset', 0) + num(c, 'height', num(lc, 'height', 3)), [x, y] = num(c, 'center');
    return Math.abs(top - zTop) < 1e-6 && x >= rect.x0 - 1e-9 && x <= rect.x1 + 1e-9 && y >= rect.y0 - 1e-9 && y <= rect.y1 + 1e-9;
  }).map(c => ({ id: c.id, name: c.name, x: num(c, 'center')[0], y: num(c, 'center')[1], cx: num(c, 'width', 0.4), cy: num(c, 'depth', 0.4), rotation: num(c, 'rotation', 0) }));
  const drops = model.all().filter(e => e.type === 'drop_panel' && e.parent === slab.id).map(d => ({ id: d.id, center: num(d, 'center'), size: num(d, 'size'), projection: num(d, 'projection') }));
  return { id: slab.id, name: slab.name, rect, rectangular: Math.abs(polyArea - area(rect)) < 1e-6, zTop, h, cols, drops,
    fc: num(slab, 'fc', 28), fy: num(slab, 'fy', 420), fyt_stud: num(slab, 'fyt_stud', 345), sdl: num(slab, 'sdl', 1.5), ll: num(slab, 'll', 2.4), unit_weight: num(slab, 'unit_weight', 23.6),
    cover: num(slab, 'cover', 0.02), bar: num(slab, 'bar', '#5'), stud: num(slab, 'stud', '#4') };
}

// ---- critical perimeters --------------------------------------------------------------------------
/** Clip segment p→q to the rectangle r (Liang–Barsky). Returns null if nothing is inside. */
function clipSeg(p, q, r) {
  let t0 = 0, t1 = 1; const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [pp, qq] of [[-dx, p[0] - r.x0], [dx, r.x1 - p[0]], [-dy, p[1] - r.y0], [dy, r.y1 - p[1]]]) {
    if (Math.abs(pp) < 1e-15) { if (qq < 0) return null; continue; }
    const t = qq / pp; if (pp < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy]];
}
const onEdge = (a, b, r) => (Math.abs(a[0] - b[0]) < 1e-9 && (Math.abs(a[0] - r.x0) < 1e-9 || Math.abs(a[0] - r.x1) < 1e-9)) || (Math.abs(a[1] - b[1]) < 1e-9 && (Math.abs(a[1] - r.y0) < 1e-9 || Math.abs(a[1] - r.y1) < 1e-9));
/**
 * The critical perimeter around a rectangle (centre, half-sizes ax, ay) offset by e, optionally chamfered at
 * the corners (the outer section of a stud-reinforced zone), clipped to the slab: parts outside the slab or
 * lying on its edge are dropped (22.6.4.1, 22.6.4.2). Returns segments [[x,y],[x,y]] in m.
 */
export function criticalPerimeter({ x, y, ax, ay, e, chamfer = false }, slab) {
  const X = ax + e, Y = ay + e; let pts;
  if (!chamfer) pts = [[x - X, y - Y], [x + X, y - Y], [x + X, y + Y], [x - X, y + Y]];
  else pts = [[x - ax, y - Y], [x + ax, y - Y], [x + X, y - ay], [x + X, y + ay], [x + ax, y + Y], [x - ax, y + Y], [x - X, y + ay], [x - X, y - ay]];
  const segs = [];
  for (let i = 0; i < pts.length; i++) { const c = clipSeg(pts[i], pts[(i + 1) % pts.length], slab); if (c && Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) > 1e-9 && !onEdge(c[0], c[1], slab)) segs.push(c); }
  return segs;
}
/**
 * Properties of a critical section of effective depth d (m) made of segments: bo, centroid, and Jc about
 * both centroidal axes, as the polar-moment analogue of R8.4.4.2.3: a segment contributes d∫(x−x̄)²ds and,
 * when it runs along x, L d³/12 (cos²θ for an inclined segment). Jx governs stress varying with x.
 */
export function sectionProps(segs, d) {
  let bo = 0, sx = 0, sy = 0;
  for (const [a, b] of segs) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); bo += L; sx += L * (a[0] + b[0]) / 2; sy += L * (a[1] + b[1]) / 2; }
  const xb = sx / bo, yb = sy / bo; let Jx = 0, Jy = 0;
  for (const [a, b] of segs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), c2x = ((b[0] - a[0]) / L) ** 2, c2y = ((b[1] - a[1]) / L) ** 2;
    const i2 = (u0, u1) => L * (u0 * u0 + u0 * u1 + u1 * u1) / 3;   // ∫ u² ds along the segment, u linear from u0 to u1
    Jx += d * i2(a[0] - xb, b[0] - xb) + L * d ** 3 / 12 * c2x;
    Jy += d * i2(a[1] - yb, b[1] - yb) + L * d ** 3 / 12 * c2y;
  }
  const verts = segs.flat(); return { bo, xb, yb, Jx, Jy, cx: Math.max(...verts.map(v => Math.abs(v[0] - xb))), cy: Math.max(...verts.map(v => Math.abs(v[1] - yb))), verts };
}
/** Area of the slab enclosed by a perimeter's offset rectangle (for deducting load inside the section). */
const insideArea = ({ x, y, ax, ay, e }, r) => Math.max(0, Math.min(x + ax + e, r.x1) - Math.max(x - ax - e, r.x0)) * Math.max(0, Math.min(y + ay + e, r.y1) - Math.max(y - ay - e, r.y0));

// ---- the design -------------------------------------------------------------------------------------
/**
 * structure.flatSlabDesign: DDM strip moments in both directions, thickness and drop-panel checks,
 * strip reinforcement, punching at every column (and outside every drop panel), stud rails where needed,
 * and the factored and service column reactions. Check rows {name, clause, demand, capacity, util}.
 */
export const flatSlabDesign = register({
  name: 'structure.flatSlabDesign', version: '1.0.0',
  assumptions: ['ACI 318-19 as encoded (unverified against printed text)', 'rectangular slab on a full rectangular column grid; DDM limits reported, not waived', 'no edge beams; columns flush with or inside the slab edge', 'column-strip negative steel designed for the slab depth alone (drop panel thickness ignored for flexure, conservative)', 'drop panel weight smeared over its panel for the strip moments, applied locally for reactions', 'column reactions by tributary area to mid-span lines', 'punching: unbalanced moments act together at the worst corner (conservative); edge-column γf increase of 8.4.2.2.4 not used', 'perimeter truncated at a slab edge only when the edge is within d/2 of the column face', 'stud rails 2 per column face at quarter points; outer section through the rail ends with 45° corner chamfers', 'slab deflection controlled by the minimum thickness of 8.3.1.1 (no computed deflection)'],
  inputs: null,
  run(s) {
    if (!s.rectangular) throw new Error('the slab outline is not a rectangle: DDM here needs a rectangular slab');
    const xs = uniq(s.cols.map(c => c.x)), ys = uniq(s.cols.map(c => c.y));
    if (xs.length < 2 || ys.length < 2) throw new Error('need a grid of at least 2 × 2 columns under the slab');
    const at = (x, y) => s.cols.find(c => Math.abs(c.x - x) < 1e-3 && Math.abs(c.y - y) < 1e-3);
    for (const x of xs) for (const y of ys) if (!at(x, y)) throw new Error(`no column at grid point (${x}, ${y}): DDM needs a full grid`);
    const R = s.rect, h = s.h * 1000, bar = ACI.BARS[s.bar], db = bar.db, cv = s.cover * 1000, checks = [];
    const dX = h - cv - db / 2, dY = h - cv - 1.5 * db, dAvg = h - cv - db;   // x bars outer layer
    const γ = s.unit_weight, dropAreaW = s.drops.reduce((a, d) => a + d.size[0] * d.size[1] * d.projection * γ, 0);
    const qD = γ * s.h + s.sdl + dropAreaW / ((R.x1 - R.x0) * (R.y1 - R.y0)), qL = s.ll, qu = 1.2 * qD + 1.6 * qL;
    const spansX = xs.slice(1).map((x, i) => x - xs[i]), spansY = ys.slice(1).map((y, i) => y - ys[i]);
    // 8.10.2 limits
    for (const lim of ACI.ddmLimits({ spansX, spansY, l1: Math.max(...spansX), l2: Math.max(...spansY), qD, qL })) checks.push({ name: `DDM: ${lim.text}`, clause: lim.clause, demand: null, capacity: null, util: lim.ok ? 0 : Infinity });
    // thickness (8.3.1.1) on the longest clear span
    const hasDrops = s.drops.length > 0, cmax = Math.max(...s.cols.map(c => Math.max(c.cx, c.cy)));
    // a panel counts as "with drop panels" for Table 8.3.1.1 only when every column of that panel class has one
    const hasDrop = c => s.drops.some(q => Math.abs(q.center[0] - c.x) < q.size[0] / 2 && Math.abs(q.center[1] - c.y) < q.size[1] / 2);
    const isExt = c => Math.abs(c.x - xs[0]) < 1e-3 || Math.abs(c.x - xs[xs.length - 1]) < 1e-3 || Math.abs(c.y - ys[0]) < 1e-3 || Math.abs(c.y - ys[ys.length - 1]) < 1e-3;
    const dropsExt = hasDrops && s.cols.every(hasDrop), dropsInt = hasDrops && s.cols.filter(c => !isExt(c)).every(hasDrop);
    const lnMax = (Math.max(...spansX, ...spansY) - cmax) * 1000, ext = ACI.slabMinThickness(lnMax, { drops: dropsExt, exterior: true }), int_ = ACI.slabMinThickness(lnMax, { drops: dropsInt, exterior: false });
    checks.push({ name: `minimum thickness, exterior panel (ℓn/${ext.divisor})`, clause: ext.clause, demand: ext.h, capacity: h, util: ext.h / h });
    checks.push({ name: `minimum thickness, interior panel (ℓn/${int_.divisor})`, clause: int_.clause, demand: int_.h, capacity: h, util: int_.h / h });
    // drop panels (8.2.4)
    for (const dp of s.drops) {
      const col = s.cols.reduce((m, c) => (!m || Math.hypot(c.x - dp.center[0], c.y - dp.center[1]) < Math.hypot(m.x - dp.center[0], m.y - dp.center[1]) ? c : m), null);
      checks.push({ name: `drop panel ${col.name}: projection ≥ h/4`, clause: ACI.DROP_PANEL.clause, demand: h / 4, capacity: dp.projection * 1000, util: (h / 4) / (dp.projection * 1000) });
      const ix = xs.findIndex(x => Math.abs(x - col.x) < 1e-3), iy = ys.findIndex(y => Math.abs(y - col.y) < 1e-3);
      for (const [axis, i, grid, half] of [['x', ix, xs, dp.size[0] / 2], ['y', iy, ys, dp.size[1] / 2]]) {
        for (const side of [-1, 1]) {
          const j = i + side; if (j < 0 || j >= grid.length) continue;   // towards a free edge: no adjacent span
          const l = Math.abs(grid[j] - grid[i]), reach = side < 0 ? (axis === 'x' ? col.x - (dp.center[0] - half) : col.y - (dp.center[1] - half)) : (axis === 'x' ? dp.center[0] + half - col.x : dp.center[1] + half - col.y);
          checks.push({ name: `drop panel ${col.name}: extent ${axis}${side < 0 ? '−' : '+'} ≥ ℓ/6`, clause: ACI.DROP_PANEL.clause, demand: l / 6 * 1000, capacity: reach * 1000, util: (l / 6) / reach });
        }
      }
    }
    // DDM strips in each direction
    const strips = { x: ddmDirection('x', xs, ys, R, s, qu, qD, qL), y: ddmDirection('y', ys, xs, R, s, qu, qD, qL) };
    const AsMinRatio = ACI.SLAB_AS_MIN_RATIO, sMax = ACI.slabMaxSpacing(h);
    for (const dir of ['x', 'y']) {
      const d = dir === 'x' ? dX : dY;
      for (const st of strips[dir].strips) for (const loc of st.locations) {
        const b = st.width * 1000, Mu = Math.abs(loc.Mu) * 1e6, need = Mu > 0 ? asReq(b, d, s.fc, s.fy, Mu) : 0;
        if (need === null) { checks.push({ name: `slab ${dir} ${st.kind} ${loc.label}`, clause: '8.5.1, 22.2', demand: loc.Mu, capacity: null, util: Infinity }); loc.error = true; continue; }
        const As = Math.max(need, AsMinRatio * b * h); let n = Math.max(2, Math.ceil(As / bar.area));
        // column-strip bottom bars: spacing ≤ the column core width so two bars pass through the core (8.7.4.2.1)
        const coreS = st.type === 'column' && loc.kind === 'bottom' ? (Math.min(...s.cols.map(c => (dir === 'x' ? c.cy : c.cx))) - 2 * s.cover) * 1000 : Infinity;
        while (b / n > Math.min(sMax, coreS)) n++;
        let spacing = Math.floor(b / n / 5) * 5;
        if (st.type === 'column') { const line = strips[dir].frames[st.line].y; while (spacing > 50 && stripPositions(st.range, n, spacing / 1000, line).length < n) spacing -= 5; }
        const Asp = n * bar.area, a = Asp * s.fy / (0.85 * s.fc * b), phiMn = 0.9 * Asp * s.fy * (d - a / 2) / 1e6;
        Object.assign(loc, { As_req: need, As_min: AsMinRatio * b * h, n, spacing, As: Asp, phiMn_kNm: phiMn, d });
        if (Mu > 0) checks.push({ name: `slab ${dir} ${st.kind} ${loc.label} (${n} ${bar.id} @ ${spacing})`, clause: '8.5.1, 22.2', demand: Math.abs(loc.Mu), capacity: phiMn, util: Math.abs(loc.Mu) / phiMn });
        checks.push({ name: `slab ${dir} ${st.kind} ${loc.label} spacing ≤ min(2h, 450)`, clause: '8.7.2.2', demand: spacing, capacity: sMax, util: spacing / sMax });
      }
    }
    // 8.7.4.2.1 structural integrity: at least two column-strip bottom bars in each direction pass within the column core
    for (const dir of ['x', 'y']) for (const st of strips[dir].strips.filter(q => q.type === 'column')) {
      const loc = st.locations.find(q => q.kind === 'bottom' && q.n); if (!loc) continue;
      const lineAt = strips[dir].frames[st.line].y, pos = stripPositions(st.range, loc.n, loc.spacing / 1000, lineAt), half = Math.min(...s.cols.map(c => (dir === 'x' ? c.cy : c.cx))) / 2;
      const through = pos.filter(v => Math.abs(v - lineAt) <= half - s.cover).length;
      checks.push({ name: `integrity: bottom bars through the column core, ${st.kind}`, clause: '8.7.4.2.1', demand: 2, capacity: through, util: through > 0 ? 2 / through : Infinity });
    }
    // reactions by tributary area (and drop weight locally) + unbalanced moments
    const reactions = s.cols.map(c => {
      const ix = xs.findIndex(x => Math.abs(x - c.x) < 1e-3), iy = ys.findIndex(y => Math.abs(y - c.y) < 1e-3);
      const tx0 = ix === 0 ? R.x0 : (xs[ix - 1] + c.x) / 2, tx1 = ix === xs.length - 1 ? R.x1 : (xs[ix + 1] + c.x) / 2, ty0 = iy === 0 ? R.y0 : (ys[iy - 1] + c.y) / 2, ty1 = iy === ys.length - 1 ? R.y1 : (ys[iy + 1] + c.y) / 2;
      const A = (tx1 - tx0) * (ty1 - ty0), dp = s.drops.find(q => Math.abs(q.center[0] - c.x) < q.size[0] / 2 && Math.abs(q.center[1] - c.y) < q.size[1] / 2);
      const qDflat = γ * s.h + s.sdl, dropW = dp ? dp.size[0] * dp.size[1] * dp.projection * γ : 0;
      const D = qDflat * A + dropW, L = qL * A, edgeX = ix === 0 || ix === xs.length - 1, edgeY = iy === 0 || iy === ys.length - 1;
      const Msc = { x: strips.x.unbalanced(ix, iy), y: strips.y.unbalanced(iy, ix) };
      return { column: c.id, name: c.name, ix, iy, trib: [tx0, tx1, ty0, ty1], area: A, D_kN: D, L_kN: L, Pu_kN: 1.2 * D + 1.6 * L, location: edgeX && edgeY ? 'corner' : edgeX || edgeY ? 'edge' : 'interior', Mx_kNm: Msc.x, My_kNm: Msc.y, drop: dp?.id ?? null };
    });
    // punching
    const punching = reactions.map(rc => punchingAt(rc, s, R, dAvg, qu, checks));
    const governing = checks.filter(k => !k.superseded).reduce((g, k) => (k.util > (g?.util ?? -1) ? k : g), null);
    return { ruleset: ACI.RULESET, grid: { xs, ys }, loads: { qD, qL, qu }, d: { x: dX, y: dY, avg: dAvg }, strips, reactions, punching, checks, governing, bar: bar.id };
  },
});

function asReq(b, d, fc, fy, Mu) {
  const phi = 0.9, k = fy / (2 * 0.85 * fc * b), disc = (fy * d) ** 2 - 4 * fy * k * Mu / phi;
  return disc < 0 ? null : (fy * d - Math.sqrt(disc)) / (2 * fy * k);
}

/**
 * DDM in one direction ("x": spans along x between column lines xs, frames along the lines ys). Returns the
 * frames, the strips (column strips on each line, middle strips between lines) with their design locations,
 * and the unbalanced-moment function for punching.
 */
function ddmDirection(dir, xs, ys, R, s, qu, qD, qL) {
  const lo = dir === 'x' ? R.y0 : R.x0, hi = dir === 'x' ? R.y1 : R.x1, a0 = dir === 'x' ? R.x0 : R.y0, a1 = dir === 'x' ? R.x1 : R.y1;
  const nS = xs.length - 1, colDim = (i, j) => { const c = s.cols.find(q => Math.abs((dir === 'x' ? q.x : q.y) - xs[i]) < 1e-3 && Math.abs((dir === 'x' ? q.y : q.x) - ys[j]) < 1e-3); return dir === 'x' ? c.cx : c.cy; };
  const frames = ys.map((y, j) => {
    const bandLo = j === 0 ? lo : (ys[j - 1] + y) / 2, bandHi = j === ys.length - 1 ? hi : (ys[j + 1] + y) / 2, l2 = bandHi - bandLo;
    const spans = xs.slice(1).map((x, i) => {
      const l1 = x - xs[i], ln = l1 - (colDim(i, j) + colDim(i + 1, j)) / 2, m0 = ACI.M0(qu, l2, ln, l1);
      const end = nS > 1 && (i === 0 || i === nS - 1), co = end ? ACI.DDM_LONGITUDINAL.end : ACI.DDM_LONGITUDINAL.interior;
      const negL = nS === 1 ? co.extNeg ?? ACI.DDM_LONGITUDINAL.end.extNeg : end && i === 0 ? co.extNeg : end ? co.intNeg : co.neg;
      const negR = nS === 1 ? ACI.DDM_LONGITUDINAL.end.extNeg : end && i === nS - 1 ? co.extNeg : end ? co.intNeg : co.neg;
      return { i, l1, ln, M0: m0, neg: [negL * m0, negR * m0], pos: co.pos * m0, clause: co.clause };
    });
    // support moments: the larger of the two sides at interior supports (8.10.4.4)
    const supports = xs.map((x, k) => { const left = spans[k - 1]?.neg[1] ?? 0, right = spans[k]?.neg[0] ?? 0; return { k, x, M: Math.max(left, right), exterior: k === 0 || k === nS }; });
    const halfCS = (side) => { const lt = side < 0 ? (j === 0 ? 0 : y - ys[j - 1]) : (j === ys.length - 1 ? 0 : ys[j + 1] - y); const l1m = Math.min(...spans.map(sp => sp.l1)); return lt === 0 ? (side < 0 ? y - bandLo : bandHi - y) : Math.min(ACI.columnStripHalf(l1m, lt), side < 0 ? y - bandLo : bandHi - y); };
    const cs = [y - halfCS(-1), y + halfCS(1)];
    return { j, y, band: [bandLo, bandHi], l2, cs, spans, supports };
  });
  // strips: column strip of each frame, and middle strips between frames (each fed by the two adjacent frames' middle shares)
  const strips = [];
  const shareCS = loc => (loc === 'pos' ? ACI.DDM_COLUMN_STRIP.pos : loc === 'ext' ? ACI.DDM_COLUMN_STRIP.extNeg : ACI.DDM_COLUMN_STRIP.intNeg);
  for (const f of frames) {
    const locs = [];
    f.supports.forEach(sp => locs.push({ label: `support ${dir === 'x' ? 'x' : 'y'}=${sp.x.toFixed(2)}`, kind: 'top', at: sp.x, k: sp.k, exterior: sp.exterior, Mu: -sp.M * shareCS(sp.exterior ? 'ext' : 'int') }));
    f.spans.forEach(sp => locs.push({ label: `span ${sp.i + 1}`, kind: 'bottom', span: sp.i, Mu: sp.pos * shareCS('pos') }));
    strips.push({ kind: `column strip ${dir === 'x' ? 'y' : 'x'}=${f.y.toFixed(2)} (bars along ${dir})`, type: 'column', line: f.j, range: f.cs, width: f.cs[1] - f.cs[0], locations: locs });
  }
  for (let j = 0; j + 1 < frames.length; j++) {
    const fa = frames[j], fb = frames[j + 1], range = [fa.cs[1], fb.cs[0]], w = range[1] - range[0]; if (w <= 1e-6) continue;
    const midW = f => (f.band[1] - f.band[0]) - (f.cs[1] - f.cs[0]);   // the frame's total middle-strip width
    const part = (f, side) => { const half = side > 0 ? f.band[1] - f.cs[1] : f.cs[0] - f.band[0]; const mw = midW(f); return mw > 0 ? half / mw : 0; };
    const locs = [];
    fa.supports.forEach((sp, k) => { const ma = sp.M * (1 - shareCS(sp.exterior ? 'ext' : 'int')) * part(fa, 1), mb = fb.supports[k].M * (1 - shareCS(sp.exterior ? 'ext' : 'int')) * part(fb, -1); locs.push({ label: `support ${dir}=${sp.x.toFixed(2)}`, kind: 'top', at: sp.x, k, exterior: sp.exterior, Mu: -(ma + mb) }); });
    fa.spans.forEach((sp, i) => { const ma = sp.pos * (1 - shareCS('pos')) * part(fa, 1), mb = fb.spans[i].pos * (1 - shareCS('pos')) * part(fb, -1); locs.push({ label: `span ${i + 1}`, kind: 'bottom', span: i, Mu: ma + mb }); });
    strips.push({ kind: `middle strip ${dir === 'x' ? 'y' : 'x'}=${fa.y.toFixed(2)}–${fb.y.toFixed(2)} (bars along ${dir})`, type: 'middle', line: j + 0.5, range, width: w, locations: locs });
  }
  /** Unbalanced moment at column (i along this direction, j across): edge 0.3 M0, interior 8.10.7.2. kN·m. */
  const unbalanced = (i, j) => {
    const f = frames[j]; if (nS === 0) return 0;
    if (i === 0) return ACI.EDGE_COLUMN_MSC * f.spans[0].M0;
    if (i === nS) return ACI.EDGE_COLUMN_MSC * f.spans[nS - 1].M0;
    const a = f.spans[i - 1], b = f.spans[i], qDu = 1.2 * qD, qLu = 1.6 * qL;
    const one = (sp, other) => ACI.interiorMsc(qDu, qLu, f.l2, sp.ln, qDu, f.l2, other.ln);
    return Math.max(Math.abs(one(a, b)), Math.abs(one(b, a)));
  };
  // identity used by the tests: for every span, average of the two negatives plus the positive equals M0
  return { frames, strips, unbalanced, a0, a1 };
}

/** Punching at one column: the column section (through the drop if any) and the section outside the drop. */
function punchingAt(rc, s, R, dAvg, qu, checks) {
  const c = s.cols.find(q => q.id === rc.column), dp = s.drops.find(q => q.id === rc.drop);
  const sections = [];
  const evalSection = (label, geo, d_mm) => {
    const d = d_mm / 1000, segs = criticalPerimeter({ ...geo, e: d / 2 }, R), P = sectionProps(segs, d);
    const sides = segs.filter(([a, b]) => Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9).length, loc = sides >= 4 ? 'interior' : sides === 3 ? 'edge' : 'corner';
    const αs = loc === 'interior' ? 40 : loc === 'edge' ? 30 : 20, β = Math.max(geo.ax, geo.ay) / Math.min(geo.ax, geo.ay);
    const Vu = (rc.Pu_kN - qu * insideArea({ ...geo, e: d / 2 }, R)) * 1000;   // N
    const b1x = 2 * geo.ax + d, b2x = 2 * geo.ay + d, γvx = 1 - ACI.gammaF(b1x, b2x), γvy = 1 - ACI.gammaF(b2x, b1x);
    const Mx = Math.abs(rc.Mx_kNm) * 1e6, My = Math.abs(rc.My_kNm) * 1e6, mm = 1000;
    let vu = 0;
    for (const v of P.verts) vu = Math.max(vu, Vu / (P.bo * mm * d_mm) + γvx * Mx * Math.abs(v[0] - P.xb) * mm / (P.Jx * mm ** 4) + γvy * My * Math.abs(v[1] - P.yb) * mm / (P.Jy * mm ** 4));
    const vc = ACI.vcTwoWay(s.fc, β, αs, d_mm, P.bo * mm), phivc = ACI.PHI_SHEAR * vc;
    const row = { label, location: loc, d_mm, bo_mm: P.bo * mm, Vu_kN: Vu / 1000, vu, vc, phivc, util: vu / phivc, segs, Jx: P.Jx, Jy: P.Jy, gamma_v: [γvx, γvy], alphaS: αs, beta: β, geo };
    row.check = { name: `punching ${c.name} ${label} (${loc})`, clause: '22.6.1.2, 22.6.5.2, 8.4.4.2', demand: vu, capacity: phivc, util: row.util };
    checks.push(row.check); sections.push(row); return row;
  };
  const hTot = dp ? dAvg + dp.projection * 1000 : dAvg;
  const inner = evalSection(dp ? 'at column, through drop' : 'at column', { x: c.x, y: c.y, ax: c.cx / 2, ay: c.cy / 2 }, hTot);
  if (dp) evalSection('outside drop panel', { x: dp.center[0], y: dp.center[1], ax: dp.size[0] / 2, ay: dp.size[1] / 2 }, dAvg);
  // studs where the column section fails
  let rails = null;
  if (inner.util > 1) {
    const d = inner.d_mm, fc = s.fc, fyt = s.fyt_stud, phi = ACI.PHI_SHEAR;
    const vcs = ACI.vcWithStuds(fc, d), vmax = ACI.vuMaxStuds(fc), sp = ACI.studSpacing(inner.vu, fc, d);
    const sidesN = inner.location === 'interior' ? 4 : inner.location === 'edge' ? 3 : 2, nRails = 2 * sidesN;
    const vsReq = Math.max(inner.vu / phi - vcs, 0.17 * Math.sqrt(fc));   // ≥ the 22.6.8.3 minimum
    // stud size and spacing: the largest spacing ≤ the 8.7.7.1.2 limit that supplies vs, upsizing the stud below 50 mm
    let stud = null, sUse = null;
    for (const id of [s.stud, '#5', '#6', '#7']) { const b_ = ACI.BARS[id]; const sNeed = nRails * b_.area * fyt / (vsReq * inner.bo_mm); const sv = Math.floor(Math.min(sp.s, sNeed) / 5) * 5; if (sv >= 50) { stud = b_; sUse = sv; break; } }
    if (!stud) { stud = ACI.BARS['#7']; sUse = 50; }
    const Av = nRails * stud.area, vs = Av * fyt / (inner.bo_mm * sUse), utilIn = inner.vu / (phi * (vcs + vs)), AvReq = vsReq * inner.bo_mm * sUse / fyt;
    checks.push({ name: `punching ${c.name}: vu ≤ φ 0.66√fc with studs`, clause: '22.6.6.2', demand: inner.vu, capacity: phi * vmax, util: inner.vu / (phi * vmax) });
    checks.push({ name: `punching ${c.name}: studs ${nRails} rails ${stud.id} @ ${sUse} mm`, clause: '22.6.6.1, 22.6.8.2, 8.7.7.1.2', demand: inner.vu, capacity: phi * (vcs + vs), util: utilIn });
    // extend rails until the outer section passes at 0.17 λs √fc
    const geo = inner.geo; let k = 1, outer = null;
    for (; k <= 40; k++) {
      const reach = (sp.s0 + (k - 1) * sUse) / 1000, e = reach + d / 2000;
      const segs = criticalPerimeter({ ...geo, e, chamfer: true }, R), P = sectionProps(segs, d / 1000);
      const Vu = (rc.Pu_kN - qu * insideArea({ ...geo, e }, R)) * 1000, vu = Vu / (P.bo * 1000 * d);
      const vcO = ACI.vcOutside(fc, d);
      outer = { studs: k, reach_mm: reach * 1000, bo_mm: P.bo * 1000, vu, phivc: phi * vcO, util: vu / (phi * vcO), segs };
      if (outer.util <= 1) break;
    }
    checks.push({ name: `punching ${c.name}: outside the studs (${outer.studs} per rail)`, clause: '22.6.4.2, 22.6.6.1', demand: outer.vu, capacity: outer.phivc, util: outer.util });
    inner.check.superseded = 'shear reinforcement provided: the stud rows govern';
    rails = { nRails, perSide: 2, stud: stud.id, studDia: stud.db, studArea: stud.area, s0: sp.s0, s: sUse, studs: outer.studs, AvReq, Av, vcs, vs, outer, sides: sidesN };
  }
  return { column: c.id, name: c.name, location: inner.location, sections, rails };
}

/**
 * structure.flatSlabBars: the mats (bottom x outer, bottom y above it; top x outer, top y below it), per strip
 * and span, with the extensions of Fig. 8.7.4.1.3 (bottom: 150 mm past the support line; column-strip top:
 * 0.30 ℓn past the column face; middle-strip top: 0.22 ℓn; top bars at a free edge hooked down), stud rails, and
 * the critical perimeters as punching_zone records.
 */
export const flatSlabBars = register({
  name: 'structure.flatSlabBars', version: '1.0.0',
  assumptions: ['all top bars of a strip extend 0.30 ℓn (column strip) or 0.22 ℓn (middle strip) from the face (the longer of Fig. 8.7.4.1.3’s two lengths, for all bars)', 'bars spread evenly across the strip; bar ends at slab edges at the cover', 'stud rails sit on the bottom mat; studs reach the top mat', 'hooks drawn as straight tails'],
  inputs: null,
  run({ s, design }) {
    const R = s.rect, cv = s.cover, b = ACI.BARS[s.bar], dbm = b.db / 1000, h = s.h, zBot = s.zTop - h, zTop = s.zTop, bars = [], zones = [], rails = [];
    const levels = { x: { bottom: zBot + cv + dbm / 2, top: zTop - cv - dbm / 2 }, y: { bottom: zBot + cv + 1.5 * dbm, top: zTop - cv - 1.5 * dbm } };
    for (const dir of ['x', 'y']) {
      const D = design.strips[dir], grid = dir === 'x' ? design.grid.xs : design.grid.ys, a0 = D.a0, a1 = D.a1;
      const P = (u, v, z) => (dir === 'x' ? [u, v, z] : [v, u, z]);
      const col = (k, line) => { const f = D.frames[Math.round(line)] || D.frames[Math.floor(line)]; return s.cols.find(c => Math.abs((dir === 'x' ? c.x : c.y) - grid[k]) < 1e-3 && Math.abs((dir === 'x' ? c.y : c.x) - f.y) < 1e-3); };
      for (const st of D.strips) {
        const cDim = k => { const c = col(k, st.line); return c ? (dir === 'x' ? c.cx : c.cy) : 0.4; };
        for (const loc of st.locations) {
          if (loc.error || !loc.n) continue;
          const vs = stripPositions(st.range, loc.n, loc.spacing / 1000, st.type === 'column' ? D.frames[st.line].y : null);
          let u0, u1, hook0 = null, hook1 = null;
          if (loc.kind === 'bottom') { const i = loc.span; u0 = i === 0 ? a0 + cv : grid[i] - 0.15; u1 = i === grid.length - 2 ? a1 - cv : grid[i + 1] + 0.15; }
          else {
            const k = loc.k, frac = st.type === 'column' ? 0.30 : 0.22, lnL = k > 0 ? grid[k] - grid[k - 1] - cDim(k) : 0, lnR = k < grid.length - 1 ? grid[k + 1] - grid[k] - cDim(k) : 0, half = cDim(k) / 2;
            u0 = k === 0 ? a0 + cv : grid[k] - half - frac * lnL; u1 = k === grid.length - 1 ? a1 - cv : grid[k] + half + frac * lnR;
            if (k === 0) hook0 = [0, 0, -1]; if (k === grid.length - 1) hook1 = [0, 0, -1];
          }
          const z = levels[dir][loc.kind];   // hooks (free edges) point straight down, the same in both directions
          vs.forEach((v, i) => bars.push({ name: `${s.name}-${dir.toUpperCase()}${loc.kind === 'top' ? 'T' : 'B'}-${st.type[0]}${st.line}-${loc.kind === 'top' ? 'S' + loc.k : 'P' + (loc.span + 1)}.${i + 1}`, shape: hook0 || hook1 ? 'hooked' : 'straight', designation: b.id, diameter: dbm, face: loc.kind, mark: `${dir.toUpperCase()}${loc.kind === 'top' ? 'T' : 'B'}${st.type === 'column' ? 'C' : 'M'}`, path: roundPath(hookedBar(P(u0, v, z), P(u1, v, z), dbm, { hookStart: hook0, hookEnd: hook1 })), cover: cv, strip: st.kind, location: loc.label }));
        }
      }
    }
    // stud rails and zones
    for (const pc of design.punching) {
      const c = s.cols.find(q => q.id === pc.column);
      for (const sec of pc.sections) zones.push({ name: `${c.name} ${sec.label}`, column: c.id, section: sec.label, util: sec.util, path: roundPath(sec.segs.flatMap(([a, q]) => [[a[0], a[1], zTop - h / 2], [q[0], q[1], zTop - h / 2]])), segments: sec.segs.length });
      if (pc.rails) {
        const r = pc.rails, zr = zBot + cv, studH = h - 2 * cv - 2 * dbm, rd = r.studDia / 1000, ax = c.cx / 2, ay = c.cy / 2;
        const dirs = [[1, 0, ay], [-1, 0, ay], [0, 1, ax], [0, -1, ax]];
        let k = 0;
        for (const [ux, uy, half] of dirs) for (const off of [-half / 2, half / 2]) {
          const ox = ux !== 0 ? c.x + ux * (ax) : c.x + off, oy = uy !== 0 ? c.y + uy * (ay) : c.y + off;
          const pts = [], tip = (r.s0 + (r.studs - 1) * r.s) / 1000 + 0.05;
          const inside = (x, y) => x > R.x0 + cv && x < R.x1 - cv && y > R.y0 + cv && y < R.y1 - cv;
          if (!inside(ox + ux * 0.01, oy + uy * 0.01)) continue;   // a rail would leave the slab at a free edge
          pts.push([ox, oy, zr]);
          for (let i = 0; i < r.studs; i++) { const t = (r.s0 + i * r.s) / 1000; const x = ox + ux * t, y = oy + uy * t; if (!inside(x, y)) break; pts.push([x, y, zr], [x, y, zr + studH], [x, y, zr]); }
          pts.push([ox + ux * tip, oy + uy * tip, zr]);
          k++; rails.push({ name: `${c.name}-SR${k}`, shape: 'stud_rail', designation: r.stud, diameter: rd, mark: 'SR', path: roundPath(pts), studs: r.studs, stud_spacing: r.s / 1000, first_stud: r.s0 / 1000, stud_height: studH, mass_kg: r.studs * studH * Math.PI * rd * rd / 4 * 7850 + tip * 25e-3 * 10e-3 * 7850, cover: cv, column: c.id });   // mass: studs + a 25 × 10 mm carrier rail (assumed rail section)
        }
      }
    }
    return { bars, rails, zones, count: bars.length + rails.length };
  },
});
