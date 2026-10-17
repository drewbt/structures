# Test registry

Run everything: `./tests/run.sh` (build, service gate, unit tests, end to end). Last full run
2026-10-17: service-gate 29/29, unit 66/66, e2e 64/64. The structural tests need the stiffness
binary (STIFFNESS_BIN, default /home/user/stiffness/build/stiffness); without it they are skipped
(unit) or fail with a stated reason (e2e), never faked.

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

## structure (tests/unit/structure.test.mjs)

| Test | Oracle / tolerance |
|---|---|
| rectangle A, Iy, Iz; J vs Saint-Venant series (square 0.140577 a⁴, 2:1 β 0.2287) | exact; J within 0.2 % / 0.3 % (the approximation's known accuracy) |
| ACI tabulated β1 (28, 35, 55, 70 MPa), Ec(28), φ at εty and εty + 0.003, #8 bar area | the code's own table values; ASTM nominal sizes |
| beam model: nodes, restraints, centroid height, loads, E in kN/m², mechanism refused | definition |
| engine: cantilever, simply supported, fixed-fixed under self-weight | Timoshenko closed forms (bending + shear deformation), **1e-9 relative**: the element is exact for uniform load, so anything larger is a defect |
| flexure on a hand-worked section (a, εt, φ, Mn) and C = T | arithmetic written in the test's comment, 1e-3 mm / 0.01 kN·m |
| asRequired gives φMn = Mu to 1e-12; 99 % of it does not suffice; impossible moment → null | identity |
| cantilever design and bars: check rows with clauses; φMn ≥ Mu; governing M⁻ = (1.2D + 1.6L)L²/2 from U2; bars inside the cover; top bars anchored into the fixed end | closed form; geometry |

## columns, slabs, foundations (tests/unit/columns|slabs|foundations.test.mjs)

| Test | Oracle |
|---|---|
| P0, φPn,max, pure tension; balanced point layer by layer (Pn 1555.3 kN, Mn 356.1 kN·m) | closed form; hand calculation in the test's comment |
| slender column magnified (kℓu/r 27.1 > 22); minimum moment; tie spacing; cross-ties on wide faces | 6.2.5, 6.6.4.5, 25.7.2 |
| Jc interior = d b1³/6 + b1 d³/6 + d b2 b1²/2; Jc edge per R8.4.4.2.3; bo interior, edge, corner | ACI commentary closed forms, 1e-12 |
| Table 22.6.5.2: each expression governs in its own case; λs | the table |
| DDM: (neg₁ + neg₂)/2 + pos = M0 for every span of every frame; end-span coefficients; M0 = qu ℓ2 ℓn²/8; column-strip share | 8.10 identities |
| Σ column reactions = slab + drop weight; Σ caps = Σ applied; Σ pile reactions = P and moments (statics) | equilibrium, 1e-12 |
| 4-pile cap face moment = 2(P/4)(s/2 − c/2); pile φPn = 0.55 × 0.85 fc Ag; layouts centred, spacing ≥ s | hand calculation; Table 13.4.2.1 |
| studs: failing column gets rails; outer section passes; rails stay inside the slab | 22.6.6, 22.6.4.2 |
| batch: one event, one undo step, every element event logged | definition |

## end to end (tests/e2e/slice.mjs, headless Chromium with software WebGL)

Milestone-12 criteria, in order: service reached; ArchDaily source registered `not-acquired`; fixture
registered `synthetic`; assumed level; drawing visible (1400×1000 loaded); calibration 0.01 m/px
(**1e-12**, exact division); measurement stored; origin; two walls (orthogonal snap absorbs a 1 px
slip; endpoint snap joins W2 to W1); provenance measured/trace/source; column (3,4); slab 96 m²;
opening at 1.000 m; door volume cut; calibration correction re-derives (24 m) and back (12 m); 3D: 4
solids; pick pass finds elements; tree groups; thickness edit recomputes W1 only; level height
regenerates walls+column, slab cached; Save → rev 1; **service hash == browser hash**; reload keeps
hash, 12 elements, thickness/unit/provenance; parameter history row in SQLite; sources persisted;
export lineage; Ctrl+Z. Then milestone 13: beam from the typed dialog (4.6 × 0.4 × 0.7 m solid);
page 03 analysis through the service runs the engine (binary and model hashes returned); tip deflection
under D equals the Timoshenko closed form to 1e-9 through the whole chain; root moment −wL²/2; governing
moment from 1.2D + 1.6L; design rows; bars generated with provenance naming the design function and the
analysis model hash; a deeper beam re-runs the engine and marks bars stale; reverting is a cache hit and
the bars are current again; the 3D view draws every bar; save and reload keep the hash and the bars; the
analysis after reload is a cache hit; deleting the beam deletes its bars. Then the reference frame: design all without error; foundations under every column by search;
every frame element ≤ 1; slab through/outside drops with stud rails at edge and corner columns and DDM limits
held; continuous grade beam with 5 live patterns; Σ applied = Σ caps = Σ piles to 1e-9; stirrups, ties, dowels,
hooked mats, spirals, rails and zones generated and current; 1,759 elements persist with the same hash; after
reload every beam analysis is a cache hit; deleting the slab removes its parts and one undo restores them; no
page errors.

## Not yet tested

Performance (60 FPS target) is not measured; no numbers are claimed. Visual correctness is checked by
screenshots (tests/e2e/out/*.png) read by a person, not by a pixel oracle. Pan/zoom input on the
canvases is exercised manually only.
