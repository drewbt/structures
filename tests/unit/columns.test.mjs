// columns.test.mjs - the column interaction and detailing against closed forms and a hand-worked balanced point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perimeterBars, interaction, interactionPoint, phiMnAt, columnDesign, columnBars } from '../../app/core/columns.js';
import * as ACI from '../../app/core/standards/aci318-19.js';

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
const A8 = ACI.BARS['#8'].area, toBar = 40 + 9.525 + 12.7;   // cover + #3 tie + half a #8

test('P0 = 0.85 fc (Ag − Ast) + fy Ast; φPn,max = 0.80 × 0.65 × P0 (tied); pure tension = −Ast fy', () => {
  const bars = perimeterBars(400, 400, toBar, 3, 3), cv = interaction({ B: 400, D: 400, ts: bars.map(q => q[1]), Abar: A8, fc: 28, fy: 420 });
  assert.equal(bars.length, 8);
  const Ast = 8 * A8; assert.ok(rel(cv.P0, 0.85 * 28 * (160000 - Ast) + 420 * Ast) < 1e-12);
  assert.ok(rel(cv.phiPnMax, 0.8 * 0.65 * cv.P0) < 1e-12);
  assert.ok(rel(cv.points[cv.points.length - 1].Pn, -Ast * 420) < 1e-12);
  assert.ok(rel(cv.points[0].Pn, cv.P0) < 1e-12, 'uniform strain 0.003 (c = ∞) gives P0: every bar yields in compression');
});

// Balanced point worked layer by layer: 400 × 400, 3 #8 top, 2 at mid-depth, 3 bottom, fc 28, fy 420.
// dt = 200 + 137.775 = 337.775; cb = 0.003 dt/(0.003 + 0.0021) = 198.691; a = 0.85 cb = 168.888.
// C = 0.85·28·168.888·400 = 1,607,815 N. Top layer (depth 62.225): εs = 0.003(198.691 − 62.225)/198.691 = 0.0020605,
// fs = 412.10 MPa, net of displaced concrete 412.10 − 23.80 = 388.30 → 3·509.676·388.30 = 593,723 N.
// Mid layer (depth 200 > a): εs = −0.0000198 → fs = −3.957 → −4,034 N. Bottom: −420·3·509.676 = −642,192 N.
// Pn = 1,555,312 N. Mn = C(200 − 84.444) + 593,723·137.775 + 642,192·137.775 = 185,794,… + 81,800,… + 88,478,… ≈ 356.07 kN·m.
test('balanced point by hand: c_b, Pn ≈ 1555.3 kN, Mn ≈ 356.1 kN·m; εt = εy there', () => {
  const bars = perimeterBars(400, 400, toBar, 3, 3), ts = bars.map(q => q[1]);
  const cb = 0.003 * (200 + 137.775) / (0.003 + 420 / 200000); assert.ok(Math.abs(cb - 198.691) < 1e-3);
  const q = interactionPoint({ B: 400, D: 400, ts, Abar: A8, fc: 28, fy: 420, c: cb });
  assert.ok(Math.abs(q.Pn / 1000 - 1555.3) < 0.5, `Pn ${q.Pn / 1000}`); assert.ok(Math.abs(q.Mn / 1e6 - 356.07) < 0.2, `Mn ${q.Mn / 1e6}`);
  assert.ok(Math.abs(q.epsT - 420 / 200000) < 1e-12 && q.phi === 0.65, 'compression-controlled limit at the balanced point');
});

test('phiMnAt interpolates the curve; zero above φPn,max', () => {
  const bars = perimeterBars(400, 400, toBar, 3, 3), cv = interaction({ B: 400, D: 400, ts: bars.map(q => q[1]), Abar: A8, fc: 28, fy: 420 });
  assert.equal(phiMnAt(cv, cv.phiPnMax * 1.01), 0); assert.ok(phiMnAt(cv, 0) > 150e6 && phiMnAt(cv, 1000e3) > phiMnAt(cv, 0), 'moment capacity rises with axial load below balance');
});

const C = { id: 'C', name: 'C1', center: [0, 0], b: 0.4, h: 0.4, rotation: 0, z0: 0, height: 3.5, fc: 28, fy: 420, cover: 0.04, bar_main: '#8', k: 1, slab_depth: 0.25, continues_above: false };
test('design: utilisation ≤ 1 with ρ in [1 %, 8 %]; slender column magnified; ties #3 at min(16db, 48dt, b)', () => {
  const d = columnDesign.run({ c: C, Pu_kN: 1800, Mux_kNm: 60, Muy_kNm: 30 });
  assert.ok(d.checks.every(r => r.util <= 1 || r.name.startsWith('slenderness')), JSON.stringify(d.checks.filter(r => r.util > 1).map(r => r.name)));
  assert.ok(d.layout.rho >= 0.01 && d.layout.rho <= 0.08);
  assert.ok(d.slender.x.slenderness > d.slender.limit && d.slender.x.delta > 1, 'kℓu/r = 3250/120 = 27.1 > 22: magnified');
  assert.ok(rel(d.slender.x.slenderness, 3250 / 120) < 1e-12);
  assert.equal(d.ties.bar, '#3'); assert.equal(d.ties.s, Math.floor(Math.min(16 * 25.4, 48 * 9.525, 400) / 25) * 25);
  // minimum moment: with no applied moment the design moment is δ Pu (15 + 0.03 h)
  const z = columnDesign.run({ c: C, Pu_kN: 1800 }); assert.ok(rel(z.Mux_kNm, 1800e3 * (15 + 12) * z.slender.x.delta / 1e6) < 1e-12);
});

test('bars: one longitudinal bar per layout position hooked into the slab, dowels into the base, ties up the height, cross-ties on wide faces', () => {
  const d = columnDesign.run({ c: C, Pu_kN: 1800, Mux_kNm: 60, Muy_kNm: 30 });
  const out = columnBars.run({ c: C, design: d, base: { zBottomMat: -1.4 } });
  assert.equal(out.bars.filter(b => b.mark === 'L').length, d.layout.n); assert.equal(out.bars.filter(b => b.mark === 'D').length, d.layout.n);
  assert.ok(out.bars.filter(b => b.mark === 'L').every(b => b.path.length === 3), 'hooked at the top');
  const ties = out.bars.filter(b => b.mark === 'T'); assert.equal(ties.length, Math.floor((3.5 - 0.05 - d.ties.s / 2000) / (d.ties.s / 1000)) + 1);
  const wide = columnDesign.run({ c: { ...C, b: 0.8, h: 0.8 }, Pu_kN: 6000, Mux_kNm: 100 });
  const wout = columnBars.run({ c: { ...C, b: 0.8, h: 0.8 }, design: wide });
  assert.ok(wide.layout.nx >= 4 && wout.bars.some(b => b.mark === 'X'), `${wide.layout.nx} bars a face: middle bars > 150 mm clear from a corner need cross-ties`);
});
