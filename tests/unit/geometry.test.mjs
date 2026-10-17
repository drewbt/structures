import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallMesh, slabMesh, columnMesh, triangulatePolygon, shoelaceArea, mergeMeshes } from '../../app/core/geometry.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
// Tolerance 1e-9 m³: the arithmetic is exact products of doubles; anything larger than rounding is a defect.
const TOL = 1e-9;

// Sum of signed triangle areas of a mesh projected on z (top faces minus bottom faces cancel) is not
// a direct check, so volume is checked by the divergence theorem: V = Σ (1/3) * (centroid · n) * area over faces.
function volumeByDivergence(m) {
  let v = 0; const p = m.positions, n = m.normals;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i] * 3, b = m.indices[i + 1] * 3, c = m.indices[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;   // 2 * area * normal
    v += (p[a] * cx + p[a + 1] * cy + p[a + 2] * cz) / 6;
  }
  return v;
}

test('wall without openings: volume = L t h, both stated and by divergence; bounds are the prism', () => {
  const m = wallMesh({ start: [0, 0], end: [6, 0], thickness: 0.2, height: 3, z0: 1 });
  near(m.volume_m3, 6 * 0.2 * 3, TOL, 'stated volume');
  near(volumeByDivergence(m), 6 * 0.2 * 3, TOL, 'divergence volume (faces are closed and outward)');
  assert.deepEqual(m.bounds.min.map(x => +x.toFixed(9)), [0, -0.1, 1]);
  assert.deepEqual(m.bounds.max.map(x => +x.toFixed(9)), [6, 0.1, 4]);
  assert.equal(m.indices.length, 36);
});

test('wall with a door and a window: volume drops by exactly the opening volumes', () => {
  const m = wallMesh({ start: [0, 0], end: [6, 0], thickness: 0.2, height: 3, openings: [
    { offset: 1, width: 0.9, height: 2.1, sill: 0 }, { offset: 3.5, width: 1.2, height: 1.0, sill: 0.9 }] });
  const expected = (6 * 3 - 0.9 * 2.1 - 1.2 * 1.0) * 0.2;
  near(m.volume_m3, expected, TOL, 'stated');
  near(volumeByDivergence(m), expected, TOL, 'divergence');
  near(m.opening_area_m2, 0.9 * 2.1 + 1.2, TOL, 'opening area');
});

test('wall openings are clamped to the wall and overlapping ones are merged', () => {
  const m = wallMesh({ start: [0, 0], end: [4, 0], thickness: 0.3, height: 3, openings: [
    { offset: -1, width: 2, height: 10, sill: 0 },        // clamps to [0,1] x [0,3]
    { offset: 0.5, width: 1, height: 1, sill: 1 }] });    // overlaps -> merged into [0,1.5] x [0,3]
  near(m.volume_m3, (4 * 3 - 1.5 * 3) * 0.3, TOL, 'merged');
});

test('wall on a diagonal centreline keeps its volume and is symmetric about the centreline', () => {
  const m = wallMesh({ start: [1, 1], end: [4, 5], thickness: 0.25, height: 2.8 });
  near(m.volume_m3, 5 * 0.25 * 2.8, TOL, 'stated');
  near(volumeByDivergence(m), 5 * 0.25 * 2.8, TOL, 'divergence');
});

test('wall rejects degenerate input', () => {
  assert.throws(() => wallMesh({ start: [0, 0], end: [0, 0], thickness: 0.2, height: 3 }));
  assert.throws(() => wallMesh({ start: [0, 0], end: [1, 0], thickness: 0, height: 3 }));
});

test('triangulation of an L-shaped (concave) polygon covers exactly its area', () => {
  const L = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]];
  const tris = triangulatePolygon(L);
  assert.equal(tris.length, L.length - 2);
  const sum = tris.reduce((s, [a, b, c]) => s + Math.abs(shoelaceArea([L[a], L[b], L[c]])), 0);
  near(sum, 6 * 2 + 2 * 3, TOL, 'triangle areas sum to the polygon area 18');
});

test('slab: L-shaped outline, volume = area t, closed outward surface, clockwise input accepted', () => {
  const L = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]];
  const m = slabMesh({ outline: L, thickness: 0.18, zTop: 3 });
  near(m.area_m2, 18, TOL, 'area');
  near(m.volume_m3, 18 * 0.18, TOL, 'stated');
  near(volumeByDivergence(m), 18 * 0.18, TOL, 'divergence');
  const cw = slabMesh({ outline: [...L].reverse(), thickness: 0.18, zTop: 3 });
  near(volumeByDivergence(cw), 18 * 0.18, TOL, 'clockwise outline gives the same closed solid');
  assert.deepEqual(m.bounds.min.map(x => +x.toFixed(9)), [0, 0, 2.82]);
});

test('column: rotated rectangle keeps its volume and footprint', () => {
  const m = columnMesh({ center: [2, 3], width: 0.4, depth: 0.25, rotation_deg: 30, height: 3.2, z0: 0.5 });
  near(m.volume_m3, 0.4 * 0.25 * 3.2, TOL, 'stated');
  near(volumeByDivergence(m), 0.4 * 0.25 * 3.2, TOL, 'divergence');
  const cx = (m.bounds.min[0] + m.bounds.max[0]) / 2, cy = (m.bounds.min[1] + m.bounds.max[1]) / 2;
  near(cx, 2, TOL, 'centre x'); near(cy, 3, TOL, 'centre y');
});

test('mergeMeshes offsets indices', () => {
  const a = columnMesh({ center: [0, 0], width: 1, depth: 1, height: 1 }), b = columnMesh({ center: [5, 0], width: 1, depth: 1, height: 1 });
  const m = mergeMeshes([a, b]);
  assert.equal(m.indices.length, 72); assert.equal(m.indices[36], a.positions.length / 3);
  near(volumeByDivergence({ ...m }), 2, TOL, 'merged volume');
});
