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

## Iteration report

**Implemented:** C++ service with normalized SQLite store and HTTP API; browser model with dependency
graph, versioned functions, result cache, undo/redo, append-only events; wall/slab/column/opening
geometry; WebGL viewer with pick and section cut; pages 00–02; synthetic fixture; persistence with
revision history and cross-checked hashes; inspectable export.

**Verified:** service-gate 25/25; unit 28/28; e2e 39/39 (headless Chromium, software WebGL); stiffness
gate all pass on Linux. Screenshots in tests/e2e/out/.

**Reused:** stiffness `json.h` verbatim; stiffness's contract rules (versioning, tolerances stated with
reasons, gates on independent oracles) adopted as process.

**Changed:** nothing existing was modified (the target repo was empty; stiffness untouched).

**Blocked:** ArchDaily unreachable (A-01); Windows SQLite build untested (A-05); no Emscripten for an
in-browser engine.

**Next:** NEXT_ACTION.md.
