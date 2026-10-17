# Decisions

Each entry: the decision, why, what it rules out, date. A later entry supersedes an earlier one by number.

**D-01 · The local service is C++ and serves both the app and the store.** (2026-10-17)
The specification forbids a Node.js runtime dependency and requires SQLite. A C++ process that serves
`app/` statically and exposes the model API on localhost satisfies both with one binary; SQLite is
linked (system library here; amalgamation on Windows, A-05). Rules out: SQLite-in-WASM in the browser
(no Emscripten in this environment; would duplicate the store), a Node dev server as the product.

**D-02 · Node and Playwright are development tools only.** (2026-10-17)
Unit tests run under `node --test`; the end-to-end slice drives headless Chromium through Playwright.
Nothing under `app/` or `service/` needs them. stiffness already uses node this way (`tools/serve.mjs`,
`tests/wasm-gate.mjs`). Rules out: a bespoke test runner in C++ for JavaScript.

**D-03 · Reuse across repositories is by verbatim vendoring with a provenance header.** (2026-10-17)
`service/json.h` is stiffness `src/json.h` at commit d836c1f with two header lines added. No submodule:
stiffness is private, and a reader of this repo must be able to build it alone. The rule: fix upstream,
re-vendor, never fork silently. Rules out: a second JSON implementation.

**D-04 · drewbt/stiffness is the structural engine; this repo does not re-implement analysis.** (2026-10-17)
Discovery found no code in `coraljs`; the working Coral engine is `stiffness` (sparse LDLᵀ, beams,
shells, sections, CBFEM, 40-check gate, builds on Linux with CMake, all pass). Milestone 2 calls it
(CLI or C ABI/WASM) on the model's structural projection. Rules out: writing a solver here.

**D-05 · Parameter values travel and are stored as JSON text, never re-serialised by the service.** (2026-10-17)
So the canonical model text, and therefore the model hash, is byte-identical in JavaScript and C++
(gated: unit hash.test.mjs vs service-gate, and the e2e history check on a real model). Rules out:
parsing numbers in the service (json.h writes 17 digits; JS writes shortest round-trip).

**D-06 · A trace is a record; a component is derived from it.** (2026-10-17)
Trace elements hold the clicked pixels; components hold metres and name their trace in provenance.
`Re-derive` propagates a calibration correction. Rules out: storing only metres (loses the measurement)
or only pixels (engineering never sees pixels).

**D-07 · The drawing's calibration stores the measurement, not the scale.** (2026-10-17)
`cal_p1`, `cal_p2`, `cal_distance` are the parameters; `trace.pixelToWorld@2.0.0` derives the scale.
Supersedes the 1.0.0 form that stored `scale` directly (changed before any data was persisted).

**D-08 · Engineering meshes are doubles; the renderer downcasts.** (2026-10-17)
The divergence-theorem volume gate at 1e-9 m³ fails on Float32 vertices (seen at 5e-8). Rules out:
sharing one Float32 buffer between engineering and rendering.

**D-09 · The properties panel patches in place and serialises its renders.** (2026-10-17)
Replacing the DOM under a focused input fires its change event inside the render and the outer render
then overwrites the result (seen in e2e). Rules out: naive full re-render on every model event.

**D-10 · Work is committed to a branch and pushed from this session; no pull request is opened.** (2026-10-17)
The session container is ephemeral. Pushing preserves the green baseline; the PR is the owner's call.
