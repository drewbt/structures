// geometry.js - mesh builders for the parametric components. Pure functions: parameters in,
// triangle meshes and quantities out. Everything in metres. z is up; the building model's plan is
// the x-y plane, so a drawing traced in plan maps to x-y and levels stack along z.
//
// A mesh is {positions: Float64Array xyz, normals: Float64Array, indices: Uint32Array, volume_m3,
// bounds: {min, max}}. Positions are doubles: this is the engineering geometry and it is checked
// to 1e-9 m³ by the divergence theorem in tests/unit/geometry.test.mjs; the renderer downcasts to
// Float32 when it uploads, and that copy is never read back. Flat shading: vertices are not shared across faces so normals are per face.
// This is the ENGINEERING geometry (exact prisms); the renderer may reduce it but never changes it
// (REQUIREMENTS §8).

export function shoelaceArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; a += x1 * y2 - x2 * y1; }
  return a / 2;   // signed: positive counter-clockwise
}

/** Ear-clipping triangulation of a simple polygon (no holes). Returns index triples into pts. */
export function triangulatePolygon(pts) {
  const n = pts.length;
  if (n < 3) return [];
  const ccw = shoelaceArea(pts) > 0;
  const idx = []; for (let i = 0; i < n; i++) idx.push(i);
  if (!ccw) idx.reverse();
  const tris = [];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inTri = (p, a, b, c) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) <= 1e-12) continue;   // reflex or degenerate
      let ear = true;
      for (const j of idx) { if (j === ia || j === ib || j === ic) continue; if (inTri(pts[j], a, b, c)) { ear = false; break; } }
      if (!ear) continue;
      tris.push([ia, ib, ic]); idx.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break;   // not simple: give up with what we have (validated upstream)
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

class MeshBuilder {
  constructor() { this.pos = []; this.nrm = []; this.idx = []; this.volume = 0; }
  quad(a, b, c, d) {   // counter-clockwise seen from outside
    const n = normal(a, b, c); const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) { this.pos.push(...p); this.nrm.push(...n); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(a, b, c) {
    const n = normal(a, b, c); const base = this.pos.length / 3;
    for (const p of [a, b, c]) { this.pos.push(...p); this.nrm.push(...n); }
    this.idx.push(base, base + 1, base + 2);
  }
  finish() {
    const pos = new Float64Array(this.pos);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
    return { positions: pos, normals: new Float64Array(this.nrm), indices: new Uint32Array(this.idx), volume_m3: this.volume, bounds: { min, max } };
  }
}
function normal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1; return [n[0] / l, n[1] / l, n[2] / l];
}

/** An axis-aligned box in a local frame: origin o, unit axes ex, ey (plan) and z up; extents lx, ly, from z0 to z1. */
function boxInto(mb, o, ex, ey, lx, ly, z0, z1) {
  const P = (u, v, z) => [o[0] + ex[0] * u + ey[0] * v, o[1] + ex[1] * u + ey[1] * v, z];
  const p000 = P(0, 0, z0), p100 = P(lx, 0, z0), p110 = P(lx, ly, z0), p010 = P(0, ly, z0);
  const p001 = P(0, 0, z1), p101 = P(lx, 0, z1), p111 = P(lx, ly, z1), p011 = P(0, ly, z1);
  mb.quad(p000, p010, p110, p100);   // bottom (normal -z)
  mb.quad(p001, p101, p111, p011);   // top
  mb.quad(p000, p100, p101, p001);   // side y=0
  mb.quad(p100, p110, p111, p101);   // side x=lx
  mb.quad(p110, p010, p011, p111);   // side y=ly
  mb.quad(p010, p000, p001, p011);   // side x=0
  mb.volume += lx * ly * (z1 - z0);
}

/**
 * Wall: centreline start→end, thickness t, from z0 up height h, with rectangular openings given
 * along the centreline (offset from start, width, height, sill above z0). Openings are clamped to
 * the wall and sorted; overlapping openings are merged by their union in plan and the smaller
 * sill / larger head. The result is an exact union of prisms, so volume_m3 is exact.
 */
