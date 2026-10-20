// optimise-site.mjs - height and organic form of the Park Lane study for comfort, through the engine. Each candidate
// is the full site tower (app/core/sitetower.js) on the real lot among the real neighbours; forms whose plates leave
// the lot or cannot contain the structure are refused by the generator and reported as such.
//
//   node tools/optimise-site.mjs [--out docs/park-lane-comfort.json]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CRITERIA } from '../app/core/standards/asce7-16-wind.js';

const GRID = [];
for (const floors of [40, 46, 52, 58, 64]) for (const twistDeg of [45, 90]) for (const taper of [0.62, 0.7]) for (const tubeSolidity of [0.5, 0.7]) for (const tubeScale of [1.0, 1.15, 1.35]) for (const damper of [1600, 3200])
  GRID.push({ floors, plan: { twistDeg, taper }, tubeSolidity, tubeScale, damper });

if (isMainThread) {
  const N = 4, parts = Array.from({ length: N }, (_, k) => GRID.filter((_, i) => i % N === k)), out = [];
  await Promise.all(parts.map(part => new Promise((res, rej) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: part }); w.on('message', m => { out.push(m); console.log(line(m)); }); w.on('error', rej); w.on('exit', res); })));
  const ok = out.filter(e => e.pass && e.comfort_ok).sort((a, b) => (a.indicative > 0) - (b.indicative > 0) || b.H - a.H || a.cost - b.cost);   // across-wind inside the method's range first, then the tallest, then the least concrete
  const byH = [...new Set(out.map(e => e.floors))].sort((a, b) => b - a).map(f => ({ floors: f, comfortable: out.filter(e => e.floors === f && e.pass && e.comfort_ok).sort((a, b) => (a.indicative > 0) - (b.indicative > 0) || a.cost - b.cost)[0] || null, least_sway: out.filter(e => e.floors === f && !e.error).sort((a, b) => a.worst_mg - b.worst_mg)[0] || null }));
  console.log('\nby height:'); for (const r of byH) console.log(`  ${r.floors} floors: ${r.comfortable ? 'COMFORTABLE ' + line(r.comfortable) : 'none; least sway ' + (r.least_sway ? line(r.least_sway) : '—')}`);
  console.log(`\nchosen: ${ok[0] ? line(ok[0]) : 'none'}`);
  const i = process.argv.indexOf('--out');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify({ when: new Date().toISOString(), site: 'Park Lane Hotel footprint, 36 Central Park South (OpenStreetMap)', comfort_mg: CRITERIA.comfort_mg, note: 'every candidate is the full site tower run twice through the stiffness engine', by_height: byH, candidates: out, chosen: ok[0] || null }, null, 1));
} else {
  const { evaluate } = await import('./optimise-tower.mjs'); const { createSiteTower } = await import('../app/core/sitetower.js');
  const site = JSON.parse(readFileSync(new URL('../app/data/site-park-lane.json', import.meta.url), 'utf8'));
  for (const g of workerData) {
    try {
      const e = await evaluate(g, { create: (app, o) => createSiteTower(app, site, o) }), acc = e.r.checks.filter(c => /acceleration/.test(c.name)).map(c => ({ name: c.name, mg: c.demand, indicative: !!c.indicative }));
      const worst = Math.max(...acc.map(a => a.mg));
      parentPort.postMessage({ ...g, H: e.r.frame.height, cost: e.cost, pass: e.pass, comfort_ok: worst <= CRITERIA.comfort_mg, worst_mg: worst, acc, nx: e.r.res.x.mode.n, ny: e.r.res.y.mode.n, governing: { name: e.r.governing.name, util: e.r.governing.util }, indicative: e.r.indicative.length });
    } catch (err) { parentPort.postMessage({ ...g, error: err.message, pass: false, comfort_ok: false, worst_mg: Infinity, cost: Infinity, H: 0 }); }
  }
}
function line(e) { return e.error ? `refused ${e.floors} fl twist ${e.plan.twistDeg} taper ${e.plan.taper}: ${e.error.slice(0, 80)}` : `${e.pass ? 'PASS' : 'fail'}${e.comfort_ok ? '+comfort' : '        '} H ${e.H.toFixed(0)} m (${e.floors} fl) twist ${e.plan.twistDeg} taper ${e.plan.taper} tube ×${e.tubeScale} sol ${e.tubeSolidity} TMD ${e.damper} | n ${e.nx.toFixed(3)}/${e.ny.toFixed(3)} | worst ${e.worst_mg.toFixed(1)} mg${e.indicative ? ` (${e.indicative} indicative)` : ''} | ${Math.round(e.cost)} m³ | gov ${e.governing.name.slice(0, 44)} ${e.governing.util.toFixed(2)}`; }
