"""site-from-osm.py - the Park Lane site and its real surroundings from an OpenStreetMap extract.

    pip install osmium
    python3 tools/site-from-osm.py manhattan.osm.pbf app/data/site-park-lane.json

Input: the Manhattan extract in github.com/fogleman/Manhattan (osm/manhattan.osm.pbf, 2015-12-30), whose
buildings carry the footprints and roof heights of the NYC building import. Output, in the site's street-grid
frame (x along Central Park South towards Fifth Avenue, y uptown into the park, metres, origin at the centroid of
the Park Lane Hotel footprint): every building within RADIUS with its height (or an estimate, flagged), the site
footprint, the park edge, and the towers completed after the extract, added at their reported addresses with
their published heights (positions approximate, flagged). Data (c) OpenStreetMap contributors, ODbL 1.0.
A one-off data tool: the app reads only the JSON it writes.
"""
import sys, json, math, osmium
SRC, OUT = sys.argv[1], sys.argv[2]
RADIUS, GRID_DEG = 650.0, 61.1677          # grid angle measured from the Central Park South frontages in this extract
LAT0, LON0 = 40.7650, -73.9760
kx, ky = 111320 * math.cos(math.radians(LAT0)), 110540
r = math.radians(GRID_DEG); N = (math.cos(r), math.sin(r)); E = (math.sin(r), -math.cos(r))
def raw(lon, lat): return ((lon - LON0) * kx, (lat - LAT0) * ky)
def num(v):
    if v is None: return None
    v = v.strip().lower().replace(',', '.').split(';')[0]
    try:
        if "'" in v or 'ft' in v: return float(v.replace("'", '').replace('ft', '')) * 0.3048
        return float(v.replace('m', ''))
    except ValueError: return None
class H(osmium.SimpleHandler):
    def __init__(self): super().__init__(); self.b = []
    def area(self, a):
        t = {k.k: k.v for k in a.tags}
        if 'building' not in t and 'building:part' not in t: return
        for outer in a.outer_rings():
            pts = [raw(n.lon, n.lat) for n in outer][:-1]
            self.b.append({'part': 'building:part' in t, 'h': num(t.get('height')), 'min_h': num(t.get('min_height')) or 0.0, 'levels': num(t.get('building:levels')),
                           'name': t.get('name'), 'addr': ' '.join(x for x in [t.get('addr:housenumber'), t.get('addr:street')] if x), 'pts': pts})
h = H(); h.apply_file(SRC, locations=True)
site = [b for b in h.b if b['name'] == 'Park Lane Hotel' and not b['part']][0]
G0 = lambda p: (p[0] * E[0] + p[1] * E[1], p[0] * N[0] + p[1] * N[1])
sp = [G0(p) for p in site['pts']]; ox, oy = sum(q[0] for q in sp) / len(sp), sum(q[1] for q in sp) / len(sp)
G = lambda p: (round(p[0] * E[0] + p[1] * E[1] - ox, 2), round(p[0] * N[0] + p[1] * N[1] - oy, 2))
def area(g): return 0.5 * sum(g[i][0] * g[(i + 1) % len(g)][1] - g[(i + 1) % len(g)][0] * g[i][1] for i in range(len(g)))
def ccw(g): return g if area(g) > 0 else g[::-1]
def inside(pt, g):
    x, y = pt; c = False
    for i in range(len(g)):
        (x1, y1), (x2, y2) = g[i], g[(i + 1) % len(g)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
cen = lambda g: (sum(q[0] for q in g) / len(g), sum(q[1] for q in g) / len(g))
siteG = ccw([G(p) for p in site['pts']])
outers, parts = [], []
for b in h.b:
    g = [G(p) for p in b['pts']]
    if len(g) < 3 or abs(area(g)) < 4: continue
    c = cen(g)
    if math.hypot(*c) > RADIUS: continue
    if inside(c, siteG): continue                      # the site's own buildings are replaced by the design
    (parts if b['part'] else outers).append((b, ccw(g), c))
out = []
for b, g, c in parts: out.append({'pts': g, 'h': round(b['h'], 1) if b['h'] else None, 'min_h': round(b['min_h'], 1), 'part': True})
for b, g, c in outers:
    if any(inside(cen(pg), g) for _, pg, _ in parts): continue   # drawn by its parts
    hh, est = b['h'], None
    if not hh and b['levels']: hh, est = b['levels'] * 3.5, 'levels × 3.5 m'
    if not hh: hh, est = 15.0, 'no height in the data: 15 m assumed'
    o = {'pts': g, 'h': round(hh, 1), 'min_h': 0.0}
    if b['name']: o['name'] = b['name']
    if b['addr']: o['addr'] = b['addr']
    if est: o['estimated'] = est
    out.append(o)
for o in out:
    if o.get('h') is None: o['h'], o['estimated'] = 15.0, 'part without height: 15 m assumed'
# towers completed after the extract: published roof heights; positions on the reported lots, approximate (±20 m)
def rect(x0, y0, x1, y1): return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
ADDED = [
  {'name': 'Central Park Tower', 'addr': '217 West 57th Street', 'h': 472.4, 'pts': rect(-520, -116, -472, -76), 'note': 'completed 2020; height published 1,550 ft; footprint approximate on the reported lot'},
  {'name': '111 West 57th Street', 'addr': '111 West 57th Street', 'h': 435.3, 'pts': rect(-178, -112, -160, -62), 'note': 'completed 2021; height published 1,428 ft; 60 ft wide; footprint approximate'},
  {'name': '220 Central Park South', 'addr': '220 Central Park South', 'h': 289.9, 'pts': rect(-490, -46, -460, -14), 'note': 'completed 2019; height published 952 ft; footprint approximate'},
  {'name': '53 West 53rd', 'addr': '53 West 53rd Street', 'h': 320.0, 'pts': rect(-60, -445, -20, -400), 'note': 'completed 2019; height published 1,050 ft; footprint approximate'},
]
for a in ADDED:
    a['added'] = True
    out = [o for o in out if not inside(cen(o['pts']), a['pts'])]   # the older building on the lot is gone
    out.append(a)
doc = {
  'name': 'Park Lane site, 36 Central Park South, New York',
  'source': 'OpenStreetMap extract of Manhattan dated 2015-12-30 (github.com/fogleman/Manhattan osm/manhattan.osm.pbf), heights from the NYC building import; towers completed after it added from published heights (positions approximate). Data (c) OpenStreetMap contributors, ODbL 1.0.',
  'license': 'ODbL-1.0 (OpenStreetMap)',
  'frame': {'grid_deg': GRID_DEG, 'note': 'x along Central Park South towards Fifth Avenue, y uptown (into the park); metres; origin at the centroid of the Park Lane Hotel footprint', 'lat0': LAT0, 'lon0': LON0},
  'site': {'name': 'Park Lane Hotel footprint, 36 Central Park South', 'outline': siteG, 'area_m2': round(area(siteG), 1), 'note': 'the building footprint in the data; the tax lot is not verified (NYC PLUTO was not reachable)'},
  'park': {'south_edge_y': 48.0, 'x0': -614.0, 'x1': 140.0, 'note': 'Central Park from about 30 m north of the Central Park South building line, between Central Park West and Fifth Avenue (approximate)'},
  'buildings': out,
}
json.dump(doc, open(OUT, 'w'), separators=(',', ':'))
print('buildings', len(out), 'estimated', sum(1 for o in out if o.get('estimated')), 'site area', doc['site']['area_m2'], 'bytes', len(json.dumps(doc)))
