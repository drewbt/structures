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

## Service functions (C++)

| Function | Where | Gate |
|---|---|---|
| sha256::of | service/sha256.h | FIPS 180-4 vectors (4) in service-gate; the same 4 in hash.test.mjs |
| store::canonical / Store::model_hash | service/store.h | hand-written canonical text; equality with JS on the gate model and on the e2e model |
| Store::commit / load / history / events / element_history | service/store.h | service-gate (rev chain, only-changed rows, tombstones, deletion keeps history, conflict) |
| Store::put_source / list_sources / put_artifact / get_artifact | service/store.h | service-gate |

## Reused from drewbt/stiffness

| What | Commit | How |
|---|---|---|
| src/json.h | d836c1f | vendored verbatim (D-03) |
| the engine itself (sparse LDLᵀ, beams, shells, sections, CBFEM) | d836c1f | not yet called; D-04, NEXT_ACTION.md |
