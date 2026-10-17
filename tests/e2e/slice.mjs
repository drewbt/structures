// slice.mjs - the first-milestone acceptance run (REQUIREMENTS §12), end to end, on the real app:
// the real service binary on a temporary SQLite file, headless Chromium (software WebGL), real
// pointer clicks on the trace canvas at known fixture pixels, real property edits, Save, reload.
// Every assertion is a milestone criterion. Exit 0 all pass.
//
//   node tests/e2e/slice.mjs [path/to/coral-service]
// Needs Playwright (module path via PLAYWRIGHT_DIR, default /opt/node-tools/node_modules) and the
// Chromium it is configured for. Screenshots go to tests/e2e/out/.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); const root = resolve(here, '..', '..');
const req = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x.js'));
const { chromium } = req('playwright');

let passes = 0, fails = 0;
function check(ok, what, evidence = '') { console.log(`${ok ? 'pass' : 'FAIL'}  ${what}${evidence ? ': ' + evidence : ''}`); ok ? passes++ : fails++; }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const service = process.argv[2] || join(root, 'build', 'coral-service');
const port = 8900 + Math.floor(Math.random() * 100);
const out = join(here, 'out'); mkdirSync(out, { recursive: true });
const db = join(out, `e2e-${port}.db`); for (const f of [db, db + '-wal', db + '-shm']) if (existsSync(f)) rmSync(f);
const proc = spawn(service, ['--db', db, '--app', join(root, 'app'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => { proc.stdout.on('data', d => { if (String(d).includes('http://')) res(); }); proc.on('exit', c => rej(new Error('service exited ' + c))); setTimeout(() => rej(new Error('service did not start')), 5000); });
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

try {
  // ---- 00 Source --------------------------------------------------------------------------------------
  await page.goto(`${base}/?project=e2e#source`);
  await page.waitForFunction(() => globalThis.coral?.status?.health, null, { timeout: 10000 });
  check(await page.evaluate(() => coral.status.health.ok === true), 'the app reached the service', await page.evaluate(() => JSON.stringify(coral.status.health)));
  await page.click('#reg-archdaily'); await page.waitForFunction(() => coral.sources.length === 1);
  await page.click('#reg-habs'); await page.waitForFunction(() => coral.sources.length === 2);
  check(await page.evaluate(() => coral.sources.find(s => s.kind === 'habs')?.meta?.sheets?.length === 9), 'HABS Fallingwater source registered with its sheet register');
  await page.click('#reg-fixture'); await page.waitForFunction(() => coral.sources.length === 3 && coral.model.byType('drawing').length === 1);
  const srcText = await page.locator('page-source').innerText();
  check(srcText.includes('not-acquired') && srcText.includes('archdaily.com/975178'), 'ArchDaily source registered with URL, attribution and not-acquired status');
  check(srcText.includes('synthetic') && srcText.includes('SYNTHETIC') === false, 'fixture source registered and marked synthetic');
  check(await page.evaluate(() => coral.model.byType('level').length === 1 && coral.model.byType('level')[0].provenance.method === 'assumed'), 'a Ground level exists and is marked assumed');

  // ---- 01 Trace ---------------------------------------------------------------------------------------
  await page.click('coral-nav a[href="#trace"]');
  await page.waitForFunction(() => globalThis.coralTrace && coralTrace.imgLoaded === true, null, { timeout: 10000 });
  check(await page.evaluate(() => coralTrace.img.naturalWidth === 1400 && coralTrace.img.naturalHeight === 1000), 'the drawing image is loaded and displayed on the trace canvas', '1400 x 1000');
  const clickImg = async (px, opts = {}) => {
    const [x, y] = await page.evaluate(px => { const t = coralTrace; const r = t.canvas.getBoundingClientRect(); const s = t.imageToScreen(px); return [s[0] + r.left, s[1] + r.top]; }, px);
    await page.mouse.move(x, y); await page.mouse.click(x, y, opts);
  };
  const tool = t => page.click(`.toolbar [data-tool="${t}"]`);
  // calibrate on the 5 m scale bar
  await tool('calibrate'); await clickImg([700, 970]); await clickImg([1200, 970]);
  await page.waitForSelector('dialog[open] #dist'); await page.fill('dialog[open] #dist', '5'); await page.click('dialog[open] #ok');
  await page.waitForFunction(() => coral.model.result(coralTrace.drawing.id)?.scale);
  const scale = await page.evaluate(() => coral.model.result(coralTrace.drawing.id).scale);
  check(near(scale, 0.01, 1e-12), 'scale calibration: 500 px for 5 m gives 0.01 m/px', String(scale));
  check(await page.evaluate(() => JSON.stringify(coralTrace.drawing.params.cal_p1.value) === '[700,970]' && coralTrace.drawing.params.cal_distance.value === 5), 'the calibration measurement itself is stored on the drawing (points and distance)');
  // origin at the SW corner
  await tool('origin'); await clickImg([150, 850]);
  check(await page.evaluate(() => JSON.stringify(coralTrace.drawing.params.origin_px.value)) === '[150,850]', 'origin set to the clicked pixel');
  // walls: south (snaps orthogonal), west (snaps to the existing end point)
  await tool('wall'); await clickImg([150, 850]); await clickImg([1350, 851]);
  await clickImg([153, 848]); await clickImg([150, 50]);
  const walls = await page.evaluate(() => coral.model.byType('wall').map(w => ({ name: w.name, start: w.params.start.value, end: w.params.end.value, t: w.params.thickness.value, prov: w.provenance })));
  check(walls.length === 2, 'two walls traced', JSON.stringify(walls.map(w => [w.start, w.end])));
  check(walls[0] && JSON.stringify(walls[0].start) === '[0,0]' && JSON.stringify(walls[0].end) === '[12,0]' && walls[0].t === 0.2, 'W1 is 12.000 m along x from the origin, 200 thick (orthogonal snap absorbed the 1 px slip)', JSON.stringify(walls[0]));
  check(walls[1] && JSON.stringify(walls[1].start) === '[0,0]' && JSON.stringify(walls[1].end) === '[0,8]', 'W2 snapped to W1\'s start and runs 8.000 m along y', JSON.stringify(walls[1]));
  check(walls[0]?.prov?.method === 'measured' && /^trace-/.test(walls[0]?.prov?.trace || '') && walls[0]?.prov?.source === 'src-fixture-plan-v1', 'traced walls carry provenance: measured, trace id, source id', JSON.stringify(walls[0]?.prov));
  // column at world (3,4)
  await tool('column'); await clickImg([450, 450]);
  const col = await page.evaluate(() => coral.model.byType('column').map(c => c.params.center.value));
  check(JSON.stringify(col) === '[[3,4]]', 'column centre traced at (3.000, 4.000)', JSON.stringify(col));
  // slab outline, closed with Enter
  await tool('slab'); for (const p of [[150, 850], [1350, 850], [1350, 50], [150, 50]]) await clickImg(p);
  await page.click('#finish');
  const slab = await page.evaluate(() => coral.model.byType('slab').map(s => ({ outline: s.params.outline.value, area: coral.model.result(s.id)?.area_m2 })));
  check(slab.length === 1 && near(slab[0].area, 96, 1e-9), 'slab polygon traced: 12 x 8 = 96.000 m²', JSON.stringify(slab));
  // a door on the south wall at 1.0 m
  await tool('opening'); await clickImg([250, 850]);
  const op = await page.evaluate(() => coral.model.byType('opening').map(o => ({ host: coral.model.get(o.params.host.value)?.name, offset: o.params.offset.value, width: o.params.width.value })));
  check(op.length === 1 && op[0].host === 'W1' && near(op[0].offset, 1.0, 1e-9) && near(op[0].width, 0.9, 1e-12), 'opening traced on W1 at 1.000 m, 900 wide', JSON.stringify(op));
  const w1vol = await page.evaluate(() => coral.model.result(coral.model.byType('wall')[0].id).volume_m3);
  check(near(w1vol, (12 * 3 - 0.9 * 2.1) * 0.2, 1e-9), 'W1 volume has the door cut out: (12·3 − 0.9·2.1)·0.2', String(w1vol));
  // re-derivation: correct the calibration distance and every traced component follows
  await page.evaluate(() => { coral.model.set(coralTrace.drawing.id, 'cal_distance', 10); coral.app?.regenerate?.(); coral.regenerate(); coralTrace.rederive(); });
  const w1b = await page.evaluate(() => coral.model.byType('wall')[0].params.end.value);
  check(JSON.stringify(w1b) === '[24,0]', 'changing the calibration distance to 10 m re-derives W1 to 24.000 m', JSON.stringify(w1b));
  await page.evaluate(() => { coral.model.set(coralTrace.drawing.id, 'cal_distance', 5); coral.regenerate(); coralTrace.rederive(); });
  check(JSON.stringify(await page.evaluate(() => coral.model.byType('wall')[0].params.end.value)) === '[12,0]', 'and back to 5 m restores 12.000 m');
  await page.screenshot({ path: join(out, 'trace.png') });

  // ---- 02 Architecture --------------------------------------------------------------------------------
  await page.click('coral-nav a[href="#architecture"]');
  await page.waitForFunction(() => globalThis.coralArch?.viewer && coralArch.items?.length >= 4, null, { timeout: 10000 });
  await page.waitForFunction(() => coralArch.viewer.frames > 0);
  check(await page.evaluate(() => coralArch.items.length) === 4, '3D model generated: 2 walls, 1 column, 1 slab as solids');
  const picked = await page.evaluate(() => { const v = coralArch.viewer, r = v.canvas.getBoundingClientRect(); const ids = new Set(); for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) { const id = v.pick(r.width * i / 10, r.height * j / 10); if (id) ids.add(id); } return [...ids].map(id => coral.model.get(id).type); });
  check(picked.length >= 2, 'WebGL renders and the pick pass identifies elements under the cursor', picked.join(','));
  const treeText = await page.locator('coral-tree').innerText();
  check(treeText.includes('Walls (2)') && treeText.includes('Columns (1)') && treeText.includes('Slabs (1)') && treeText.includes('Openings (1)') && treeText.includes('Drawings (1)'), 'model tree shows the components under their level', treeText.replace(/\s+/g, ' ').slice(0, 120));
  // edit a parameter in the properties panel
  const w1id = await page.evaluate(() => coral.model.byType('wall')[0].id);
  await page.click(`coral-tree .node[data-id="${w1id}"] .label`);
  await page.waitForSelector('coral-properties input[data-k="thickness"]');
  check(await page.inputValue('coral-properties input[data-k="thickness"]') === '200', 'thickness shown in mm');
  await page.fill('coral-properties input[data-k="thickness"]', '250'); await page.press('coral-properties input[data-k="thickness"]', 'Tab');
  await page.waitForFunction(id => coral.model.get(id).params.thickness.value === 0.25, w1id);
  const regen = await page.evaluate(() => coral.lastRegenerate);
  check(regen.recomputed.length === 1 && regen.recomputed[0] === w1id && regen.cached.length === 0, 'editing W1 thickness recomputed W1 only', JSON.stringify(regen));
  check(near(await page.evaluate(id => coral.model.result(id).volume_m3, w1id), (12 * 3 - 0.9 * 2.1) * 0.25, 1e-9), 'W1 volume follows the new thickness');
  // level height propagates to walls and column, slab served from cache
  const lvl = await page.evaluate(() => coral.model.byType('level')[0].id);
  await page.click(`coral-tree .node[data-id="${lvl}"] .label`);
  await page.fill('coral-properties input[data-k="height"]', '3500'); await page.press('coral-properties input[data-k="height"]', 'Tab');
  await page.waitForFunction(id => coral.model.get(id).params.height.value === 3.5, lvl);
  const regen2 = await page.evaluate(() => ({ r: coral.lastRegenerate.recomputed.map(id => coral.model.get(id).type).sort(), c: coral.lastRegenerate.cached.map(id => coral.model.get(id).type) }));
  check(JSON.stringify(regen2.r) === '["column","wall","wall"]' && JSON.stringify(regen2.c) === '["slab"]', 'level height change regenerated walls and column; slab came from cache', JSON.stringify(regen2));
  check(near(await page.evaluate(() => coral.model.result(coral.model.byType('column')[0].id).volume_m3), 0.3 * 0.3 * 3.5, 1e-9), 'column volume uses the new level height');
  await page.screenshot({ path: join(out, 'architecture.png') });

  // ---- persistence ------------------------------------------------------------------------------------
  const hashBefore = await page.evaluate(() => coral.model.hash());
  const nBefore = await page.evaluate(() => coral.model.elements.size);
  await page.click('coral-nav #save');
  await page.waitForFunction(() => coral.model.rev === 1);
  check(await page.evaluate(() => coral.status.text) === 'saved rev 1', 'Save committed revision 1 to SQLite');
  const hist = await (await fetch(`${base}/api/projects/e2e/history`)).json();
  check(hist.length === 1 && hist[0].model_hash === hashBefore, 'the service\'s model hash for rev 1 equals the browser\'s hash (C++ and JS canonical forms agree on a real model)', hist[0]?.model_hash?.slice(0, 16));
  await page.reload(); await page.waitForFunction(() => globalThis.coral?.model?.rev === 1 && coral.lastRegenerate, null, { timeout: 10000 });
  check(await page.evaluate(() => coral.model.hash()) === hashBefore, 'after reload the model hash is unchanged');
  check(await page.evaluate(() => coral.model.elements.size) === nBefore, `after reload all ${nBefore} elements are back (traces, drawing, level, components)`);
  const w1after = await page.evaluate(id => ({ t: coral.model.get(id).params.thickness, prov: coral.model.get(id).provenance, vol: coral.model.result(id).volume_m3 }), w1id);
  check(w1after.t.value === 0.25 && w1after.t.unit === 'm' && w1after.prov.method === 'measured' && /^trace-/.test(w1after.prov.trace), 'W1 keeps its edited thickness, unit and provenance across reload', JSON.stringify(w1after.prov));
  check(near(w1after.vol, (12 * 3.5 - 0.9 * 2.1) * 0.25, 1e-9), 'W1 regenerates to the same volume from the persisted parameters');
  const eh = await (await fetch(`${base}/api/projects/e2e/elements/${w1id}/history`)).json();
  check(eh.some(r => r.name === 'thickness' && r.value_json === '0.25'), 'the element\'s parameter history in SQLite holds the edit', `${eh.length} rows`);
  const srcAfter = await (await fetch(`${base}/api/projects/e2e/sources`)).json();
  check(srcAfter.length === 3 && srcAfter.find(s => s.kind === 'archdaily')?.status === 'not-acquired' && srcAfter.find(s => s.kind === 'habs')?.status === 'identified', 'sources persisted with their status');
  // export
  await page.click('coral-nav a[href="#architecture"]'); await page.waitForFunction(() => globalThis.coralArch);
  const exp = await page.evaluate(() => coralArch.exportJSON(false));
  const expW1 = exp.elements.find(e => e.id === w1id);
  check(expW1?.result?.function === 'geometry.wall@1.0.0' && expW1.result.input_hash.length === 64 && exp.sources.length === 3 && exp.model_hash === hashBefore, 'inspectable export carries lineage (function@version, input hash), sources and the model hash');
  // undo across the UI
  await page.evaluate(() => { coral.model.remove(coral.model.byType('column')[0].id); coral.regenerate(); });
  check(await page.evaluate(() => coral.model.byType('column').length) === 0, 'column removed');
  await page.keyboard.press('Control+z'); await page.waitForFunction(() => coral.model.byType('column').length === 1);
  check(true, 'Ctrl+Z restores it');
  check(errors.length === 0, 'no page errors or console errors during the run', errors.join(' | ').slice(0, 300));
} catch (err) {
  check(false, 'run aborted', err.stack || String(err));
} finally {
  await browser.close(); proc.kill();
}
console.log(`\n${passes} pass, ${fails} fail`);
process.exit(fails ? 1 : 0);
