# Implementation log

## 0 · Repository discovery and baseline (2026-10-17)

- `drewbt/structures` (this repo): one commit, README and MIT licence, no code.
- `drewbt/coraljs`: one commit, README only. No Coral code exists under that name.
- `drewbt/stiffness` (private, cloned at d836c1f): the working engine. C++17, no dependencies:
  `json.h`, `sparse.h` (LDLᵀ, minimum degree), `stiffness.h/.cpp` (bars, 12-DOF beams, cables, modes),
  `section.h`, `shell3.h`, `cbfem.h`, `mesh.h`, `membrane.h`, `render.h` (software z-buffer to PNG),
  `model3d.h`, `runs.h` (SQLite via winsqlite3, Windows only), pages under `docs/` on 2D canvas, WASM
  build via Emscripten (not present here). Records: MASTER.md, CONTRACT.md, LIBRARY.md, GAPS.md,
  PORTING.md. GAPS.md lists reinforced concrete, punching shear and construction stages as owed.
- `drewbt/svgcad`, `webstruct`, `spacialdesignformat`: README only on their default branches.
- **Baseline verified:** `cmake` + `make` of stiffness on Linux (g++ 13) succeeds; `./gate ../tests`
  prints `all pass` (sections, LDLᵀ Higham bounds, beams, nets, mechanisms).
- Environment: g++/clang/cmake, system SQLite 3.45.1 with headers, Node 22 and Playwright + Chromium
  (dev tools only), no Emscripten, no network to archdaily.com or sqlite.org.

## 1 · First vertical slice (2026-10-17)

