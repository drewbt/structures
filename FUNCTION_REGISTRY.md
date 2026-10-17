# Function registry

Registered in app/core/functions.js. Versioning per DECISIONS D-07 / stiffness CONTRACT §10: major =
a number or signature changes; minor = validity widens; patch = no number changes. Status: **promoted**
means its acceptance tests pass (TEST_REGISTRY.md); nothing here is promoted on claim alone.

| Function | Version | Inputs (SI) | Output | Assumptions | Gate | Status |
|---|---|---|---|---|---|---|
| geometry.wall | 1.0.0 | start, end [m], thickness, height, z0, openings[{offset,width,height,sill}] | mesh (Float64), volume_m3 (exact), length_m, area_m2, opening_area_m2, bounds | straight centreline; constant thickness; rectangular openings along the centreline; height defaults to level height; overlapping openings merged by union | geometry.test.mjs (5), model.test.mjs, e2e | promoted |
| geometry.slab | 1.0.0 | outline [[x,y]] m, thickness, zTop | mesh, volume_m3 = area·t, area_m2, bounds | simple polygon, no holes; uniform thickness; top at level elevation + offset | geometry.test.mjs (2), e2e | promoted |
| geometry.column | 1.0.0 | center, width, depth, rotation_deg, height, z0 | mesh, volume_m3, bounds | rectangular section; vertical | geometry.test.mjs, e2e | promoted |
| trace.pixelToWorld | 2.0.0 | cal_p1, cal_p2 [px], cal_distance_m, origin_px, rotation_deg | {scale, toWorld(px), toPixel(w), cal_pixels} | similarity transform (uniform scale, rotation, translation); calibration points on the drawing plane | functions.test.mjs (3), e2e calibration | promoted |
| trace.calibrateScale | 1.0.0 | p1, p2 [px], distance_m | scale_m_per_px, pixels | the stated distance is the true distance between the two points | functions.test.mjs | promoted |
| quantity.concreteVolume | 1.0.0 | volumes[] | total_m3, count | junction overlaps not deducted (A-07) | none directly (sum shown in properties summary) | existing, unverified |
| geometry.beam | 1.0.0 | start, end, width, depth, zTop | mesh, volume_m3 = L·b·h | straight, horizontal, rectangular; top at level elevation + top_offset | e2e (4.6 × 0.4 × 0.7 m) | promoted |
| geometry.rebar | 1.0.0 | path [[x,y,z]], diameter | mesh (equal-area square prism), length_m, steel volume, mass_kg | sharp corners; 7850 kg/m³ | e2e (every bar has geometry) | promoted |
| structure.beamModel | 2.0.0 | beam inputs incl. `supports` [{at, type}] anywhere along the beam | engine model: key points, intervals (spans/overhangs), D + one L case per interval; restraints in beam axes | gross section; Timoshenko unless shear_deformation false; beams parallel to x or y for pinned/roller (A-24) | structure.test.mjs: Timoshenko closed forms; three-moment equation | promoted |
| structure.beamResults | 2.0.0 | engine output, model | per case/combination M, V, w, R per support; U1, U2 over every ACI 6.4.2 live pattern; strength envelope along the beam | linear superposition | Timoshenko closed forms (3 support cases) and Clapeyron three-moment equation (3-, 2-, 4-span, every pattern) to 1e-9; classic 3-span coefficients | promoted |
| structure.rcBeamDesign | 2.0.0 | beam inputs, results, model | top regions per hogging support with cut-offs past the inflection point (9.7.3.8.4), merged where they meet; bottom per span into supports 150 mm (9.7.3.8.2); stirrups and deflection per span; faces (As req/prov, bars, φMn, εt), shear (stirrups, φVn), deflection (Ie, immediate, long-term), development lengths, check rows with clause and utilisation | ACI 318-19 ruleset unverified (A-16); single layer; compression steel ignored; shear at max |Vu| | hand-worked section; identities; e2e | arithmetic gated; **not benchmarked against a published example (A-17)** |
| structure.beamBars | 2.0.0 | beam inputs, design, beam name | top bars per region (anchored by ld into fixed ends), bottom per span, hangers where no top region runs, stirrups per span | straight bars; no hooks or bend radii (A-13) | structure.test.mjs (bars inside cover); e2e | promoted |
| structure.columnDesign | 1.0.0 | column, Pu, Mux, Muy | bar count by search, interaction curves both axes, slenderness (6.2.5, 6.6.4.5), minimum moment, ties, dowel lap | tied rectangular; linear load contour; nonsway, M1/M2 = −1, Cm 1, βdns 0.6 | columns.test.mjs: P0, φPn,max, pure tension, hand-worked balanced point (Pn 1555.3 kN, Mn 356.1 kN·m) | promoted |
| structure.columnBars | 1.0.0 | column, design, base | longitudinal bars hooked into the slab, dowels hooked on the cap mat, ties, cross-ties per 25.7.2.3 | first tie s/2 above the base | columns.test.mjs | promoted |
| structure.flatSlabDesign | 1.0.0 | slab, columns under it, drop panels | DDM strips both ways (8.10), limits, thickness (8.3.1.1), drop panel geometry (8.2.4), strip steel with core-bar integrity (8.7.4.2.1), reactions, punching on clipped critical perimeters with numeric Jc (8.4.4.2, 22.6), stud rails (22.6.6, 8.7.7) | see the function's assumptions (A-19) | slabs.test.mjs: Jc interior and edge vs R8.4.4.2.3 closed forms, bo interior/edge/corner, Table 22.6.5.2 cases, DDM identity Σ = M0, equilibrium, drop sections, studs | promoted |
| structure.flatSlabBars | 1.0.0 | slab, design | mats per strip with Fig. 8.7.4.1.3 extensions and edge hooks; stud rails; punching zone records | extensions use the longer of the figure's lengths for all bars | slabs.test.mjs; e2e | promoted |
| structure.loadTakedown | 1.0.0 | columns, slab reactions, beam reactions (with level), caps | per column / cap D, L, Pu, Mux, Muy; applied totals | beam reactions route by footprint and level | foundations.test.mjs: Σ caps = Σ applied to 1e-12; e2e on the reference frame | promoted |
| structure.pileCapLayout | 1.0.0 | cap proto, D, L, moments | pile count and standard layout (1–7, 9), cap size | allowable pile load assumed (A-21) | foundations.test.mjs: centred, spacing ≥ s | promoted |
| structure.pileCapDesign | 1.0.0 | cap, column, load | rigid-cap reactions; flexure at the face, one-way and two-way shear with 13.4.2.5 shares; strut-and-tie for deep 2- and 4-pile caps (Ch. 23); pile service and structural checks; dowel ldc | βs 0.4 (A-20); sectional rows superseded when STM governs | foundations.test.mjs: statics, 4-pile face moment by hand, pile φPn | promoted |
| structure.pileCapBars | 1.0.0 | cap, design | bottom mats hooked up at edges on the pile heads; pile cages and spirals | cage rule is practice, not code (A-22) | foundations.test.mjs | promoted |

