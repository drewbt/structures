# Next action

**Blocked on the owner:** allow `www.loc.gov` and `tile.loc.gov` in this environment's network settings
(or run `node tools/fetch-habs.mjs pa1690` on a machine with internet access and import the sheets on
page 00). Everything below that does not need the sheets is done.

**The single highest-value step once the sheets are in:** trace Fallingwater's first-floor plan and
the sections, and replace the typed beam with a traced living-room cantilever beam. Then compare the
model's long-term deflection with the published deflection (about 7 in on about 15 ft), with the
primary reference (Silman and Matteo, STRUCTURE, July/August 2001) read and its numbers sourced.

**Without the sheets, in order of value:**
1. Check every ACI ruleset row against the printed code (A-16) and benchmark each design function against a
   published worked example (A-17): beam, column interaction, two-way slab DDM, punching with studs, pile cap STM.
2. Bar bending schedule (page 05) from the ~1,600 rebar elements: marks, ACI shape codes, cut lengths, masses.
3. One engine model for the whole frame (slab as plates, columns, beams) to replace DDM and the tributary
   takedown, gated against DDM where DDM applies.
4. Clash detection between bars of meeting elements (column cages through slab mats, cap mats and dowels).
**Milestone 13 as first planned (kept for reference; steps 2–5 are now built for a typed beam):**
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
