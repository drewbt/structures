# Assumptions and known limitations

Numbered; referenced from code comments and the other records. An assumption stays here until a test
or a source removes it.

**A-01 · The ArchDaily source has not been acquired.** This environment cannot reach archdaily.com,
dezeen.com, designboom.com or any other page host (proxy CONNECT 403; name resolution fails for the
fetch tool). Project facts (Brasília, 2021, ~300 m², renovation of a 1980 house, precast pillars and an
inverted slab, credits) were read from **search snippets** of those pages and are recorded in SOURCES.md
and on the source record with that provenance; each is unverified until the page is read. Engineer,
drawings and licence remain unknown. No dimension has been taken from Section Haus. The first milestone
was run on a **synthetic fixture drawing** (app/fixtures/plan-fixture.svg) whose dimensions are known
by construction; it is labelled as such on the drawing, in the source record (`status: synthetic`) and
in every traced element's provenance (`source: src-fixture-plan-v1`). Acceptance criterion "a real
drawing is visible" is met for an imported drawing only once the owner imports one they are
authorised to use (page 00 → Import). The import path is built and the fixture exercises it.

**A-02 · Level height 3.000 m and elevation 0 on a level created at import are assumed** and marked
`method: assumed` in provenance until a section is traced.

**A-03 · Wall height defaults to its level's height; columns likewise.** A per-element `height`
overrides it.

**A-04 · Default thicknesses in the trace toolbar (wall 200, slab 200, column 300×300, door 900×2100)
are the person's choice at trace time, not read from the drawing.** They are parameters and stay
editable; their provenance method is `measured` because the position is, which overstates the
thickness's standing. Owed: per-parameter provenance.

**A-05 · SQLite on Windows.** The build links the system `sqlite3` (Linux/macOS). On Windows, point
`SQLITE3_INCLUDE_DIR`/`SQLITE3_LIBRARY` at the amalgamation or `winsqlite3`; neither has been built in
this session (no Windows machine; sqlite.org unreachable to vendor the amalgamation).

**A-06 · World coordinates derived from a trace are rounded to 1 mm.** At the fixture's 0.01 m/px a
click is precise to about 1 mm anyway (the trace page rounds clicks to 0.1 px). A finer drawing would
round the same way; the raw pixels are kept on the trace.

**A-07 · Concrete volume is the sum of exact prism volumes; overlaps at wall junctions, wall/slab and
column/slab intersections are not deducted.** The summary says so. Owed: boolean union or a junction
rule.

**A-08 · Slabs are simple polygons without holes; columns are rectangles; walls are straight.**

**A-09 · The HTTP server is single-threaded and serves one request at a time**, for one person on one
machine. A bind to a non-loopback address is possible but there is no authentication.

**A-10 · Performance is unmeasured.** The viewer redraws only on change and draws one merged buffer;
no instancing, culling or LOD. The 60 FPS target is not claimed.

**A-11 · Visual correctness is judged from screenshots by a person**, not by a pixel oracle.
