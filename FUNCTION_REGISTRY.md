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
| structure.beamModel | 1.0.0 | beam inputs (span, section, supports, f′c, γ, SDL, L, segments) | stiffness engine JSON model, section, material, loads | gross section; Timoshenko Av = 5/6 A; γ 23.6 kN/m³ default (A-15); ν 0.2 (A-14) | structure.test.mjs | promoted |
| structure.beamResults | 1.0.0 | engine output, n, L | per case and combination x, M, V, w, R; envelope with governing combination | linear superposition; ACI 318-19 5.3.1 U1, U2 | structure.test.mjs: cantilever, simply supported, fixed-fixed vs Timoshenko closed forms to 1e-9; e2e through the service | promoted |
| structure.rcBeamDesign | 1.0.0 | beam inputs, results, L | faces (As req/prov, bars, φMn, εt), shear (stirrups, φVn), deflection (Ie, immediate, long-term), development lengths, check rows with clause and utilisation | ACI 318-19 ruleset unverified (A-16); single layer; compression steel ignored; shear at max |Vu| | hand-worked section; identities; e2e | arithmetic gated; **not benchmarked against a published example (A-17)** |
| structure.beamBars | 1.0.0 | beam inputs, design, beam name | bars: longitudinal (with anchorage into fixed supports) and closed stirrups, in world coordinates | straight bars; no hooks or bend radii (A-13) | structure.test.mjs (bars inside cover); e2e | promoted |

## Rulesets

| Ruleset | File | Status |
|---|---|---|
| ACI 318-19 (SI) | app/core/standards/aci318-19.js | every value cites a clause; **unverified against the printed code** (A-16) |
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
