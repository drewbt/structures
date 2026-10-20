// optimise-comfort.mjs - height and form for comfort: the tallest tower whose 10-year peak accelerations, along-
// and across-wind, are at most COMFORT_MG, and which passes every code-route check. Four workers, each running
// full tower models through the engine binary (tools/optimise-tower.mjs evaluate()).
//
//   node tools/optimise-comfort.mjs [--out docs/tower-comfort.json]
//
// The across-wind accelerations come from the NBCC expression outside its calibrated aspect ratio (indicative);
// the margin below the 15 milli-g criterion is there for that uncertainty, and the wind tunnel test confirms.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CRITERIA } from '../app/core/standards/asce7-16-wind.js';
export const COMFORT_MG = CRITERIA.comfort_mg;   // 0.8 × the 15 milli-g residential criterion, margin for the screening method
const GRID = [];
for (const floors of [84, 80, 77, 74, 64, 54]) for (const width of [20, 24, 28, 32]) for (const taperFrac of [50 / 84, 0.4]) for (const tt of [0.6]) for (const dm of [1600, 3200, 4800])
  GRID.push({ floors, width, taperFrac, tube: { thickness: tt, solidity: 0.5 }, damper: { mass: dm } });

if (isMainThread) {
  const N = 4, parts = Array.from({ length: N }, (_, k) => GRID.filter((_, i) => i % N === k)), out = [];
  await Promise.all(parts.map(part => new Promise((res, rej) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: part }); w.on('message', m => { out.push(m); console.log(line(m)); }); w.on('error', rej); w.on('exit', res); })));
  const ok = out.filter(e => e.pass && e.comfort_ok).sort((a, b) => b.H - a.H || a.cost - b.cost);
  const byH = [...new Set(out.map(e => e.floors))].sort((a, b) => b - a).map(f => { const c = out.filter(e => e.floors === f && e.pass && e.comfort_ok).sort((a, b) => a.cost - b.cost)[0]; const best = out.filter(e => e.floors === f && e.pass).sort((a, b) => a.worst_mg - b.worst_mg)[0]; return { floors: f, comfortable: c || null, least_sway: best || null }; });
  console.log('\nby height:'); for (const r of byH) console.log(`  ${r.floors} floors: ${r.comfortable ? 'COMFORTABLE ' + line(r.comfortable) : 'none comfortable; least sway ' + (r.least_sway ? line(r.least_sway) : '—')}`);
  console.log(`\nchosen: ${ok[0] ? line(ok[0]) : 'none'}`);
  const i = process.argv.indexOf('--out');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify({ when: new Date().toISOString(), comfort_mg: COMFORT_MG, note: 'every candidate is a full tower run twice through the stiffness engine; across-wind accelerations are indicative (NBCC expression outside its aspect range); the wind tunnel test confirms', by_height: byH, candidates: out, chosen: ok[0] || null }, null, 1));
} else {
  const { evaluate } = await import('./optimise-tower.mjs'); const { towerForm } = await import('../app/core/tower.js');
  for (const g of workerData) {
    try {
      const o = towerForm(g), e = await evaluate(o), acc = e.r.checks.filter(c => /acceleration/.test(c.name)).map(c => ({ name: c.name, mg: c.demand, indicative: !!c.indicative }));
      const worst = Math.max(...acc.map(a => a.mg));
      parentPort.postMessage({ ...g, H: e.r.frame.height, opts: { floors: o.floors, width: o.width, taper_from: o.taper.from, tube: o.tube, damper: o.damper, mechanical: o.mechanical.floors },
        cost: e.cost, pass: e.pass, comfort_ok: worst <= COMFORT_MG, worst_mg: worst, acc, nx: e.r.res.x.mode.n, ny: e.r.res.y.mode.n, governing: { name: e.r.governing.name, util: e.r.governing.util }, area: e.area });
    } catch (err) { parentPort.postMessage({ ...g, error: err.message, pass: false, comfort_ok: false, worst_mg: Infinity, cost: Infinity, H: 0 }); }
  }
}
function line(e) { return e.error ? `error ${e.floors}/${e.width}: ${e.error}` : `${e.pass ? 'PASS' : 'fail'}${e.comfort_ok ? '+comfort' : '        '} H ${e.H.toFixed(0)} m (${e.floors} fl) W ${e.width} taper@${e.opts.taper_from} tube ${e.tube.thickness} TMD ${e.damper.mass} t | nx ${e.nx.toFixed(3)} ny ${e.ny.toFixed(3)} | worst ${e.worst_mg.toFixed(1)} mg | ${Math.round(e.cost)} m³eq | gov ${e.governing.name.slice(0, 50)} ${e.governing.util.toFixed(2)}`; }
