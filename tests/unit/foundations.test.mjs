// foundations.test.mjs - pile caps and the load path against statics and hand calculation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pileLayout, loadTakedown, pileCapLayout, pileCapDesign, pileCapBars } from '../../app/core/foundations.js';
import * as ACI from '../../app/core/standards/aci318-19.js';

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);

test('standard pile layouts are centred on the column, at the stated spacing', () => {
  for (let n = 1; n <= 9; n++) {
    const L = pileLayout(n, 1.35); assert.ok(L.length === n || (n === 8 && L.length === 9));
    const cx = L.reduce((a, q) => a + q[0], 0) / L.length, cy = L.reduce((a, q) => a + q[1], 0) / L.length;
    assert.ok(Math.abs(cx) < 1e-12 && Math.abs(cy) < 1e-12, `n=${n} centroid ${cx},${cy}`);
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) assert.ok(Math.hypot(L[i][0] - L[j][0], L[i][1] - L[j][1]) >= 1.35 - 1e-9, `n=${n} piles ${i},${j} closer than s`);
  }
});

test('13.4.2.5 share of a pile reaction outside a section: 0, ½, 1 at −dp/2, 0, +dp/2', () => {
  assert.equal(ACI.pileShareOutside(-225, 450), 0); assert.equal(ACI.pileShareOutside(0, 450), 0.5); assert.equal(ACI.pileShareOutside(225, 450), 1); assert.equal(ACI.pileShareOutside(-1000, 450), 0);
});

function cap4({ H = 1.0, Mux = 0, Muy = 0, Pu = 3000, D = 1500, L = 600 } = {}) {
  const s = 1.35, lay = pileLayout(4, s), size = [s + 0.45 + 0.3, s + 0.45 + 0.3];
  const cap = { id: 'K1', name: 'K1', column: 'C', center: [10, 20], size, H, zTop: -0.5, fc: 28, fy: 420, cover: 0.075, embed: 0.075, bar: '#7', unit_weight: 23.6, pile_D: 0.45, pile_length: 12, Qallow: 900, spacing: s, edge: 0.15,
    piles: lay.map((q, i) => ({ id: `P${i}`, at: [10 + q[0], 20 + q[1]], D: 0.45, length: 12, fc: 28, fy: 420 })) };
  return { cap, col: { b: 0.4, h: 0.4, fy: 420, dowel_db: 25.4 }, load: { D, L, Pu, Mux, Muy } };
}

test('rigid cap: Σ Pi = Pu and Σ Pi·xi = Mux, Σ Pi·yi = Muy (statics)', () => {
  const { cap, col, load } = cap4({ Mux: 180, Muy: -90 }); const d = pileCapDesign.run({ cap, col, load });
  const P = d.reactions.Pu; assert.ok(rel(P.reduce((a, v) => a + v, 0), load.Pu) < 1e-12);
  const mx = cap.piles.reduce((a, p, i) => a + P[i] * (p.at[0] - 10), 0), my = cap.piles.reduce((a, p, i) => a + P[i] * (p.at[1] - 20), 0);
  assert.ok(rel(mx, 180) < 1e-12 && rel(my, -90) < 1e-12, `${mx}, ${my}`);
});

test('4-pile cap, piles wholly outside the face: Mu at the face = 2 (Pu/4)(s/2 − c/2), by hand', () => {
  const { cap, col, load } = cap4(); const d = pileCapDesign.run({ cap, col, load });
  // pile centre 675 mm from the column centre, face at 200 mm: 475 mm out ≥ dp/2 = 225 → full share
  const Mu = 2 * (3000 / 4) * (0.675 - 0.2); assert.ok(rel(d.faces.x.Mu_kNm, Mu) < 1e-12, `${d.faces.x.Mu_kNm} vs ${Mu}`);
  assert.ok(d.faces.x.phiMn_kNm >= Mu); assert.ok(d.faces.x.As >= 0.0018 * cap.size[1] * 1000 * cap.H * 1000 - 1e-9);
  // one-way shear at d = 1000 − 75 − 75 − 22.2 = 827.8 mm from the face: pile centre 475 mm from the face, so 352.8 mm inside → share 0 (≥ dp/2 inside)
  assert.equal(d.faces.x.Vu_kN, 0);
  assert.ok(d.checks.some(c => c.name.startsWith('deep cap')), 'piles within d of the face are flagged for strut-and-tie');
});

