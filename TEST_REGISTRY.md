# Test registry

Run everything: `./tests/run.sh` (build, service gate, unit tests, end to end). Last full run
2026-10-17: service-gate 25/25, unit 28/28, e2e 39/39.

Categories are the specification's §11. Tolerances are stated with their reason.

## service-gate (service/gate.cpp) — provenance and reproducibility, persistence

| Line | Oracle | Category |
|---|---|---|
| sha256 of "abc", "", the 56-byte string, 10⁶ × "a" | FIPS 180-4 published vectors | mathematical |
| empty project rev 0; empty model hash = sha256("") | definition | provenance |
| first commit rev 1, 8 rows written | counted by hand | persistence |
| model hash = sha256 of a canonical text written by hand in the test | independent of the code under test | provenance |
| exact text "0.2" m round-trips; provenance round-trips | — | persistence |
| one changed parameter → exactly one new row; element history 4 rows | — | persistence |
| stale parent_rev refused, nothing written | — | operational |
| deletion hides on load, keeps history, hash becomes the level alone | hand-written canonical | provenance |
| dropped parameter tombstoned, not resurrected | — | persistence |
| history chained; events in order; sources and artifacts round-trip; reopen finds rev 4 | — | persistence |

## unit (tests/unit/*.test.mjs, `node --test`)

| File | Tests | Oracle / tolerance |
|---|---|---|
| hash.test.mjs | FIPS vectors; canonicalJSON ordering; modelCanonical equals the gate's hand-written text; modelHash equals the C++ hash 959bfcdb… | cross-implementation: the hash printed by service-gate |
| geometry.test.mjs | wall volumes (plain, with door and window, clamped/merged openings, diagonal), degenerate rejection, L-polygon triangulation area, slab (ccw and cw), rotated column, merge | closed forms L·t·h, area·t; divergence theorem on the mesh at **1e-9 m³** (double arithmetic; anything larger than rounding is a defect — Float32 was seen to fail at 5e-8, D-08) |
| model.test.mjs | regenerate once; level change propagates (slab from cache); opening change hits only its wall; reverted change served from cache with the original input hash; removal clears results and keeps a dangling host visible; undo/redo with append-only events; wire round trip preserves hash, provenance, units; values as JSON text; export lineage | the dependency graph's own definition; hash equality |
| functions.test.mjs | calibrateScale 500 px / 5 m; correction propagates; pixelToWorld origin/flip/rotation/inverse (**1e-9 px**); uncalibrated → error; units | closed forms |

## end to end (tests/e2e/slice.mjs, headless Chromium with software WebGL)

Milestone-12 criteria, in order: service reached; ArchDaily source registered `not-acquired`; fixture
registered `synthetic`; assumed level; drawing visible (1400×1000 loaded); calibration 0.01 m/px
(**1e-12**, exact division); measurement stored; origin; two walls (orthogonal snap absorbs a 1 px
slip; endpoint snap joins W2 to W1); provenance measured/trace/source; column (3,4); slab 96 m²;
opening at 1.000 m; door volume cut; calibration correction re-derives (24 m) and back (12 m); 3D: 4
solids; pick pass finds elements; tree groups; thickness edit recomputes W1 only; level height
regenerates walls+column, slab cached; Save → rev 1; **service hash == browser hash**; reload keeps
hash, 12 elements, thickness/unit/provenance; parameter history row in SQLite; sources persisted;
export lineage; Ctrl+Z; no page errors.

## Not yet tested

Performance (60 FPS target) is not measured; no numbers are claimed. Visual correctness is checked by
screenshots (tests/e2e/out/*.png) read by a person, not by a pixel oracle. Pan/zoom input on the
canvases is exercised manually only.
