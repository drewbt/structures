// detail.js - shared detailing geometry: bar paths with standard hooks, closed ties, helices, and the
// bar record every element's bar generator returns. Pure; metres in, metres out. A bar record is
// {name, shape, designation, diameter (m), path [[x,y,z]…], mark, ...extras}; the page turns each into
// a `rebar` element (DECISIONS D-13).
import * as ACI from './standards/aci318-19.js';

export const bar = id => { const b = ACI.BARS[id]; if (!b) throw new Error(`unknown bar ${id}`); return b; };

/** Straight bar from p to q with an optional standard 90° hook at either end, bent towards `hookDir` (unit vector). */
export function hookedBar(p, q, db_m, { hookStart = null, hookEnd = null } = {}) {
  const h = ACI.hook90(db_m * 1000), ext = (h.ext + h.bend / 2 + db_m * 1000) / 1000;   // straight tail plus the bend's reach, to the tail's end
  const path = [];
  if (hookStart) path.push([p[0] + hookStart[0] * ext, p[1] + hookStart[1] * ext, p[2] + hookStart[2] * ext]);
  path.push(p, q);
  if (hookEnd) path.push([q[0] + hookEnd[0] * ext, q[1] + hookEnd[1] * ext, q[2] + hookEnd[2] * ext]);
  return path;
}
/** Closed rectangular tie/stirrup through four corners (a closed polyline). */
export const closedLoop = corners => [...corners, corners[0]];
/** Helix (spiral) of radius r, pitch, from z0 to z1 about (cx, cy), as a polyline with 16 points a turn. */
export function helix(cx, cy, r, z0, z1, pitch) {
  const turns = (z1 - z0) / pitch, n = Math.max(2, Math.ceil(turns * 16)), path = [];
  for (let i = 0; i <= n; i++) { const t = i / n, a = 2 * Math.PI * turns * t; path.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z0 + (z1 - z0) * t]); }
  return path;
}
/** Even positions of n bars between a and b inclusive. */
export const spread = (a, b, n) => (n === 1 ? [(a + b) / 2] : Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1)));
/** A frame along a horizontal axis start→end: W(u, v, z) gives world coordinates. */
export function axisFrame(start, end) {
  const L = Math.hypot(end[0] - start[0], end[1] - start[1]), ex = [(end[0] - start[0]) / L, (end[1] - start[1]) / L], ey = [-ex[1], ex[0]];
  return { L, ex, ey, W: (u, v, z) => [start[0] + ex[0] * u + ey[0] * v, start[1] + ex[1] * u + ey[1] * v, z] };
}
/** Round a path to 1 µm so stored values are short and stable. */
export const roundPath = path => path.map(q => q.map(v => Math.round(v * 1e6) / 1e6));