test('pile strength: φ 0.85 fc Ag with φ = 0.55 (Table 13.4.2.1)', () => {
  const { cap, col, load } = cap4(); const d = pileCapDesign.run({ cap, col, load });
  assert.ok(rel(d.piles[0].phiPn_kN, 0.55 * 0.85 * 28 * Math.PI * 450 ** 2 / 4 / 1000) < 1e-12);
});

test('layout: the pile count grows with load until the corner pile is within the allowable', () => {
  const cap = cap4().cap; cap.piles = [];
  const a = pileCapLayout.run({ cap, D: 500, L: 200 }), b = pileCapLayout.run({ cap, D: 2500, L: 1200 });
  assert.equal(a.n, 1); assert.ok(b.n >= 4 && b.maxService <= 900, `${b.n} piles, max ${b.maxService}`);
});

test('load takedown: Σ column loads + caps = everything applied (slab, beams, columns, stated, caps)', () => {
  const columns = [0, 1].map(i => ({ id: `C${i}`, name: `C${i}`, center: [6 * i, 0], b: 0.4, h: 0.4, height: 3.5, unit_weight: 23.6, P_D: 10 * i, P_L: 5 }));
  const slabReactions = [{ column: 'C0', D_kN: 300, L_kN: 120, Mx_kNm: 40, My_kNm: 10 }, { column: 'C1', D_kN: 280, L_kN: 110, Mx_kNm: 0, My_kNm: 0 }];
  const beamReactions = [{ beam: 'GB', at: [0, 0], D: 30, L: 12 }, { beam: 'GB', at: [3, 0], D: 50, L: 20 }];   // the second lands on cap K0, not on a column
  const caps = [{ id: 'K0', column: 'C0', center: [0, 0], size: [7, 2], H: 0.9, unit_weight: 23.6 }, { id: 'K1', column: 'C1', center: [6, 0], size: [2, 2], H: 0.9, unit_weight: 23.6 }];
  const r = loadTakedown.run({ columns, slabReactions, beamReactions, caps });
  // a grade beam at the cap (below the column base) lands on the cap even under the column footprint
  const g = loadTakedown.run({ columns: columns.map(c => ({ ...c, z0: 0 })), slabReactions, beamReactions: [{ beam: 'GB', at: [0, 0], z: 0, D: 30, L: 12 }], caps });
  assert.ok(rel(g.columns[0].D, 300 + 23.6 * 0.4 * 0.4 * 3.5) < 1e-12 && rel(g.caps[0].D - g.columns[0].D - g.caps[0].self, 30) < 1e-12, 'grade beam on the cap');
  const sumCaps = r.caps.reduce((a, c) => a + c.D + c.L, 0);
  assert.ok(rel(sumCaps, r.total) < 1e-12, `${sumCaps} vs ${r.total}`);
  const c0 = r.columns[0]; assert.ok(rel(c0.D, 300 + 23.6 * 0.4 * 0.4 * 3.5 + 30) < 1e-12 && rel(c0.Pu, 1.2 * c0.D + 1.6 * c0.L) < 1e-12);
});

test('cap bars: both mats hooked up at the edges, sitting on the pile heads; one cage and spiral per pile', () => {
  const { cap, col, load } = cap4(); const d = pileCapDesign.run({ cap, col, load }); const out = pileCapBars.run({ cap, design: d });
  const bx = out.bars.filter(b => b.mark === 'BX'); assert.equal(bx.length, d.faces.x.n);
  assert.ok(bx.every(b => b.path.length === 4 && b.path[0][2] > b.path[1][2]), 'hooks turn up');
  assert.ok(Math.abs(bx[0].path[1][2] - (-1.5 + 0.075 + 0.0222 / 2)) < 1e-4, 'bottom mat on the pile heads');
  assert.equal(out.bars.filter(b => b.mark === 'PS').length, 4); assert.ok(out.bars.filter(b => b.mark === 'PL').length >= 24);
});