## Rulesets

| Ruleset | File | Status |
|---|---|---|
| ACI 318-19 (SI) | app/core/standards/aci318-19.js | every value cites a clause, now including 6.4.2, 8.2.4, 8.3.1.1, 8.4, 8.6–8.7, 8.10, 10.6–10.7, 13.2–13.4, 22.4, 22.6, 23 (STM), 25.2–25.7; **unverified against the printed code** (A-16); the 8.10.7 edge-column 0.3 M0 clause number is marked to verify |
| ASTM A615 bar sizes | same file, BARS | nominal inch dimensions converted exactly |

## Service functions (C++)

| Function | Where | Gate |
|---|---|---|
| sha256::of | service/sha256.h | FIPS 180-4 vectors (4) in service-gate; the same 4 in hash.test.mjs |
| store::canonical / Store::model_hash | service/store.h | hand-written canonical text; equality with JS on the gate model and on the e2e model |
| Store::commit / load / history / events / element_history | service/store.h | service-gate (rev chain, only-changed rows, tombstones, deletion keeps history, conflict) |
| Store::put_source / list_sources / put_artifact / get_artifact | service/store.h | service-gate |
| Store::get_result / put_result, POST /analyse | service/store.h, main.cpp | service-gate (hit, miss by engine or input, persistence); e2e (engine run, cache hit after revert and after reload) |

## Reused from drewbt/stiffness

| What | Commit | How |
|---|---|---|
| src/json.h | d836c1f | vendored verbatim (D-03) |
| the engine itself (`stiffness` CLI: sparse LDLᵀ, Timoshenko beams) | d836c1f | run as a subprocess by the service (D-11); identity = SHA-256 of the binary |
