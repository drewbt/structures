# Requirements — FI-CONC-006 v1.0, with status

Status key: **built** (implemented and gated), **partial** (some of it, stated), **owed** (not built).
Section numbers are the specification's.

| § | Requirement | Status | Where / evidence |
|---|---|---|---|
| 1 | Repository discovery, baseline, ledger | built | IMPLEMENTATION_LOG.md §0; stiffness gate run (all pass) |
| 2 | Vanilla JS/HTML/CSS, web components, native WebGL, C++ services, SQLite; no React/Tailwind/Three/Node runtime/Python | built | app/, service/; DECISIONS D-01, D-02 |
| 2 | Single source of truth; change propagates to dependents only | built | model.js dependency graph; model.test.mjs; e2e "recomputed W1 only" |
| 2 | Versioned inputs → versioned function → verified outputs; cache keyed by inputs + version | built | functions.js, model.js regenerate; model.test.mjs cache tests |
| 3 | ArchDaily project selection, source record, attribution, missing-information register | partial | page-source ARCHDAILY_SOURCE: URL, author, status `not-acquired`; location/year/area unknown (ASSUMPTIONS A-01) |
| 3 | Measured / inferred / assumed distinguished | built | provenance.method on every element; shown in properties |
| 4 | Shared UI: tree / viewport / properties / nav / timeline; compact collapsed tree | built | ui/*.js; tree collapse button |
| 4 | PAGE 00 Source: registration, import, identification, scale refs, revision, attribution, quality, missing register | partial | registration, import (artifacts by SHA-256), attribution, missing list, status; revision tracking of sources is by `updated` only (owed: source revisions) |
| 4 | PAGE 01 Trace: alignment, calibration, coordinate system, line/polygon tracing, walls, columns, slabs, openings, levels, snapping, undo/redo, provenance, validation | partial | all listed except arcs, stairs and dimension constraints (owed); validation = function errors in the timeline |
| 4 | PAGE 02 Architecture: parametric walls, slabs, columns, openings, levels; editable, persistent, regenerating | partial | those five types; owed: grids, roofs, beams, doors/windows as typed objects, stairs, balconies, spaces, finishes, site |
| 4 | PAGE 03 Structural engineering | partial | one beam: supports, materials, D/L cases, ACI combinations, Timoshenko frame analysis by the stiffness engine, internal forces, reactions, deflections, design ratios. Owed: frames of many members, plates/shells, wind, seismic, foundations, nonlinearity, construction stages |
| 4 | PAGE 04 Concrete design and reinforcement | partial | beam flexure, shear, deflection (Ie, long-term), development length, minimum steel, bar spacing; bars as first-class elements with basis hash and status. Owed: punching shear, torsion, columns, slabs, crack control, laps, couplers, clash detection, fire, durability |
| 4 | PAGES 05–11 | owed | — |
| 5 | Construction simulation engine | owed | the event log exists (append-only, service `events`), the simulation does not |
| 6 | Human/equipment agents | owed | — |
| 7 | Normalized SQLite schema: projects, sources, artifacts, revisions, elements, parameters, provenance, events, functions, results | built | store.h schema (functions/results tables exist, unused yet) |
| 7 | Stable identities, explicit units, result lineage, content hashes, immutable history | built | model.js, store.h; gate "history kept after deletion" |
| 8 | Native WebGL: selection, hover, section cut, transparency, inspection | partial | built: those; owed: instancing, frustum culling, LOD, progressive loading, exploded views, stage visibility, animation, overlays |
| 8 | Engineering geometry separate from render geometry | built | Float64 meshes vs Float32 upload (geometry.js header) |
| 9 | Development harness roles | partial | followed as process in this iteration (IMPLEMENTATION_LOG.md); no tooling |
| 10 | Standing records | built | this set of files |
| 11 | Tests per category | built for this slice | TEST_REGISTRY.md |
| 12 | First milestone: drawing → calibrate → trace → components → 3D → tree → edit → regenerate → SQLite save/reload → provenance → export → tests | built, with one qualification | tests/e2e/slice.mjs 38/38; the drawing is the synthetic fixture, not an ArchDaily plan (ASSUMPTIONS A-01) |
| 13 | Second milestone (first structural component) | built for a typed beam; owed on a traced Fallingwater beam | geometry → materials → loads → analysis → design → reinforcement → verification, gated (structure.test.mjs, e2e); the beam is typed, not traced, until the HABS sheets arrive (A-12); design not yet benchmarked against a published example (A-17) |
| 14 | Third milestone (first pour) | owed | — |
