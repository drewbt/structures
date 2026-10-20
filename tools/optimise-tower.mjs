// optimise-tower.mjs - wind and vibration of the needle tower through the stiffness engine, and a search over
// its form and lateral system for the least concrete that passes every check the tools can make.
//
//   node tools/optimise-tower.mjs [--baseline] [--out docs/tower-wind.json]
//
// Each candidate is a full tower model (app/core/tower.js) regenerated in Node, its lateral frame
// (app/core/towerdyn.js) run twice through the engine binary (modes; then wind and gravity cases), and checked
// (tower.windChecks). Nothing here is approximated outside those functions; the search only chooses inputs.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Model } from '../app/core/model.js';
import '../app/core/functions.js';
import { createNeedleTower, gravityInputs, towerGravity, TOWER_DEFAULTS } from '../app/core/tower.js';
import { analyseTower } from '../app/core/towerdyn.js';

const BIN = process.env.STIFFNESS_BIN || '/home/user/stiffness/build/stiffness', dir = mkdtempSync(join(tmpdir(), 'tower-'));
let runs = 0;
const run = async eng => { const i = join(dir, 'm.json'), o = join(dir, 'r.json'); writeFileSync(i, JSON.stringify(eng)); try { execFileSync(BIN, [i, '-o', o, '--compact'], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (err) { throw new Error(`engine: ${String(err.stderr).trim().slice(0, 300)}`); } runs++; return JSON.parse(readFileSync(o, 'utf8')); };

export async function evaluate(opts, { create = (app, o) => createNeedleTower(app, o) } = {}) {
  const m = new Model('opt'), app = { model: m, regenerate() { return m.regenerate(); } };
  create(app, opts);
  const r = await analyseTower(m, run, { gravityInputs, towerGravity });
  const concrete = gravityInputs(m).concrete_m3, dmass = typeof opts.damper === 'number' ? opts.damper : opts.damper?.mass ?? 0;
  const pass = r.checks.filter(c => !c.indicative).every(c => c.util <= 1), across = r.indicative.map(c => c.util);
  return { opts, concrete, damper_t: dmass, cost: concrete + dmass / 2.4, pass, across_ok: across.every(u => u <= 1), r };
}

const fmt = e => `${e.pass ? 'PASS' : 'fail'}${e.across_ok ? '+' : ' '} ${e.cost.toFixed(0).padStart(6)} m³eq  W ${e.opts.width} wall×${e.opts.wallScale} tube ${e.opts.tube ? e.opts.tube.thickness : '-'} out[${e.opts.outriggers.floors}]@${e.opts.outriggers.thickness} TMD ${e.damper_t} t | nx ${e.r.res.x.mode.n.toFixed(3)} ny ${e.r.res.y.mode.n.toFixed(3)} | gov ${e.r.governing.name.slice(0, 60)} ${e.r.governing.util.toFixed(2)} | across ${e.r.indicative.map(c => c.util.toFixed(2)).join('/')}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = { ...TOWER_DEFAULTS, width: 18, wallScale: 1.0, tube: null, outriggers: { floors: [], thickness: 0.8 }, damper: { mass: 0 } };   // the search starts from the bare 24:1 tower
  const b = await evaluate(base); console.log('baseline:', fmt(b));
  for (const c of b.r.checks) console.log(`  ${c.util <= 1 ? 'ok ' : 'NG '} ${c.util.toFixed(3)}  ${c.name}`);
  console.log('  modes', b.r.modes.map(q => `${q.n.toFixed(3)}${q.dir}`).join(' '), '| Gf', JSON.stringify(b.r.gf), '| engine runs', runs);
  if (!process.argv.includes('--baseline')) {
    const out = [], M = TOWER_DEFAULTS.mechanical.floors;
    for (const width of [18, 20, 22]) for (const wallScale of [0.8, 1.0]) for (const tube of [null, { thickness: 0.6, solidity: 0.5 }, { thickness: 0.8, solidity: 0.5 }]) for (const outr of [[], [M[1], M[3]], M]) for (const tmd of [0, 800, 1600]) {
      const o = { ...base, width, wallScale, tube, outriggers: { floors: outr, thickness: 0.8 }, damper: { mass: tmd } };
      try { const e = await evaluate(o); out.push(e); process.stdout.write(`${fmt(e)}\n`); } catch (err) { console.log('error', JSON.stringify({ width, wallScale, tube, outr, tmd }), err.message); }
    }
    const passing = out.filter(e => e.pass).sort((a, b) => a.cost - b.cost);
    const best = passing.find(e => e.across_ok) || passing[0];
    console.log(`\n${passing.length} of ${out.length} pass the code-route checks; ${passing.filter(e => e.across_ok).length} also pass the indicative across-wind screen; ${runs} engine runs`);
    if (best) console.log('chosen:', fmt(best));
    const i = process.argv.indexOf('--out');
    if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify({ when: new Date().toISOString(), engine_runs: runs, candidates: out.map(e => ({ opts: e.opts, cost: e.cost, pass: e.pass, across_ok: e.across_ok, nx: e.r.res.x.mode.n, ny: e.r.res.y.mode.n, governing: e.r.governing, indicative: e.r.indicative, checks: e.r.checks })), chosen: best ? best.opts : null }, null, 1));
  }
}
