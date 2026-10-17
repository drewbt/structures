# Next action

**The single highest-value step:** decide the candidate (SOURCES.md: Section Haus is a renovation with
precast pillars; Concreto House and Raw Concrete House are new builds), then import its plan and
section on a machine that can reach the page (page 00 → Import), verify the snippet facts against the
page, and trace. That closes A-01 and makes milestone 12 complete on a real drawing rather than the
fixture.

**Then, milestone 13 (first structural component), in this order:**
1. Pick the traced ground-floor slab (S1) or the south wall (W1).
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
