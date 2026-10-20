// brochure.mjs - brochure-style renders of the Park Lane design study from Coral's own Render mode (the model, not
// a separate visualisation). Each image carries a label: a design study, illustrative, not an offering.
//
//   node tools/brochure.mjs [base-url] [out-dir] [scale]
// base-url defaults to a running service at http://127.0.0.1:8790; out-dir to docs/brochure. Needs Playwright
// (PLAYWRIGHT_DIR, default /opt/node-tools/node_modules) and its Chromium; software WebGL is slow, so allow minutes.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const req = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x.js'));
const { chromium } = req('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8790', project = process.env.PROJECT || 'park-lane', out = process.argv[3] || (project === 'park-lane' ? 'docs/brochure' : `docs/brochure-${project}`), scale = Number(process.argv[4] || 1);
mkdirSync(out, { recursive: true });

const LABELS = { 'park-lane': 'Park Lane design study · Coral Concrete · illustrative render of a structural and massing study, not a proposal by the landowner and not an offering · context © OpenStreetMap contributors (ODbL)',
  dorado: 'Dorado beach residences · concept study by Coral Concrete · illustrative render on an illustrative lot of the listed size; site not controlled, zoning not confirmed; not an offering' };
const LABEL = LABELS[project], KICKER = project === 'dorado' ? 'Dorado, Puerto Rico · concept study' : 'Central Park South · design study';
const DUSK = [-0.78, -0.42, 0.10], GOLD = [-0.70, -0.55, 0.22], DAY = [-0.45, -0.65, 0.62];
const TROPIC = [-0.35, 0.45, 0.82], LATE = [-0.75, 0.35, 0.42], SUNSET = [-0.92, 0.30, 0.12];   // at 18° N the summer sun stands north of the zenith: the ocean facade is lit

// camera: theta and phi in radians about the target, distance in metres; the tower stands at (12.65, −24.1),
// the park to the north (+y), Central Park South runs east-west (x) just south of it. From the street the tower is hidden behind the
// Central Park South frontage (it stands on the rear lot), so there is no street-level shot
const ONLY = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
const SETS = { 'park-lane': [
  { name: '1-hero-over-the-park', title: 'Over the park at dusk', target: [12.65, -24.1, 140], theta: 1.95, phi: 0.09, dist: 900, sun: DUSK, fov: 32 },
  { name: '6-skyline', title: 'On Billionaires\' Row', hero: true, sun: DUSK },
  { name: '2-aerial-golden-hour', title: 'Aerial from the north-east, golden hour', target: [0, -120, 90], theta: 0.95, phi: 0.42, dist: 1250, sun: GOLD },
  { name: '3-crown-and-penthouses', title: 'The open crown and the set-back penthouse terraces', target: [12.65, -24.1, 238], theta: 1.85, phi: 0.06, dist: 150, sun: DUSK, fov: 38 },
  { name: '4-from-the-park', title: 'From the Sheep Meadow', target: [12.65, -24.1, 150], theta: 1.62, phi: -0.21, dist: 640, sun: GOLD, fov: 34 },
  { name: '5-penthouse-terrace', title: 'The view north from a penthouse terrace, 253 m up', eye: [11.4, -13.6, 255.5], target: [-90, 420, 0], sun: GOLD, fov: 74 },
],
  dorado: [
    { name: '1-from-the-beach', title: 'From the beach', eye: [13, 33, 1.7], target: [0, -16, 9], sun: TROPIC, fov: 60 },
    { name: '2-aerial-from-the-sea', title: 'From the sea', eye: [150, 230, 95], target: [0, -28, 4], sun: TROPIC, fov: 40 },
    { name: '3-pool-deck', title: 'The pool deck and gardens', eye: [-21, 8.5, 1.6], target: [6, -14, 8], sun: LATE, fov: 64 },
    { name: '4-terrace-to-the-sea', title: 'A terrace on the third floor', eye: [5, -6.6, 10.3], target: [-60, 400, -8], sun: LATE, fov: 74 },
    { name: '5-sunset', title: 'Evening on the beach', eye: [-44, 28, 1.7], target: [0, -18, 10], sun: SUNSET, fov: 48 },
    { name: '6-arrival', title: 'Arrival under the palms', eye: [12, -100, 1.7], target: [0, -40, 7], sun: [-0.4, -0.5, 0.75], fov: 56 },
  ],
};
const SHOTS = SETS[project];

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(`${base}/?project=${project}#model`);
await page.waitForFunction(() => globalThis.coralArch?.viewer?.items?.length > 50, null, { timeout: 180000 });
await page.waitForTimeout(3000);
await page.addStyleTag({ content: `
  canvas.view3d { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 9000; }
  .hud, coral-nav, coral-tree, coral-properties, coral-timeline { visibility: hidden !important; }
  #brochure-label { position: fixed; left: 28px; right: 28px; bottom: 22px; z-index: 9100; color: rgba(255,255,255,.86); font: 500 13px/1.35 system-ui, sans-serif; letter-spacing: .02em; text-shadow: 0 1px 3px rgba(0,0,0,.6); }
  #brochure-title { position: fixed; left: 28px; top: 26px; z-index: 9100; color: #fff; font: 300 34px/1.1 Georgia, 'Times New Roman', serif; letter-spacing: .04em; text-shadow: 0 2px 8px rgba(0,0,0,.45); }
  #brochure-title small { display: block; font: 600 11px/1.6 system-ui, sans-serif; letter-spacing: .28em; text-transform: uppercase; opacity: .85; margin-bottom: 6px; }` });
await page.evaluate(() => { const a = globalThis.coralArch; if (!a.renderMode) { a.renderMode = true; a.viewer.setRender(true); a.syncButtons?.(); } a.app.selection.clear?.(); a.viewer.setSelection(new Set()); });

for (const s of SHOTS.filter(x => !ONLY || ONLY.some(o => x.name.startsWith(o)))) {
  await page.evaluate(({ s, LABEL, KICKER }) => {
    const a = globalThis.coralArch, v = a.viewer;
    v.camera.fov = (s.fov ?? 45) * Math.PI / 180; v.sun = s.sun;
    if (s.hero) a.heroView();
    else if (s.eye) { const d = s.eye.map((e, i) => e - s.target[i]), h = Math.hypot(d[0], d[1]), r = Math.hypot(h, d[2]); Object.assign(v.camera, { target: s.target, theta: Math.atan2(d[1], d[0]), phi: Math.atan2(d[2], h), dist: r }); }   // stand at a named point, look at the target
    else Object.assign(v.camera, { target: s.target, theta: s.theta, phi: s.phi, dist: s.dist });
    v.needsDraw = true;
    for (const id of ['brochure-label', 'brochure-title']) document.getElementById(id)?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div id="brochure-title"><small>${KICKER}</small>${s.title}</div><div id="brochure-label">${LABEL}</div>`);
  }, { s, LABEL, KICKER });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(out, `${s.name}.png`) });
  console.log('wrote', join(out, `${s.name}.png`));
}
await browser.close();
