// reference.js - a SYNTHETIC reference structure that exercises every standard element: a 3 × 3 bay flat
// slab (6 m grid) with drop panels on 16 columns, a continuous 3-span grade beam and a simply supported
// grade beam at foundation level. Pile caps and piles are not created here: they are designed from the
// load path (page 03, "Create foundations"). Every element is marked method "assumed", source
// "reference-frame (synthetic)": it is a test structure, not a building.

const P = (v, unit = '') => ({ value: v, unit });
const PROV = note => ({ source: 'reference-frame (synthetic)', trace: '', method: 'assumed', note });

/** Plan origin to the right of everything already in the model, so the slab never picks up stray columns. */
function clearOrigin(model) {
  let maxX = -Infinity;
  for (const e of model.all()) for (const k of ['start', 'end', 'center']) { const v = e.params[k]?.value; if (Array.isArray(v) && typeof v[0] === 'number') maxX = Math.max(maxX, v[0]); }
  for (const e of model.byType('slab')) for (const q of e.params.outline?.value ?? []) maxX = Math.max(maxX, q[0]);
  return Number.isFinite(maxX) ? [Math.ceil(maxX + 10), 0] : [0, 0];
}

export function createReferenceFrame(app, { bay = 6, n = 3, col = 0.45, h = 0.25, drop = 2.2, projection = 0.15, ll = 4.8, above = { D: 600, L: 250 }, dropsAt = 'interior' } = {}) {
  const m = app.model, [ox, oy] = clearOrigin(m), half = col / 2, ids = {};
  m.batch('reference frame', () => {
    const fnd = m.create({ type: 'level', name: 'RF Foundation', params: { elevation: P(-1.0, 'm'), height: P(1.0, 'm') }, provenance: PROV('foundation level; grade beam tops at 0.000') });
    const gnd = m.create({ type: 'level', name: 'RF Ground', params: { elevation: P(0, 'm'), height: P(3.5, 'm') }, provenance: PROV('storey 3.500 m') });
    ids.levels = [fnd.id, gnd.id];
    ids.columns = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const c = m.create({ type: 'column', name: `RC${String.fromCharCode(65 + i)}${j + 1}`, parent: gnd.id, params: { center: P([ox + bay * i, oy + bay * j], 'm'), width: P(col, 'm'), depth: P(col, 'm'), rotation: P(0, 'deg'),
        fc: P(28, 'MPa'), fy: P(420, 'MPa'), cover: P(0.04, 'm'), bar_main: P('#8'), k: P(1.0), slab_depth: P(h, 'm'), continues_above: P(false), P_D: P(above.D, 'kN'), P_L: P(above.L, 'kN') }, provenance: PROV(`450 × 450 column on a 6 m grid; P_D ${above.D} kN and P_L ${above.L} kN stand for floors above (not modelled)`) });
      ids.columns.push(c.id);
    }
    const X0 = ox - half, X1 = ox + n * bay + half, Y0 = oy - half, Y1 = oy + n * bay + half;
    const slab = m.create({ type: 'slab', name: 'RF Slab', parent: gnd.id, params: { outline: P([[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]], 'm'), thickness: P(h, 'm'), offset: P(3.5, 'm'),
      fc: P(28, 'MPa'), fy: P(420, 'MPa'), sdl: P(1.5, 'kN/m2'), ll: P(ll, 'kN/m2'), cover: P(0.02, 'm'), bar: P('#5'), stud: P('#4'), fyt_stud: P(345, 'MPa') }, provenance: PROV(`flat slab 250 mm; SDL 1.5 kPa, live ${ll} kPa (about ${Math.round(ll * 20.885)} psf)`) });
    ids.slab = slab.id; ids.drops = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      if (dropsAt === 'interior' && (i === 0 || j === 0 || i === n || j === n)) continue;   // edge and corner columns rely on stud rails
      const cx = ox + bay * i, cy = oy + bay * j, x0 = Math.max(X0, cx - drop / 2), x1 = Math.min(X1, cx + drop / 2), y0 = Math.max(Y0, cy - drop / 2), y1 = Math.min(Y1, cy + drop / 2);
      ids.drops.push(m.create({ type: 'drop_panel', name: `DP${String.fromCharCode(65 + i)}${j + 1}`, parent: slab.id, params: { center: P([(x0 + x1) / 2, (y0 + y1) / 2], 'm'), size: P([x1 - x0, y1 - y0], 'm'), projection: P(projection, 'm') }, provenance: PROV('2.2 m square drop, 150 mm below the soffit, clipped at slab edges') }).id);
    }
    const gb = m.create({ type: 'beam', name: 'RF GB1 (continuous)', parent: fnd.id, params: { start: P([ox, oy], 'm'), end: P([ox + n * bay, oy], 'm'), width: P(0.4, 'm'), depth: P(0.7, 'm'), top_offset: P(1.0, 'm'),
      supports: P(Array.from({ length: n + 1 }, (_, k) => ({ at: k * bay, type: k === 0 ? 'pinned' : 'roller' }))), sdl: P(12, 'kN/m'), ll: P(0, 'kN/m'), fc: P(28, 'MPa'), fy: P(420, 'MPa'), fyt: P(420, 'MPa'), unit_weight: P(23.6, 'kN/m3'), cover: P(0.05, 'm'), bar_main: P('#7'), bar_stirrup: P('#3'), bar_hanger: P('#5'), segments: P(36) }, provenance: PROV('grade beam carrying a 12 kN/m wall; supports at the pile caps') });
    const sb = m.create({ type: 'beam', name: 'RF GB2 (simply supported)', parent: fnd.id, params: { start: P([ox, oy + bay], 'm'), end: P([ox, oy + 2 * bay], 'm'), width: P(0.3, 'm'), depth: P(0.6, 'm'), top_offset: P(1.0, 'm'),
      support_start: P('pinned'), support_end: P('roller'), sdl: P(8, 'kN/m'), ll: P(0, 'kN/m'), fc: P(28, 'MPa'), fy: P(420, 'MPa'), fyt: P(420, 'MPa'), unit_weight: P(23.6, 'kN/m3'), cover: P(0.05, 'm'), bar_main: P('#6'), bar_stirrup: P('#3'), bar_hanger: P('#4'), segments: P(20) }, provenance: PROV('simply supported grade beam between two caps') });
    ids.beams = [gb.id, sb.id];
  });
  app.regenerate();
  return ids;
}
