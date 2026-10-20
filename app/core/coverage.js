// coverage.js - every chapter of ASCE 7-16 considered on every design run. Each row says whether the chapter
// was APPLIED (with what it found), is NOT APPLICABLE (and why), or is OWED (it applies and Coral has not done
// it). Nothing is skipped silently: a chapter that applies and has no result is owed, never omitted.
//
// ctx: { kind: 'tower' | 'frame', tower?: the tower analysis, extras?: tower extras (snow, buoyancy, cladding,
// integrity), site?: { flood_zone } }.

const A = (ch, title, note) => ({ ch, title, status: 'applied', note });
const NA = (ch, title, note) => ({ ch, title, status: 'not applicable', note });
const OWED = (ch, title, note) => ({ ch, title, status: 'owed', note });
const f = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));

export function asceCoverage(ctx) {
  const t = ctx.tower, x = ctx.extras, tower = ctx.kind === 'tower';
  const rows = [];
  rows.push(tower && x ? A('1', 'General: risk category, serviceability, structural integrity', `Risk Category II. 1.4.3 notional lateral load 0.01 W per level: largest ratio of its storey shear to the ultimate wind storey shear ${f(x.integrity.ratio, 3)} (${x.integrity.ratio <= 1 ? 'enveloped by wind' : 'NOT enveloped'}).`)
    : OWED('1', 'General: structural integrity', '1.4 integrity load cases are not run for this model.'));
  rows.push(tower ? A('2', 'Load combinations', 'Strength 2.3: 1.4D; 1.2D + 1.6L + 0.5S; 1.2D + 1.6S + L; 1.2D + 1.0W + L + 0.5S; 0.9D + 1.0W; (1.2 + 0.2SDS)D + E + 0.5L; (0.9 − 0.2SDS)D + E. Allowable 2.4 for the mat: D + 0.6W, 0.6D + 0.6W, (0.6 − 0.14SDS)D + 0.7E, 0.6D + H. Live load at 0.5 in wind and earthquake combinations (2.3.1 exception, L ≤ 4.79 kPa).')
    : A('2', 'Load combinations', 'Gravity strength combinations 1.4D and 1.2D + 1.6L applied to slabs, beams, columns and caps; wind and earthquake combinations not run for this model (see 26-27, 11-12).'));
  rows.push(tower && x ? A('3', 'Dead, soil and hydrostatic loads', `Dead load from the modelled concrete (24 kN/m³) and stated superimposed dead. Hydrostatic uplift on the mat: head ${f(x.buoyancy.head, 1)} m, ${f(x.buoyancy.H / 1000, 0)} MN against 0.6D ${f(0.6 * x.buoyancy.D / 1000, 0)} MN (util ${f(x.buoyancy.util, 3)}). Lateral earth and water pressure on the cellar walls: OWED (wall design not done).`)
    : A('3', 'Dead loads', 'Dead load from modelled concrete; soil and hydrostatic loads not applicable to the modelled elements or not modelled.'));
  rows.push(A('4', 'Live loads', tower ? 'Stated live loads on every floor, no reduction (4.7 permits it; not taking it is conservative). Floor vibration (serviceability) is OWED.' : 'Stated live loads; patterned on continuous members (6.4.2 ACI); no reduction.'));
  rows.push(ctx.site?.flood_zone ? OWED('5', 'Flood loads', `site in flood zone ${ctx.site.flood_zone}: flood loads not implemented`) : NA('5', 'Flood loads', tower ? 'The site is taken as outside the FEMA Special Flood Hazard Area (Central Park South is well above the coastal flood zones); confirm on the current FIRM.' : 'No flood zone stated for this site (assumed outside the SFHA).'));
  rows.push(NA('6', 'Tsunami loads', 'ASCE 7-16 Chapter 6 applies in Alaska, Washington, Oregon, California and Hawaii only.'));
  rows.push(tower && x ? A('7', 'Snow loads', `pg ${f(x.snow.pg, 2)} kPa (map value, unverified): flat roof pf ${f(x.snow.pf, 2)} kPa (minimum ${f(x.snow.pm, 2)} governs: ${x.snow.pm >= x.snow.pf0 ? 'yes' : 'no'}); setback terraces: drift up to ${f(x.snow.drift.hd, 2)} m deep (${x.snow.drift.governs}), surcharge ${f(x.snow.drift.pd, 2)} kPa over ${f(x.snow.drift.w, 1)} m. Total S ${f(x.snow.S_kN / 1000, 2)} MN, in the combinations.`)
    : OWED('7', 'Snow loads', 'Roof snow not computed for this model.'));
  rows.push(OWED('8', 'Rain loads', 'Roof drainage (primary and secondary drains, design rain depth) is not modelled; concrete roofs are not susceptible to ponding instability (8.4), but the rain load itself is owed.'));
  rows.push(NA('10', 'Ice loads (atmospheric icing)', 'Chapter 10 applies to ice-sensitive structures (lattice towers, cables, guys); buildings are not ice-sensitive. Ice falling from the crown is a hazard outside ASCE 7.'));
  rows.push(tower && t?.seismic ? A('11', 'Seismic design criteria', `Ss ${t.seis.Ss} g, S1 ${t.seis.S1} g (unverified), site class ${t.seis.site_class}: SDS ${f(t.seismic.elf.SDS, 3)}, SD1 ${f(t.seismic.elf.SD1, 3)}, SDC ${t.seismic.elf.sdc}, Ie ${t.seis.Ie}.`)
    : OWED('11', 'Seismic design criteria', 'No seismic site stated for this model.'));
  rows.push(tower && t?.seismic ? A('12', 'Seismic design requirements for buildings', `${t.seismic.elf.system.name}, R ${t.seismic.elf.system.R}, Cd ${t.seismic.elf.system.Cd}; ELF permitted in SDC B (Table 12.6-1); T capped at Cu·Ta ${f(t.seismic.elf.CuTa, 2)} s; base shear ${f(t.seismic.elf.x.V / 1000, 1)} MN (Cs ${f(t.seismic.elf.x.Cs, 4)}); drift, stability coefficient, base stresses and mat overturning checked; accidental torsion 5 %. Irregularities (12.3): setbacks under 130 % of the storey below; restrictions of 12.3.3 apply from SDC D.`)
    : OWED('12', 'Seismic design requirements for buildings', 'Equivalent lateral force not run for this model.'));
  rows.push(tower ? OWED('13', 'Nonstructural components', 'SDC B exempts mechanical and electrical components and most architectural components (13.1.4), but not parapets braced by walls: the crown fins and the damper anchorage need 13.3 forces. OWED.')
    : NA('13', 'Nonstructural components', 'No nonstructural components modelled.'));
  rows.push(OWED('14', 'Material-specific seismic design and detailing', tower ? 'ACI 318-19 Chapter 18 / 11 design of the walls and coupling elements is not done (screening stresses only).' : 'ACI 318-19 detailing applied to the designed members (unverified ruleset); seismic-specific detailing not required in SDC A/B for these members.'));
  rows.push(NA('15', 'Nonbuilding structures', 'The model is a building.'));
  rows.push(NA('16', 'Nonlinear response history analysis', 'Optional procedure; not required in SDC B.'));
  rows.push(NA('17', 'Seismically isolated structures', 'No isolation system.'));
  rows.push(NA('18', 'Structures with damping systems', tower ? 'The tuned mass damper is credited for wind only, not for earthquake; Chapter 18 applies when damping is used to reduce seismic design forces.' : 'No damping system.'));
  rows.push(NA('19', 'Soil-structure interaction', 'Optional; fixed base on rock taken.'));
  rows.push(tower ? A('20', 'Site classification', `Site class ${t?.seis?.site_class ?? '—'} on Manhattan schist ASSUMED: class B requires a measured shear-wave velocity (20.3); without it class C or the default applies and the spectrum rises.`)
    : OWED('20', 'Site classification', 'No seismic site class stated.'));
  rows.push(NA('21', 'Site-specific ground motion procedures', 'Not required for SDC B (11.4.8 triggers apply to site class F and to long-period structures in higher SDC).'));
  rows.push(tower ? A('22', 'Seismic ground motion and long-period maps', 'TL 6 s for New York (Figure 22-14), from memory: unverified.') : OWED('22', 'Seismic maps', 'Not read for this model.'));
  rows.push(tower && t ? A('26', 'Wind loads: general requirements', `V ${t.site.V} m/s (10-year ${t.site.V10} m/s), Exposure ${t.site.exposure}, Kd 0.85, Kzt 1.0, Gf from the engine's frequencies (x ${f(t.gf.ultimate.x, 3)}, y ${f(t.gf.ultimate.y, 3)}).`)
    : OWED('26', 'Wind loads: general requirements', 'Wind not run for this model.'));
  rows.push(tower && t ? A('27', 'Wind loads on buildings: MWFRS, directional procedure', 'Cases 1 and 2 (torsion) analysed in the engine; strength, drift, acceleration and the mat checked. The procedure is outside its scope for this building (27.1.3: across-wind and vortex shedding), so its results are screening and Chapter 31 governs.')
    : OWED('27', 'Wind loads on buildings: MWFRS', 'Wind not run for this model.'));
  rows.push(NA('28', 'Wind loads on buildings: MWFRS, envelope procedure', 'Low-rise buildings only (h ≤ 18 m).'));
  rows.push(tower ? OWED('29', 'Wind loads on other structures and building appurtenances', 'The crown fins are in the MWFRS bands; their own net pressure as parapets (27.3.4) and rooftop equipment (29.4) are OWED.') : NA('29', 'Other structures and appurtenances', 'None modelled.'));
  rows.push(tower && x ? A('30', 'Wind loads: components and cladding', `Part 3 (h > 18 m), smallest glazing units: field (zone 4) +${f(x.cladding.zone4.positive, 2)} / ${f(x.cladding.zone4.negative, 2)} kPa, corners (zone 5) +${f(x.cladding.zone5.positive, 2)} / ${f(x.cladding.zone5.negative, 2)} kPa at qh ${f(x.cladding.qh, 2)} kPa: design pressures for the facade, subject to the wind tunnel test (Ch. 31).`)
    : OWED('30', 'Components and cladding', 'Not computed for this model.'));
  rows.push(tower ? OWED('31', 'Wind tunnel procedure', 'REQUIRED for this tower (27.1.3, 31.1): across-wind response, vortex shedding and cladding pressures must come from a boundary-layer wind tunnel test. Coral\'s own tunnel is not built; this is the outstanding route to compliance.')
    : NA('31', 'Wind tunnel procedure', 'Not required for this low, regular structure.'));
  rows.push(tower && t ? A('App. C', 'Serviceability', `Drift H/500 and storey h/400 under the 10-year wind; peak acceleration 15 milli-g (project criteria).`) : OWED('App. C', 'Serviceability', 'Deflection limits applied to members (ACI); building drift not computed.'));
  rows.push(tower ? A('App. D', 'Buildings exempted from torsional wind load cases', 'Not used: torsional Case 2 is analysed.') : NA('App. D', 'Torsional wind exemptions', 'Wind not run.'));
  return rows;
}
