# Assumptions and known limitations

Numbered; referenced from code comments and the other records. An assumption stays here until a test
or a source removes it.

**A-01 · The ArchDaily source has not been acquired.** This environment cannot reach archdaily.com,
dezeen.com, designboom.com or any other page host (proxy CONNECT 403; name resolution fails for the
fetch tool). Project facts (Brasília, 2021, ~300 m², renovation of a 1980 house, precast pillars and an
inverted slab, credits) were read from **search snippets** of those pages and are recorded in SOURCES.md
and on the source record with that provenance; each is unverified until the page is read. Engineer,
drawings and licence remain unknown. No dimension has been taken from Section Haus. Fallingwater (HABS PA-5346) is now the recommended
candidate (SOURCES.md); its record and sheets are likewise unreachable from here, so no dimension has
been taken from it either. The first milestone
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

**A-12 · loc.gov, tile.loc.gov, wikimedia and archive.org are denied by this environment's network policy**
(proxy CONNECT 403, rechecked 2026-10-17 after the owner said to procure what is needed). The HABS sheets
for Fallingwater are therefore not in the repository. tools/fetch-habs.mjs downloads them where the
network allows; it has not been run against the live API.

**A-13 · Bar geometry is drawn with sharp corners and no hooks;** bend radii and hook geometry belong to
fabrication (page 05, owed).

**A-14 · Concrete Poisson's ratio 0.2** for G in the analysis; not taken from a clause here.

**A-15 · Reinforced-concrete unit weight 23.6 kN/m³ (150 pcf)** unless an element states one: a customary
US value, not a code value.

**A-16 · The ACI 318-19 ruleset is written from the provisions as known, not read from the printed code**
in this environment. Every row cites its clause so it can be checked; until then results are labelled
unverified on page 03.

**A-17 · Design is not yet benchmarked against a published worked example.** Its arithmetic is gated by
identities (equilibrium, φMn = Mu at the computed As) and one hand-worked section; a published example
(e.g. a textbook or the ACI Reinforced Concrete Design Manual) is owed.

**A-18 · Analysis uses the gross concrete section.** Cracked stiffness enters only the deflection check,
through Ie with the analysis deflection scaled by Ig/Ie of the governing section (uniform along the member).

**A-19 · Flat slab design is the Direct Design Method on a full rectangular grid without edge beams.** Its
8.10.2 limits are reported as check rows, never waived. Unbalanced moments at a column act together at
the worst corner of the critical section (conservative). A perimeter is truncated at a slab edge only when
the edge lies within d/2 of the column face. Column-strip negative steel uses the slab depth alone. Slab
deflection is controlled through the minimum thickness of 8.3.1.1, not computed. Equivalent Frame Method
and engine plate analysis are owed.

**A-20 · Strut-and-tie struts use βs = 0.4** (Table 23.4.3(a), "all other cases") because no distributed
reinforcement per 23.5 is provided; this is the most conservative coefficient. STM covers deep 2- and
4-pile caps; 3-pile and larger deep caps keep the sectional checks and are flagged.

**A-21 · The ground is an ASSUMED soil profile until a site investigation replaces it.** Pile capacity is
computed from it (core/geotech.js): clay side α su and tip Nc* su (FHWA GEC 10), sand side β σ′v with the
O'Neill & Reese (1999) depth method and tip 0.6 pa N60 (GEC 10), FS 2.5; all unverified against the printed
texts. The default profile (fill 0–1 m, stiff clay su 75 kPa to 6 m, dense sand N60 35 to 20 m and below,
water at 3 m) is generic, not from any site. Each pile is the shortest 0.5 m step, 3 m minimum, that carries
its load. Pile self-weight, negative skin friction, group effects and settlement are not considered.

**A-22 · Pile cages (6 bars minimum, ρ ≥ 0.5 %, over max(L/3, 3 m)) and spirals (#3 at 150 mm) are practice,**
not ACI 318-19 requirements outside seismic design (18.13).

**A-23 · Stud rails are drawn as a 25 × 10 mm carrier with studs at the design spacing,** two rails per
column face at quarter points; rails that would run off a free edge are omitted. The rail section is assumed.

**A-24 · Beams with pinned or roller supports must run parallel to x or y.** Restraints are mapped from
the beam's axes to the engine's global flags; a skewed beam needs inclined supports (springs), owed, and is
refused with a message rather than analysed wrongly.

**A-25 · The reference frame is synthetic.** Its loads (live 4.8 kPa; 600 kN dead and 250 kN live on each
column for floors above) are chosen to exercise every element path, not taken from a building.

**A-24 · The reference frame's slab is a roof: no floors above.** Earlier builds added 600 kN dead and 250 kN
live per column for floors that were not drawn; that load made one storey look like a tower to its foundations
and is gone (2026-10-20).

**A-25 · The needle tower is synthetic.** Proportions in the range published for Central Park South / West 57th
Street towers (secondary sources, unverified); not a record of any building. Floor loads SDL 2.0 kPa, live
1.92 kPa (7.2 kPa mechanical), no live-load reduction; concrete 24 kN/m³.

**A-26 · Wind site, assumed:** ASCE 7-16 basic speed 51.4 m/s (115 mph, Risk Category II) and 10-year 34 m/s
(76 mph), both read from the maps from memory and unverified; Exposure C because Central Park lies within 20 H
upwind; inherent damping 1.5 % (service) and 2 % (ultimate); tuned mass damper equivalent damping by the Den
Hartog optimum halved (approximation). Screening criteria (not code): drift H/500 and storey drift h/400 under
the 10-year wind, peak acceleration 15 milli-g.

**A-27 · The tower frame:** piers with gross sections (service stiffness ≈ Ig), perforated facade walls at
their stated solidity, slab coupling 0.35 Ig over the core depth, outriggers as storey-deep beams at mid-height,
rigid diaphragms, columns out of the lateral system, fixed at grade. Rock anchors 2500 kN working, two rows at
1.5 m along the mat edge, to hold the 0.6D + 0.6W resultant in the middle third.

**A-28 · The Park Lane site data.** Footprints and heights are OpenStreetMap's as of 2015-12-30 (NYC building
import); buildings changed since are as they were then, except the four towers added from published heights at
positions estimated from their lots (±20 m). 21 heights are estimated (levels × 3.5 m or 15 m) and flagged. The
site is the hotel's building footprint; the tax lot was not verifiable (NYC PLUTO unreachable). The street-grid
angle (61.17° from east) was measured from the Central Park South frontages. The park edge is approximate.
Data © OpenStreetMap contributors, ODbL 1.0.

**A-29 · The organic tower's structure.** The tube follows the largest axis-aligned rectangle each plate holds, at
least 1.2 m inside the facade plus half its thickness, 70 % solid; slab edges cantilever from it to the curved
facade (cantilever design owed). The core steps down with the plate, not below 60 % of its base size, as lift
banks drop off. Apartments lie between tube and facade; the tube's openings serve them.