Implemented, in order, each with its test before the next:
1. service/sha256.h, http.h, store.h, main.cpp, gate.cpp; CMakeLists. Gate 25/25 after one correction
   (the test's own row count; the code was right). HTTP smoke-tested with curl.
2. app/core: hash.js (cross-implementation hash equality with the C++ gate's value), units.js,
   geometry.js, functions.js, model.js, api.js. Unit tests 27 → 28 after: Float32 → Float64 engineering
   meshes (D-08); negative zero in the transform; a wrong expectation (slab correctly served from cache).
3. render/webgl.js; fixtures/plan-fixture.svg.
4. ui/app.js, tree.js, properties.js, timeline.js; pages/source.js, trace.js, architecture.js; style.css.
   Calibration changed to store the measurement (D-07, trace.pixelToWorld 2.0.0).
5. tests/e2e/slice.mjs: 20/22 first run (tree groups started collapsed) → 38/38. Then a stale properties
   input found in a screenshot, reproduced, diagnosed as re-entrant render (D-09), fixed, 38/38 again.
6. Records: this set.

## 2 · Public-source search (2026-10-17, same day)

The owner allowed other public sources. Every page fetch (ArchDaily, Dezeen, Designboom, Archiecho,
the office site, image hosts) failed at name resolution; web search works and returns snippets. From
snippets: Brasília, 2021, ~300 m², published as a renovation of a 1980 house by Cezar Augusto Simão,
three blocks on three levels, four internal precast pillars + four external joined by an inverted slab,
angular roofs with light wells, credits. No drawing and no dimension. Alternatives recorded: Concreto
House (Goiânia 2024, 930 m², post-tensioned slabs, engineer named) and Raw Concrete House (Mortágua
2018, 360 m²). Written to SOURCES.md and the source record's meta (page 00). Candidate-selection
concern raised to the owner: the preferred project is a renovation.

## 3 · Public-record candidate (2026-10-17, same day)

The owner asked for a notable house with public records and plans, not necessarily on ArchDaily. Found
Fallingwater, HABS PA-5346 at the Library of Congress: 11 measured drawings (7 sheet titles confirmed),
data pages, photographs; a reinforced-concrete house with a published cantilever-deflection history and a
2002 post-tensioning repair. loc.gov and tile.loc.gov are denied here, so facts come from snippets and
the sheets were not downloaded. Registered as source `src-habs-pa-5346` (page 00, status `identified`),
recorded in SOURCES.md with a rights caveat (Peterson Prize entry, not necessarily a federal work).
e2e extended to register it: 39 checks.

## 4 · Procurement attempt and the first structural component (2026-10-17, same day)

Owner: "procure what you need and proceed". loc.gov, tile.loc.gov, wikimedia, archive.org rechecked:
still denied by policy (A-12); only the owner can allow them. Staged tools/fetch-habs.mjs (untested
against the live API). Proceeded with milestone 13 on a typed beam:
- Read the engine's io.h contract; confirmed its signs on a simply supported beam (sagging M = F.My at a
  segment's a-end and −F.My at its b-end; V = dM/dx; midspan deflection = 5wL⁴/384EI exactly).
- geometry.beam, geometry.rebar; structure.js (beamModel, beamResults, rcBeamDesign, beamBars);
  standards/aci318-19.js; service /analyse with engine subprocess and results cache (D-11); page 03.
- Gates: service 29/29 (+4 results cache), unit 37/37 (+9 structure, all first run), e2e 54/54 (+15).
  Defects found and fixed on the way: a gate block-structure slip; error messages not JSON-escaped; a
  post-reload wait on a not-yet-defined hook (test side); concrete totals counted bar steel.

## 5 · Standard elements: beams, columns, slabs, drop panels, punching, piles, caps (2026-10-17)

Owner: "keep going detailing standard concrete elements". Built, each with gates before the next:
- Beams v2: supports anywhere, one live case per span, ACI 6.4.2 patterns, envelope-driven top regions with
  cut-offs, per-span bottom steel and stirrups. Gated against the three-moment equation (independent method)
  to 1e-9 on 2-, 3- and 4-span beams. Found: heavy pattern loading makes a middle span hog end to end, so the
  support regions merge (correct; the first test expectation was wrong).
- Columns: strain-compatibility interaction, biaxial load contour, slenderness magnifier, ties, cross-ties,
  dowels. Balanced point hand-checked.
- Flat slabs: DDM strips, thickness, drop panels, punching on clipped perimeters with numeric Jc (matches the
  ACI interior and edge closed forms), stud rails with solved spacing and size, mats, integrity bars.
  Found and fixed: column-strip bars missed the column core at 430 mm spacing (spacing now capped by the core).
- Foundations: load takedown in exact equilibrium, rigid-cap reactions, sectional checks, strut-and-tie for
  deep 2- and 4-pile caps, pile strength, cages and spirals, foundation search. Found and fixed: 5-, 7- and
  8-pile layouts off-centre or too close; a beam along y was a mechanism (restraints were global, now mapped
  from beam axes); sectional pile punching on a one-sided perimeter replaced by STM for deep caps.
- Model: batches (one event, one undo), reverse dependency index. Page 03 per element kind. Reference frame.
- Gates: service 29/29, unit 66/66, e2e 64/64.

## 6 · Model-first interface (2026-10-19)
After feedback that the interface was not working, page 02 became the whole working view (D-19): model fills
the window, utilisation colouring with a legend, Design drawer, Add menu, collapsed log, phone layout. Verified
by unit 66/66, e2e 64/64 and screenshots at 1600 px and 420 px (screens/model-*.png); published copy rebuilt.

## 7 · Ground and pile length (2026-10-20)
Piles had been 12 m by assumption and loaded by 850 kN per column of undrawn floors. Now the soil profile is in
the model, pile capacity is computed from it, and pile length is the shortest that carries the load: single
Ø450 piles of 5.5–10.5 m under the reference frame. The Model view draws the ground (layers, surface, water
table) with a key and an Earth toggle. Unit 73/73 (7 new, closed forms worked by hand), e2e 67/67.

## 8 · Needle tower: every floor, wind, vibration, earthquake, every ASCE 7 chapter (2026-10-20)
A synthetic 435 m needle tower on Central Park South (`core/tower.js`): 84 floors and a crown, cellars, mat on
Manhattan schist, the park as context. Its lateral system is read into a wide-column frame and run in the
stiffness engine (`core/towerdyn.js`): modes, ASCE 7-16 wind with flexible gust factors, Commentary
along-wind acceleration, across-wind screening, the ELF earthquake (SDC B), and the remaining chapters
(integrity, buoyancy, snow and terrace drifts, cladding). `core/coverage.js` lists every ASCE 7-16 chapter on
every run as applied, not applicable, or owed. `tools/optimise-tower.mjs` searched 162 forms and systems through
the engine; the bare 24:1 tower fails badly (first mode 0.05 Hz); the least concrete passing design is 20 m wide
(21.8:1) with a perforated concrete facade tube, four outriggers, a 1600 t damper and rock anchors. Across-wind
and vortex shedding are outside the analytical method: the wind tunnel test (Ch. 31) is required and owed.
Unit 86/86, e2e 73/73.

## 9 · Comfort: height and form for sway (2026-10-20)
Optimised for occupant comfort (D-23): 144 towers through the engine; the 435 m form cannot be made comfortable;
the default is now 389 m, 74 storeys, 32 m wide, at 9.7 milli-g worst-case 10-year acceleration. The published
copy opens on the tower and frames all of it on any screen. Lot and mat follow the tower's width (they had not).
Unit 86/86, e2e 75/75.

## 10 · Architecture and presentation render (2026-10-20)
Curtain wall per storey, louvred mechanical bands, lit crown lantern, spire; illustrative Midtown blocks and park
trees; Render mode in the WebGL viewer (dusk sky, reflective glass, lit rooms, haze, hero camera) as the default
for a model with a facade (D-24). Facade weight in the analysis; comfort 9.73 milli-g. Unit 88/88, e2e 77/77.

## 11 · Park Lane study: real site, real neighbours, organic form, penthouse crown (2026-10-20)
The Park Lane Hotel footprint at 36 Central Park South among 1,756 real buildings (OpenStreetMap 2015 plus four
later towers); a tapering, quarter-turning superellipse tower round a straight core (D-25), penthouses with
terraces and an open crown (D-26); 240 engine-run candidates; 52 storeys, 285 m, 9.7 milli-g, every check
passing with the across-wind estimate inside its method. Pier stresses now screened at every storey; the
notional load is its own case. The published copy opens on this study. Unit 93/93, e2e 79/79.

## Iteration report

**Implemented:** C++ service with normalized SQLite store and HTTP API; browser model with dependency
graph, versioned functions, result cache, undo/redo, append-only events; wall/slab/column/opening
geometry; WebGL viewer with pick and section cut; pages 00–02; synthetic fixture; persistence with
revision history and cross-checked hashes; inspectable export.

**Verified:** service-gate 29/29; unit 66/66; e2e 64/64 (headless Chromium, software WebGL); stiffness
gate all pass on Linux. Screenshots in tests/e2e/out/.

**Reused:** stiffness `json.h` verbatim; stiffness's contract rules (versioning, tolerances stated with
reasons, gates on independent oracles) adopted as process.

**Changed:** nothing existing was modified (the target repo was empty; stiffness untouched).

**Blocked:** ArchDaily unreachable (A-01); Windows SQLite build untested (A-05); no Emscripten for an
in-browser engine.

**Next:** NEXT_ACTION.md.

## 12 · Feasibility, the process and the exits; brochure renders (2026-10-20)

**Implemented:** core/feasibility.js (areas, quantities, revenue, cost plan, cash flow, IRR, residual land,
break-even prices, sensitivity, process stages, exit comparison); page 03 Feasibility (KPIs, reading, who-is-paid
timeline, exits, cash-flow chart, cost plan, sensitivity, floor schedule, editable assumptions kept in the model);
tools/brochure.mjs and six renders in docs/brochure; the sky now runs continuously through the horizon and far
ground fades into it (no edge band).

**Verified:** 100 unit tests (7 new), 81 e2e checks (2 new). Park Lane as modelled: 331,000 gsf, 186,000 sf
sellable, about $818M net sales against $1.35B cost before $0.2B finance: a loss of about $740M at the $623M land
price. Zero profit needs land near $48M or prices about 2.0× (average about $8,500/sf).

**Changed:** the street-level brochure shot was dropped: the tower stands on the rear lot behind the Central Park
South frontage and cannot be seen from the street at this height. Replaced by a penthouse-terrace view.

**Blocked:** no zoning analysis (ZR, lot area, transfers) and no current land valuation; both drive the result.

**Next:** a larger, wider form tested against the appraisal; zoning check; land negotiated as a JV contribution.

## 13 · Market and site search (2026-10-20)

**Implemented:** screening.js (parametric product, construction type, option, searchSpace, bestForSite), markets.js
(22 submarkets: Caribbean 6, NC 6, TN 6, KY 4, each with sourced basis), parcels.js (24 real parcels: Dorado,
Grand Cayman, Charlotte, Nashville), tools/search-markets.mjs and tools/search-parcels.mjs → docs/*.json;
spendable buyer deposits in the cash flow.

**Verified:** 104 unit tests. 4,968 market options; 5 markets reach 15 %. Best listed parcel: Dorado oceanfront
1.93 ac at $8.8M, 4 storeys, 20 units: IRR ~47 %, ~22 % in the downside; needs about $1,700/sf at FAR 1.0.

**Blocked:** listing pages unreachable (DNS/proxy): every parcel figure is a search snippet, unverified; zoning
capacity of each parcel unconfirmed.

**Next:** confirm Dorado zoning (R-I density) and location; model the front-runner in Coral; price check with brokers.
