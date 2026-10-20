// lowrise.js - a beachfront boutique residence: the scheme the site search (tools/search-parcels.mjs) found best on
// the 1.93-acre oceanfront parcel listed in Dorado, Puerto Rico: 4 storeys, 20 residences, about 0.9 FAR. A CONCEPT
// STUDY on an ILLUSTRATIVE lot of the listed size: the parcel's real boundary, zoning capacity (R-I) and
// surroundings are not surveyed; neighbours, palms and the beach are illustrative. Not an offering.
//
// Form: a long bar parallel to the beach, five through-residences per floor between party walls, every residence
// facing the sea. Floors step back towards the ocean so each has a deep terrace under the slab above, which also
// shades the glass. The ground floor stands on a 0.6 m plinth (storm surge freeboard, assumed); a pool deck and
// garden lie between the building and the beach.

const P = (v, unit = '') => ({ value: v, unit });
const PROV = note => ({ source: 'dorado concept study (design, synthetic)', trace: '', method: 'assumed', note });
const r2 = v => Math.round(v * 100) / 100;

export const LOWRISE_DEFAULTS = {
  lot: { x0: -32, x1: 32, y0: -110, y1: 12 },   // 64 × 122 m = 7,808 m² = 1.93 acres; the sea to the north (+y)
  floors: 4, units: 5, plinth: 0.6, groundHeight: 4.2, storey: 3.8,
  width: 56, landFace: -40, oceanGlass: -6, stepBack: 2.5, terrace: 3.5, bulge: 2.0,
  core: { w: 4.2, d: 6.0, xs: [-11.2, 11.2] }, column: 0.5, slab: 0.45, fc: 40,   // 450 mm slab edges: the white horizontal lines of the facade
  beach: 12, sea: 62,
  seed: 21,
};

/** The ocean edge of a slab or glass line: a shallow arc across the width, `y` at the ends, `y + bulge` at the centre. */
function arcEdge(halfW, y, bulge, n = 12) {
  return Array.from({ length: n + 1 }, (_, i) => { const x = -halfW + 2 * halfW * i / n; return [r2(x), r2(y + bulge * (1 - (x / halfW) ** 2))]; });
}
/** A storey's outline: straight land face, arched ocean face; counter-clockwise. */
export function storeyOutline(o, yOcean, bulge = o.bulge) {
  const h = o.width / 2, arc = arcEdge(h, yOcean, bulge);
  return [[-h, o.landFace], [h, o.landFace], ...arc.reverse()];
}