export function wallMesh({ start, end, thickness, height, z0 = 0, openings = [] }) {
  const dx = end[0] - start[0], dy = end[1] - start[1], L = Math.hypot(dx, dy);
  if (!(L > 0) || !(thickness > 0) || !(height > 0)) throw new Error('wall: length, thickness and height must be positive');
  const ex = [dx / L, dy / L], ey = [-ex[1], ex[0]];
  const o = [start[0] - ey[0] * thickness / 2, start[1] - ey[1] * thickness / 2];
  // intervals along the length: [a, b, sill, head] for openings, clamped
  const ops = openings.map(op => ({ a: Math.max(0, op.offset), b: Math.min(L, op.offset + op.width), sill: Math.max(0, op.sill ?? 0), head: Math.min(height, (op.sill ?? 0) + op.height) }))
    .filter(op => op.b > op.a && op.head > op.sill).sort((p, q) => p.a - q.a);
  const merged = [];
  for (const op of ops) { const last = merged[merged.length - 1]; if (last && op.a < last.b) { last.b = Math.max(last.b, op.b); last.sill = Math.min(last.sill, op.sill); last.head = Math.max(last.head, op.head); } else merged.push({ ...op }); }
  const mb = new MeshBuilder();
  let u = 0;
  const seg = (a, b, za, zb) => { if (b - a > 1e-9 && zb - za > 1e-9) boxInto(mb, [o[0] + ex[0] * a, o[1] + ex[1] * a], ex, ey, b - a, thickness, z0 + za, z0 + zb); };
  for (const op of merged) {
    seg(u, op.a, 0, height);
    seg(op.a, op.b, 0, op.sill);            // below the opening
    seg(op.a, op.b, op.head, height);       // above the opening
    u = op.b;
  }
  seg(u, L, 0, height);
  const mesh = mb.finish();
  mesh.length_m = L; mesh.area_m2 = L * height; mesh.opening_area_m2 = merged.reduce((s, op) => s + (op.b - op.a) * (op.head - op.sill), 0);
  return mesh;
}

/** Slab: a simple polygon outline in plan, top at zTop, thickness t downward. */
export function slabMesh({ outline, thickness, zTop }) {
  if (!outline || outline.length < 3) throw new Error('slab: outline needs 3 or more points');
  if (!(thickness > 0)) throw new Error('slab: thickness must be positive');
  const area = Math.abs(shoelaceArea(outline));
  if (!(area > 0)) throw new Error('slab: outline has no area');
  const pts = shoelaceArea(outline) > 0 ? outline : [...outline].reverse();   // ccw
  const tris = triangulatePolygon(pts);
  const mb = new MeshBuilder(); const z1 = zTop, z0 = zTop - thickness;
  for (const [a, b, c] of tris) {
    mb.tri([...pts[a], z1], [...pts[b], z1], [...pts[c], z1]);
    mb.tri([...pts[a], z0], [...pts[c], z0], [...pts[b], z0]);
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    mb.quad([...p, z0], [...q, z0], [...q, z1], [...p, z1]);
  }
  mb.volume = area * thickness;
  const mesh = mb.finish(); mesh.area_m2 = area; return mesh;
}

/** Column: rectangle width (along local x) by depth, rotated `rotation_deg` about its centre, from z0 up height. */
export function columnMesh({ center, width, depth, rotation_deg = 0, height, z0 = 0 }) {
  if (!(width > 0) || !(depth > 0) || !(height > 0)) throw new Error('column: width, depth and height must be positive');
  const r = rotation_deg * Math.PI / 180, ex = [Math.cos(r), Math.sin(r)], ey = [-ex[1], ex[0]];
  const o = [center[0] - ex[0] * width / 2 - ey[0] * depth / 2, center[1] - ex[1] * width / 2 - ey[1] * depth / 2];
  const mb = new MeshBuilder(); boxInto(mb, o, ex, ey, width, depth, z0, z0 + height); return mb.finish();
}

/** Merge meshes into one buffer set (for the renderer). */
export function mergeMeshes(meshes) {
  let np = 0, ni = 0; for (const m of meshes) { np += m.positions.length; ni += m.indices.length; }
  const positions = new Float64Array(np), normals = new Float64Array(np), indices = new Uint32Array(ni);
  let po = 0, io = 0;
  for (const m of meshes) { positions.set(m.positions, po); normals.set(m.normals, po); for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + po / 3; po += m.positions.length; io += m.indices.length; }
  return { positions, normals, indices };
}

/**
 * Beam: plan centreline start→end, rectangular section width × depth, top of beam at zTop.
 * Exact prism; volume = L·b·h.
 */
