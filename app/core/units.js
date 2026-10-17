// units.js - the units system. Internal storage is SI base: metres, kilograms, seconds, newtons.
//
// A parameter carries its unit explicitly (REQUIREMENTS §2 "explicit about units"). Conversion
// happens only at the edges: parsing what a person typed, formatting what a person reads. Nothing
// in the geometry or engineering functions ever sees a millimetre.

export const UNITS = {
  // length
  m: { dim: 'length', toSI: 1 }, mm: { dim: 'length', toSI: 1e-3 }, cm: { dim: 'length', toSI: 1e-2 }, ft: { dim: 'length', toSI: 0.3048 }, in: { dim: 'length', toSI: 0.0254 },
  // angle (stored in degrees for parameters people read; functions convert)
  deg: { dim: 'angle', toSI: Math.PI / 180 }, rad: { dim: 'angle', toSI: 1 },
  // area, volume
  m2: { dim: 'area', toSI: 1 }, m3: { dim: 'volume', toSI: 1 },
  // force, stress, density
  N: { dim: 'force', toSI: 1 }, kN: { dim: 'force', toSI: 1e3 }, Pa: { dim: 'stress', toSI: 1 }, MPa: { dim: 'stress', toSI: 1e6 }, 'kN/m2': { dim: 'stress', toSI: 1e3 },
  'kg/m3': { dim: 'density', toSI: 1 }, 'kN/m': { dim: 'line_load', toSI: 1e3 }, 'kN/m3': { dim: 'unit_weight', toSI: 1e3 },
  // dimensionless and identifiers
  '': { dim: 'none', toSI: 1 }, px: { dim: 'pixel', toSI: 1 }, 'm/px': { dim: 'scale', toSI: 1 }, id: { dim: 'ref', toSI: 1 },
};

/** Convert a number between two units of the same dimension; throws on a mismatch. */
export function convert(value, from, to) {
  const a = UNITS[from], b = UNITS[to];
  if (!a || !b) throw new Error(`unknown unit ${!a ? from : to}`);
  if (a.dim !== b.dim) throw new Error(`cannot convert ${from} (${a.dim}) to ${to} (${b.dim})`);
  return value * a.toSI / b.toSI;
}

/** Parse "250 mm", "0.25", "3m" into a value in `target` unit. A bare number is in `target`. */
export function parseLength(text, target = 'm') {
  const m = String(text).trim().match(/^(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*([a-zA-Z/0-9]*)$/);
  if (!m) throw new Error(`cannot read "${text}" as a length`);
  const unit = m[2] || target;
  return convert(parseFloat(m[1]), unit, target);
}

/** Format a value held in `unit` for display: lengths in mm when under 10 m, else m. */
export function formatLength(value, unit = 'm', digits = 3) {
  const m = convert(value, unit, 'm');
  if (Math.abs(m) < 10) return `${Math.round(m * 1000)} mm`;
  return `${m.toFixed(digits)} m`;
}
