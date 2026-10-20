# Coral Concrete — architecture (as built, 2026-10-17)

Specification: FI-CONC-006 v1.0. This file describes what is in the repository, not what is planned.
Planned work is in NEXT_ACTION.md; unbuilt capability is listed as owed, never implied.

## Shape

```
service/            C++17 local service: HTTP + static files + SQLite (the authoritative store)
  http.h            blocking HTTP/1.1 server, POSIX sockets or Winsock
  store.h           schema (REQUIREMENTS §7) and every store operation; append-only revisions/events
  sha256.h          SHA-256, FIPS 180-4, portable (the same algorithm as app/core/hash.js)
  json.h            vendored verbatim from drewbt/stiffness src/json.h @ d836c1f (DECISIONS D-03)
  main.cpp          coral-service: routes and static files
  gate.cpp          service-gate: 25 checks (TEST_REGISTRY.md)
app/                the browser application: vanilla JS modules, native web components, native WebGL
  core/model.js     the ONE building model: elements, parameters with units, provenance, events,
                    undo/redo, dependency graph, dirty set, result cache keyed by name@version + input hash
  core/functions.js the versioned function registry (geometry.wall, geometry.slab, geometry.column,
                    trace.pixelToWorld, trace.calibrateScale, quantity.concreteVolume)
  core/geometry.js  mesh builders in doubles (engineering geometry), ear-clipping, exact prism volumes
  core/hash.js      SHA-256 + canonical forms (canonicalJSON, modelCanonical == store.h canonical())
  core/units.js     explicit units; SI inside, conversion only at the edges
  core/structure.js the beam chain: beamModel → (service, engine) → beamResults → rcBeamDesign → beamBars
  core/columns.js   columns: interaction, slenderness, bars       core/slabs.js  flat slabs, drop panels, punching, stud rails
  core/foundations.js  load takedown, pile caps (sectional + strut-and-tie), piles
  core/geotech.js   soil profile (fill, clay, sand, rock), bored-pile axial capacity, designed pile length
  core/tower.js     the synthetic needle tower, floor by floor; gravity summary
  core/towerdyn.js  the tower's lateral frame for the engine; wind, earthquake and other-chapter checks
  core/wind.js      ASCE 7-16 gust factor, along-wind forces and acceleration; across-wind screening
  core/coverage.js  every ASCE 7-16 chapter: applied / not applicable / owed
  core/standards/asce7-16-{wind,seismic,other}.js   the rulesets as data
  tools/optimise-tower.mjs   the form and system search through the engine binary
  core/detail.js    shared bar geometry (hooks, loops, helices)     core/reference.js  the synthetic reference frame
  core/standards/aci318-19.js   the design ruleset as data, a clause per value
  core/api.js       the service client
  render/webgl.js   the 3D viewer: reduced Float32 copy of the meshes, pick pass, section cut, transparency
  ui/app.js         <coral-app>: layout, routing (#source #trace #model; #architecture and #structure redirect), save/reload, selection
  ui/tree.js        <coral-tree>        ui/properties.js <coral-properties>      ui/timeline.js <coral-timeline>
  pages/structure.js <page-structure>, shown in the Model's Design drawer: Design all, Create foundations, Generate reinforcement, per-kind tables and detail
  pages/source.js   <page-source> 00    pages/trace.js <page-trace> 01            pages/architecture.js <page-architecture> 02 Model: viewer, toggles, utilisation colours, Add menu, drawer
  fixtures/plan-fixture.svg  a SYNTHETIC drawing with known dimensions (not an ArchDaily drawing)
tests/unit/*.test.mjs   28 tests under `node --test`         tests/e2e/slice.mjs   38 checks in headless Chromium
tests/run.sh            build + every gate
```

## Single source of truth

`Model` (app/core/model.js) is the only holder of building state in the browser; the service's
SQLite file is the only durable copy. Pages read the model and write through `create/set/remove`.
The tree, the properties panel, the 2D trace canvas and the 3D viewer are projections rebuilt from
the model on its events; none keeps geometry of its own. Trace primitives (type `trace`, pixel
coordinates as clicked) are the measurement record; components (wall, column, slab, opening, in
metres) are derived from them through the drawing's calibration and carry provenance that names the
trace. `Re-derive` recomputes every component from its trace when the calibration changes.

## Functional Intelligence

Every computation is a registered function `{name, version, inputs(model, el), run(inputs),
assumptions}`. `inputs` gathers everything the computation reads, in SI; the cache key is
`name@version:sha256(canonicalJSON(inputs))`. Equal key, equal answer by construction; a changed
dependency changes the key, so a stale result cannot be served. `regenerate()` visits only the dirty
set (the element and its transitive dependents). Results carry `{fn, version, inputHash, assumptions}`
and are exported with the model (`exportInspectable`).

## Persistence and provenance

Commit = one revision: elements upserted, only changed parameter rows written (values stored as the
exact JSON text the client sent), provenance rows, append-only events, `model_hash` = SHA-256 of the
canonical text. The browser computes the same hash before sending; the service reports agreement.
Deletion sets `deleted_rev`; history is never rewritten. A stale `parent_rev` is refused (409).

## Rendering

Native WebGL2 (WebGL1 + OES_element_index_uint fallback). The viewer downcasts positions to Float32
on upload and never reads them back; engineering values come from the double-precision meshes and
are gated by the divergence theorem to 1e-9 m³. Redraw only on change. Selection by an id-colour pick
pass. Section cut by fragment discard above z. Transparent items drawn last, far to near by centroid.

## Analysis path

The browser builds the engine's JSON model with `structure.beamModel`; `POST /api/projects/:p/analyse`
writes it to a file beside the database, runs `stiffness <in> -o <out> --compact` (the binary named by
`--engine`), and stores the output in `results` keyed by element, function@version + engine SHA-256 and
the SHA-256 of the model text. A repeat of the same text through the same binary is served from SQLite.
The browser post-processes (`beamResults`), designs (`rcBeamDesign`) and generates bars (`beamBars`);
bars become `rebar` elements with a `basis` hash so a changed beam shows them stale.

## Not in this repository (owed)

Pages 05–11, frames of many members in one engine model, plate analysis,
instancing/LOD/frustum culling, holes in slabs, non-rectangular columns, automated tracing, the
`.fi` reader, multi-user access.
