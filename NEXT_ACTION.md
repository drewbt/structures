# Next action

**The single highest-value step:** confirm Fallingwater (HABS PA-5346) as the project, then on a machine
that can reach loc.gov download sheets 2–8 and 10 as TIFF, read the item record's rights line and the
data pages, and import the plans and the sections on page 00 against the registered HABS source. Verify
every snippet fact in SOURCES.md against the record. Trace the first floor plan and the sections. That
closes A-01 on a public-record drawing. Allowing loc.gov and tile.loc.gov in this environment's network
policy would let this session do the download itself.

**Then, milestone 13 (first structural component), in this order:**
1. Pick one living-room cantilever beam of Fallingwater: its published deflection (about 7 in on about
   15 ft) and its 2002 repair are the independent oracle, once the primary reference is read.
2. Structural projection: a versioned function `structure.slabPlate@1` that writes the stiffness
   engine's JSON model (`io.h` schema: nodes, shell/plate elements, supports at walls and columns,
   self-weight from thickness × 25 kN/m³ with the density cited) from the model's parameters.
3. Call stiffness (`bin/stiffness` CLI now; the C ABI/WASM later) from the service; store the result in
   the `results` table keyed by element, function@version and input hash.
4. Gate: a simply supported one-way strip against wL²/8 and 5wL⁴/384EI, and a Navier plate solution,
   before any design check.
5. Page 03 shows loads, reactions, internal forces from the results table.

Before any of it: no PERI data, no code clause and no material strength enters the repo without a
source line, per stiffness LIBRARY.md's rule.