export function beamMesh({ start, end, width, depth, zTop }) {
  const dx = end[0] - start[0], dy = end[1] - start[1], L = Math.hypot(dx, dy);
  if (!(L > 0) || !(width > 0) || !(depth > 0)) throw new Error('beam: length, width and depth must be positive');
  const ex = [dx / L, dy / L], ey = [-ex[1], ex[0]];
  const mb = new MeshBuilder();
  boxInto(mb, [start[0] - ey[0] * width / 2, start[1] - ey[1] * width / 2], ex, ey, L, width, zTop - depth, zTop);
  const mesh = mb.finish(); mesh.length_m = L; return mesh;
}

/**
 * Reinforcing bar: a polyline `path` of 3D points and a nominal diameter. Each segment is drawn as a
 * square prism of side d·√(π)/2 (same area as the bar), so the stated volume is the bar's steel
 * volume: Σ segment length × π d²/4. Bends are drawn as sharp corners; the bend radius lives in the
 * fabrication data, not in this picture (ASSUMPTIONS A-13).
 */
export function rebarMesh({ path, diameter }) {
  if (!path || path.length < 2) throw new Error('rebar: path needs two or more points');
  if (!(diameter > 0)) throw new Error('rebar: diameter must be positive');
  const side = diameter * Math.sqrt(Math.PI) / 2, area = Math.PI * diameter * diameter / 4;
  const mb = new MeshBuilder(); let length = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...t); if (!(L > 0)) continue;
    const u = t.map(x => x / L);
    const ref = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let v = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]]; const lv = Math.hypot(...v); v = v.map(x => x / lv);
    const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const P = (s, p, q) => [a[0] + u[0] * s + v[0] * p + w[0] * q, a[1] + u[1] * s + v[1] * p + w[1] * q, a[2] + u[2] * s + v[2] * p + w[2] * q];
    const h = side / 2;
    const c = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (let k = 0; k < 4; k++) { const [p0, q0] = c[k], [p1, q1] = c[(k + 1) % 4]; mb.quad(P(0, p0, q0), P(0, p1, q1), P(L, p1, q1), P(L, p0, q0)); }
    mb.quad(P(0, -h, -h), P(0, -h, h), P(0, h, h), P(0, h, -h)); mb.quad(P(L, -h, -h), P(L, h, -h), P(L, h, h), P(L, -h, h));
    length += L;
  }
  mb.volume = length * area;
  const mesh = mb.finish(); mesh.length_m = length; mesh.mass_kg = mesh.volume_m3 * 7850; return mesh;
}

/** Vertical cylinder (pile): centre, diameter, from z0 up to z1; 24 facets. Volume stated exactly as π r² h. */
export function cylinderMesh({ center, diameter, z0, z1, facets = 24 }) {
  if (!(diameter > 0) || !(z1 > z0)) throw new Error('cylinder: diameter and height must be positive');
  const r = diameter / 2, mb = new MeshBuilder(), P = (k, z) => [center[0] + r * Math.cos(2 * Math.PI * k / facets), center[1] + r * Math.sin(2 * Math.PI * k / facets), z];
  for (let k = 0; k < facets; k++) {
    mb.quad(P(k, z0), P(k + 1, z0), P(k + 1, z1), P(k, z1));
    mb.tri([center[0], center[1], z1], P(k, z1), P(k + 1, z1)); mb.tri([center[0], center[1], z0], P(k + 1, z0), P(k, z0));
  }
  mb.volume = Math.PI * r * r * (z1 - z0);
  const mesh = mb.finish(); mesh.length_m = z1 - z0; return mesh;
}
/** Axis-aligned box by centre (plan), plan size and z range: pile caps and drop panels. */
export function boxMesh({ center, size, z0, z1 }) {
  if (!(size[0] > 0 && size[1] > 0 && z1 > z0)) throw new Error('box: sizes must be positive');
  const mb = new MeshBuilder(); boxInto(mb, [center[0] - size[0] / 2, center[1] - size[1] / 2], [1, 0], [0, 1], size[0], size[1], z0, z1); return mb.finish();
}
/** A set of separate line segments drawn as thin prisms (punching critical perimeters). */
export function segmentsMesh({ pairs, width = 0.03 }) {
  const meshes = []; for (let i = 0; i + 1 < pairs.length; i += 2) meshes.push(rebarMesh({ path: [pairs[i], pairs[i + 1]], diameter: width }));
  const m = mergeMeshes(meshes), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], m.positions[i + k]); max[k] = Math.max(max[k], m.positions[i + k]); }
  return { ...m, volume_m3: 0, bounds: { min, max } };
}