function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createBeachResidences(app, opts = {}) {
  const o = { ...LOWRISE_DEFAULTS, ...opts }, m = app.model, rnd = seeded(o.seed), L = o.lot, h = o.width / 2;
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  m.batch('dorado concept study', () => {
    // ---- landscape and illustrative surroundings
    m.create({ type: 'context', name: 'Atlantic Ocean', params: { kind: P('ocean'), outline: P(rect(-30000, o.sea, 30000, 30000), 'm') }, provenance: PROV('the sea north of the Dorado coast (illustrative)') });
    m.create({ type: 'context', name: 'Beach', params: { kind: P('sand'), outline: P(rect(-3000, L.y1, 3000, o.sea + 6), 'm') }, provenance: PROV('the beach, about 50 m deep (illustrative)') });
    m.create({ type: 'context', name: 'Coastal ground', params: { kind: P('lawn'), outline: P(rect(-3000, -3000, 3000, L.y1), 'm') }, provenance: PROV('gardens and golf land behind the beach (illustrative)') });
    m.create({ type: 'context', name: 'Access road', params: { kind: P('road'), outline: P(rect(-3000, L.y0 - 12, 3000, L.y0 - 4), 'm') }, provenance: PROV('the access road south of the lot (illustrative)') });
    m.create({ type: 'context', name: 'Pool deck', params: { kind: P('deck'), outline: P(rect(-24, -3, 24, 9), 'm') }, provenance: PROV('stone pool deck between the building and the beach') });
    m.create({ type: 'context', name: 'Pool', params: { kind: P('pool'), outline: P(rect(-16, 0, 16, 6.5), 'm') }, provenance: PROV('32 m infinity-edge pool facing the sea') });
    m.create({ type: 'context', name: 'Entry court', params: { kind: P('deck'), outline: P(rect(-14, L.y0 + 4, 14, o.landFace - 6), 'm') }, provenance: PROV('arrival court and parking under palms') });
    const palms = [];
    for (let x = -30; x <= 30; x += 5 + rnd() * 2) palms.push([r2(x), r2(10 + rnd() * 4), r2(8 + rnd() * 5), r2(rnd())]);              // along the beach edge
    for (const x of [-30, -27, 27, 30]) for (let y = o.landFace; y < -4; y += 8 + rnd() * 3) palms.push([r2(x + rnd()), r2(y), r2(7 + rnd() * 4), r2(rnd())]);   // side gardens
    for (let y = L.y0 + 8; y < o.landFace - 6; y += 9) for (const x of [-18, 18]) palms.push([x, r2(y), r2(6 + rnd() * 3), r2(rnd())]);   // the drive
    for (let x = -600; x <= 600; x += 7 + rnd() * 12) if (Math.abs(x) > 40) palms.push([r2(x), r2(8 + rnd() * 10), r2(7 + rnd() * 6), r2(rnd())]);   // the coast either side
    m.create({ type: 'context', name: 'Palms (illustrative)', params: { kind: P('palms'), palms: P(palms, 'm') }, provenance: PROV(`${palms.length} coconut palms, illustrative`) });
    const blocks = [];
    for (const side of [-1, 1]) for (let k = 0; k < 6; k++) { const x0 = side * (60 + k * 90 + rnd() * 20), w = 30 + rnd() * 30, d = 20 + rnd() * 25, y1 = -10 - rnd() * 25; blocks.push({ x0: Math.min(x0, x0 + side * w), x1: Math.max(x0, x0 + side * w), y0: r2(y1 - d), y1: r2(y1), h: r2(7 + rnd() * 9) }); }
    m.create({ type: 'context', name: 'Neighbouring villas (illustrative)', params: { kind: P('city'), blocks: P(blocks, 'm') }, provenance: PROV('low villas and residences along the coast, illustrative massing, not a survey') });

    // ---- the building
    const levels = []; let z = o.plinth;
    for (let k = 0; k < o.floors; k++) { const ht = k === 0 ? o.groundHeight : o.storey; levels.push({ k: k + 1, name: `L${k + 1}`, z, h: ht }); z += ht; }
    const roofZ = z;
    for (const lv of levels) {
      const k = lv.k - 1, glassY = o.oceanGlass - o.stepBack * k, slabY = glassY + o.terrace;
      const lvl = m.create({ type: 'level', name: `${lv.name} Residences`, params: { elevation: P(r2(lv.z), 'm'), height: P(lv.h, 'm'), floor: P(lv.k), kind: P('typical') }, provenance: PROV(`${o.units} through-residences, ${lv.h} m storey`) });
      m.create({ type: 'slab', name: `${lv.name} slab`, parent: lvl.id, params: { outline: P(storeyOutline(o, slabY), 'm'), thickness: P(o.slab, 'm'), offset: P(0, 'm'), fc: P(o.fc, 'MPa'), sdl: P(2.0, 'kN/m2'), ll: P(2.0, 'kN/m2') }, provenance: PROV(`floor with a ${o.terrace} m terrace to the sea, arched ocean edge`) });
      m.create({ type: 'curtain_wall', name: `${lv.name} glass`, parent: lvl.id, params: { outline: P(storeyOutline(o, glassY, o.bulge * 0.9).map(([x, y]) => [x * 0.985, y]), 'm'), kind: P('lobby'), weight: P(0.8, 'kPa'), fin_spacing: P(2.8, 'm'), fin_depth: P(0.25, 'm') }, provenance: PROV('floor-to-ceiling impact-rated glass, slim fins') });
      m.create({ type: 'curtain_wall', name: `${lv.name} terrace balustrade`, parent: lvl.id, params: { outline: P([...arcEdge(h, slabY, o.bulge)].reverse().concat(arcEdge(h, glassY + 0.4, o.bulge)).reverse(), 'm'), kind: P('balustrade'), height: P(1.1, 'm'), weight: P(0.4, 'kPa') }, provenance: PROV('1.1 m glass balustrade at the terrace edge') });
      const lw = m.create({ type: 'wall', name: `${lv.name} road facade`, parent: lvl.id, params: { start: P([h - 0.2, o.landFace - 0.35], 'm'), end: P([-h + 0.2, o.landFace - 0.35], 'm'), thickness: P(0.3, 'm'), fc: P(o.fc, 'MPa'), pier: P('facade') }, provenance: PROV('rendered masonry facade to the road, deep-set windows (privacy and hurricane resistance)') });
      for (let u = 0; u < o.units; u++) for (const f of [0.22, 0.62]) { const off = r2(o.width * (u + f) / o.units - 0.2); if (o.core.xs.some(cx => Math.abs((h - 0.2 - off) - cx) < 3.2)) continue; m.create({ type: 'opening', name: `${lv.name} window ${u + 1}${f < 0.5 ? 'a' : 'b'}`, parent: lvl.id, params: { host: P(lw.id), offset: P(off, 'm'), width: P(2.4, 'm'), height: P(lv.h - 1.4, 'm'), sill: P(0.5, 'm') }, provenance: PROV('window') }); }
      for (let u = 1; u < o.units; u++) { const x = r2(-h + o.width * u / o.units); m.create({ type: 'wall', name: `${lv.name} party wall ${u}`, parent: lvl.id, params: { start: P([x, o.landFace], 'm'), end: P([x, r2(glassY + o.bulge * (1 - (x / h) ** 2))], 'm'), thickness: P(0.25, 'm'), fc: P(o.fc, 'MPa'), pier: P('party') }, provenance: PROV('concrete party wall between residences (also the shear wall across the bar)') }); }
      for (const cx of o.core.xs) { const x0 = cx - o.core.w / 2, x1 = cx + o.core.w / 2, y0 = o.landFace, y1 = o.landFace + o.core.d;
        for (const [a, b] of [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]]) m.create({ type: 'wall', name: `${lv.name} core ${cx < 0 ? 'west' : 'east'}`, parent: lvl.id, params: { start: P(a, 'm'), end: P(b, 'm'), thickness: P(0.25, 'm'), fc: P(o.fc, 'MPa'), pier: P('core') }, provenance: PROV('lift and stair core (two private lifts serve the residences)') }); }
      for (let i = 0; i <= o.units * 2; i++) { const x = r2(-h + 0.4 + (o.width - 0.8) * i / (o.units * 2)); m.create({ type: 'column', name: `${lv.name} column ${i + 1}`, parent: lvl.id, params: { center: P([x, r2(glassY - 0.6 + o.bulge * (1 - (x / h) ** 2))], 'm'), width: P(o.column, 'm'), depth: P(o.column, 'm'), rotation: P(0, 'deg'), fc: P(o.fc, 'MPa'), fy: P(420, 'MPa') }, provenance: PROV('column line behind the ocean glass') }); }
    }
    const roof = m.create({ type: 'level', name: 'Roof terrace', params: { elevation: P(r2(roofZ), 'm'), height: P(3.0, 'm'), floor: P(o.floors + 1), kind: P('roof') }, provenance: PROV('roof garden and private terraces') });
    const topGlass = o.oceanGlass - o.stepBack * (o.floors - 1);
    m.create({ type: 'slab', name: 'Roof slab', parent: roof.id, params: { outline: P(storeyOutline(o, topGlass + o.terrace + 0.5), 'm'), thickness: P(0.35, 'm'), offset: P(0, 'm'), fc: P(o.fc, 'MPa'), sdl: P(3.0, 'kN/m2'), ll: P(3.0, 'kN/m2') }, provenance: PROV('roof slab, deep eave over the top terraces') });
    m.create({ type: 'curtain_wall', name: 'Roof balustrade', parent: roof.id, params: { outline: P(storeyOutline(o, topGlass + o.terrace + 0.3).map(([x, y]) => [x * 0.99, y]), 'm'), kind: P('balustrade'), height: P(1.1, 'm'), weight: P(0.4, 'kPa') }, provenance: PROV('roof terrace balustrade') });
  });
  return app.regenerate();
}
