// archgeom.js - architectural geometry over the engineered structure: curtain walls with vertical fins and
// spandrel bands, louvred mechanical floors, a glass crown lantern, a spire, and illustrative city context.
// None of it is structure: no concrete volume is reported. Each mesh carries per-vertex materials (MAT) that the
// viewer's render mode shades; the engineering view draws them as plain colours.
import { MeshBuilder, boxInto, MAT } from './geometry.js';

/**
 * A storey of curtain wall around a counter-clockwise plan outline, from z0 up h. `kind`: typical (vision glass
 * over a spandrel band), mechanical (louvres), lobby (full-height glass), crown (glowing lantern glass).
 * Fins every `fin` metres, `finDepth` proud of the glass.
 */
export function curtainWallMesh({ outline, z0, h, kind = 'typical', fin = 1.5, finDepth = 0.45, finWidth = 0.08, offset = 0.12, band = 0.7 }) {
  if (!outline || outline.length < 3 || !(h > 0)) throw new Error('curtain wall: outline and height needed');
  const mb = new MeshBuilder(); let glass = 0;
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 1e-6) continue;
    const t = [dx / L, dy / L], o = [t[1], -t[0]];   // outward for a counter-clockwise outline
    const P = (s, off, z) => [a[0] + t[0] * s + o[0] * off, a[1] + t[1] * s + o[1] * off, z];
    const pane = (zA, zB, mat) => { mb.mat = mat; mb.quad(P(0, offset, zA), P(L, offset, zA), P(L, offset, zB), P(0, offset, zB)); };
    if (kind === 'typical') { pane(z0, z0 + band, MAT.metal); pane(z0 + band, z0 + h, MAT.glass); }
    else if (kind === 'mechanical') pane(z0, z0 + h, MAT.louvre);
    else if (kind === 'crown') pane(z0, z0 + h, MAT.glow);
    else pane(z0, z0 + h, MAT.glass);
    glass += L * h;
    // fins: corner fins and every `fin` metres between
    mb.mat = MAT.metal;
    const count = Math.max(1, Math.round(L / fin));
    for (let k = 0; k <= count; k++) {
      const s = Math.min(L - finWidth / 2, Math.max(finWidth / 2, k * L / count)), c = P(s, offset, 0);
      boxInto(mb, [c[0] - t[0] * finWidth / 2, c[1] - t[1] * finWidth / 2], t, o, finWidth, finDepth, z0, z0 + h);
    }
  }
  mb.volume = 0;
  const m = mb.finish(); delete m.volume_m3; m.glass_m2 = glass; return m;
}

/** A tapering octagonal spire from z0 up `height`, base radius r0, with a glowing tip. */
export function spireMesh({ center, z0, height, r0 = 2.5, sides = 8 }) {
  const mb = new MeshBuilder(), [cx, cy] = center, tipZ = z0 + height, glowZ = z0 + height * 0.85;
  const ring = (r, z) => Array.from({ length: sides }, (_, k) => [cx + r * Math.cos(2 * Math.PI * k / sides), cy + r * Math.sin(2 * Math.PI * k / sides), z]);
  const A = ring(r0, z0), B = ring(r0 * 0.12, glowZ);
  mb.mat = MAT.metal;
  for (let k = 0; k < sides; k++) mb.quad(A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]);
  mb.mat = MAT.glow;
  for (let k = 0; k < sides; k++) mb.tri(B[k], B[(k + 1) % sides], [cx, cy, tipZ]);
  const m = mb.finish(); delete m.volume_m3; return m;
}

/** City blocks: boxes {x0, y0, x1, y1, h} with glazed sides and dark roofs. */
export function cityMesh({ blocks }) {
  const mb = new MeshBuilder();
  for (const b of blocks) {
    const lx = b.x1 - b.x0, ly = b.y1 - b.y0; if (!(lx > 0 && ly > 0 && b.h > 0)) continue;
    mb.mat = MAT.cityglass; boxInto(mb, [b.x0, b.y0], [1, 0], [0, 1], lx, ly, -0.02, b.h);
  }
  const m = mb.finish(); delete m.volume_m3; return m;
}

/** Trees: a low-poly crown on a short trunk, [x, y, size]. */
export function treesMesh({ trees }) {
  const mb = new MeshBuilder();
  for (const [x, y, s] of trees) {
    const r = 3 * s, z = 4 * s, top = [x, y, z + 2.2 * r], bot = [x, y, z - 0.4 * r];
    const ring = Array.from({ length: 6 }, (_, k) => [x + r * Math.cos(k * Math.PI / 3 + s), y + r * Math.sin(k * Math.PI / 3 + s), z + 0.6 * r]);
    for (let k = 0; k < 6; k++) { mb.tri(ring[k], ring[(k + 1) % 6], top); mb.tri(ring[(k + 1) % 6], ring[k], bot); }
  }
  const m = mb.finish(); delete m.volume_m3; return m;
}

/** A deterministic pseudo-random sequence (mulberry32), so the illustrative context is the same on every run. */
export function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * Illustrative Manhattan context south of Central Park South: avenues about 250 m apart, streets about 80 m,
 * lots 20-45 m, heights mostly 20-150 m with a few towers. NOT a survey; for scale and setting only.
 */
export function manhattanBlocks({ exclude, south = -520, north, west = -520, east = 520, seed = 59 }) {
  const rnd = seeded(seed), out = [], avenue = 250, street = 80, aw = 30, sw = 18;
  for (let y = north - sw; y - (street - sw) > south; y -= street) {
    const yb1 = y, yb0 = y - (street - sw);
    for (let x = west; x < east; x += avenue) {
      const xb0 = x + aw / 2, xb1 = x + avenue - aw / 2;
      for (let lx = xb0; lx < xb1 - 8;) {
        const w = 20 + rnd() * 25, x1 = Math.min(xb1, lx + w), near = Math.max(0, 1 - (north - y) / 300);
        const tall = rnd() < 0.04 + 0.05 * near, h = tall ? 110 + rnd() * 90 : 18 + rnd() * (45 + 45 * near);   // the setting stays low so the tower reads
        for (const [a, b] of [[yb0, (yb0 + yb1) / 2 - 1], [(yb0 + yb1) / 2 + 1, yb1]]) {
          const blk = { x0: lx + 1, y0: a, x1: x1 - 1, y1: b, h: Math.round(h * (0.75 + 0.5 * rnd())) };
          if (!(blk.x1 < exclude.x0 || blk.x0 > exclude.x1 || blk.y1 < exclude.y0 || blk.y0 > exclude.y1)) continue;
          out.push(blk);
        }
        lx = x1;
      }
    }
  }
  return out;
}

/** Trees scattered over a rectangle (the park), deterministic. */
export function scatterTrees({ x0, y0, x1, y1, n, seed = 7 }) {
  const rnd = seeded(seed); return Array.from({ length: n }, () => [Math.round((x0 + rnd() * (x1 - x0)) * 10) / 10, Math.round((y0 + rnd() * (y1 - y0)) * 10) / 10, Math.round((0.7 + rnd() * 0.8) * 100) / 100]);
}
