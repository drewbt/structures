// build-static.mjs - build the published (static) copy of Coral into dist/static.
//
//   node tools/build-static.mjs [path/to/coral-service] [path/to/stiffness]
//
// A development tool (DECISIONS D-02). It runs the real service and engine once, in headless Chromium:
//   1. the reference frame: create → design all → create foundations → design all → generate reinforcement;
//      the resulting model is the seed the published page opens with (seed.json);
//   2. every beam analysis that run asked of the engine, plus the default cantilever of "+ Beam", is stored as
//      engine-cache.json, keyed exactly as the service keys results (SHA-256 of the model text);
//   3. the app's files are copied beside an index page that sets window.CORAL_STATIC, so the app uses
//      core/api-local.js (browser storage, cached engine results) instead of the service.
// The engine's results are numbers produced by the engine binary named in the cache; no engine code ships.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const service = process.argv[2] || join(root, 'build', 'coral-service'), engine = process.argv[3] || process.env.STIFFNESS_BIN || '/home/user/stiffness/build/stiffness';
if (!existsSync(engine)) { console.error(`engine not found: ${engine}`); process.exit(2); }
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x.js'))('playwright');
const out = join(root, 'dist', 'static'), db = join(root, 'dist', 'build-static.db');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true }); for (const f of [db, db + '-wal', db + '-shm']) rmSync(f, { force: true });
const port = 8800 + Math.floor(Math.random() * 90);
const proc = spawn(service, ['--db', db, '--app', join(root, 'app'), '--port', String(port), '--engine', engine], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { proc.stdout.on('data', d => String(d).includes('http://') && res()); setTimeout(() => rej(new Error('service did not start')), 5000); });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = {}; let engineSha = null;

/** Collect every designed beam's engine model text hash and output from the page. */
async function harvest(page) {
  const got = await page.evaluate(async () => {
    const { sha256 } = await import(`${location.origin}/core/hash.js`);
    return [...coralStructure.designs.values()].filter(d => d.kind === 'beam' && d.analysis).map(d => ({ key: sha256(JSON.stringify(d.bm.engine)), served: d.analysis.model_sha, engine: d.analysis.engine, output: d.analysis.output, name: d.el.name }));
  });
  for (const g of got) { results[g.key] = g.output; engineSha = g.engine; console.log(`  engine result: ${g.name} ${g.key.slice(0, 12)}…`); }
}
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(`http://127.0.0.1:${port}/?project=reference-frame#structure`); await page.waitForFunction(() => globalThis.coralStructure && coral.status.health);
  await page.click('#ref'); await page.waitForFunction(() => coral.model.byType('column').length === 16);
  await page.evaluate(() => coralStructure.designAll()); await page.evaluate(() => coralStructure.createFoundations()); await page.evaluate(() => coralStructure.designAll());
  const n = await page.evaluate(() => coralStructure.generateAll()); await harvest(page);
  const seed = await page.evaluate(() => ({ project: coral.project, created: new Date().toISOString(), elements: coral.model.toWire(), sources: coral.sources, model_hash: coral.model.hash() }));
  console.log(`seed: ${seed.elements.length} elements (${n} bars and rails)`);
  // the default "+ Beam" on the seeded model (first level), and on an empty model (auto-created level)
  await page.click('coral-nav a[href="#architecture"]'); await page.waitForFunction(() => globalThis.coralArch);
  await page.click('#add-beam'); await page.waitForSelector('dialog[open] #ok'); await page.click('dialog[open] #ok'); await page.waitForFunction(() => coral.model.byType('beam').length === 3);
  await page.click('coral-nav a[href="#structure"]'); await page.waitForFunction(() => globalThis.coralStructure && document.querySelector('page-structure') === globalThis.coralStructure); await page.evaluate(() => coralStructure.designAll()); await harvest(page);
  const p2 = await browser.newPage(); await p2.goto(`http://127.0.0.1:${port}/?project=empty-probe#architecture`); await p2.waitForFunction(() => globalThis.coralArch && coral.status.health);
  await p2.click('#add-beam'); await p2.waitForSelector('dialog[open] #ok'); await p2.click('dialog[open] #ok'); await p2.waitForFunction(() => coral.model.byType('beam').length === 1);
  await p2.click('coral-nav a[href="#structure"]'); await p2.waitForFunction(() => globalThis.coralStructure && document.querySelector('page-structure') === globalThis.coralStructure); await p2.evaluate(() => coralStructure.designAll()); await harvest(p2);
  // assemble
  cpSync(join(root, 'app'), out, { recursive: true });
  rmSync(join(out, 'index.html'));
  writeFileSync(join(out, 'page.html'), `<title>Coral Concrete</title>
<link rel="stylesheet" href="style.css">
<script>window.CORAL_STATIC = true;</script>
<script type="module" src="main.js"></script>
<coral-app></coral-app>
<noscript>Coral Concrete needs JavaScript.</noscript>
`);
  writeFileSync(join(out, 'seed.json'), JSON.stringify(seed));
  writeFileSync(join(out, 'engine-cache.json'), JSON.stringify({ engine: engineSha, built: new Date().toISOString(), note: 'outputs of the stiffness engine binary with this SHA-256, keyed by the SHA-256 of the model text', results }));
  console.log(`engine results: ${Object.keys(results).length}; wrote ${out}`);
} finally { await browser.close(); proc.kill(); }
