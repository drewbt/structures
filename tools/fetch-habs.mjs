// fetch-habs.mjs - download a HABS/HAER record from the Library of Congress: every measured-drawing
// sheet at the largest image offered, the data pages PDF, and the record's JSON, with a SHA-256
// manifest. A development tool (DECISIONS D-02): run it on any machine that can reach loc.gov, then
// import the sheets on page 00.
//
//   node tools/fetch-habs.mjs pa1690 [out-dir]        (pa1690 is Fallingwater, HABS PA-5346)
//
// It reads the record through the Library's JSON view (https://www.loc.gov/item/<id>/?fo=json and
// the sheet resource https://www.loc.gov/resource/hhh.<id>.sheet/?fo=json&sp=<n>) and does not
// guess file names: it walks whatever the JSON lists and keeps, per sheet, the largest JPEG and the
// TIFF master. STATUS: written 2026-10-17 without network access to loc.gov from the build
// environment, so it has NOT been run against the live API. If the JSON shape differs, it says
// what it found and exits non-zero rather than writing a partial set silently.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const id = process.argv[2] || 'pa1690';
const out = process.argv[3] || join('sources', 'habs', id);
const ua = { 'user-agent': 'coral-concrete fetch-habs (research; https://github.com/drewbt/structures)' };
mkdirSync(out, { recursive: true });

async function json(url) {
  const r = await fetch(url, { headers: ua });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function bytes(url) {
  const r = await fetch(url, { headers: ua });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
/** Every {url, mimetype?, width?, height?, size?} object anywhere under v. */
function files(v, acc = []) {
  if (Array.isArray(v)) { for (const x of v) files(x, acc); return acc; }
  if (v && typeof v === 'object') {
    if (typeof v.url === 'string' && /\.(jpe?g|tiff?|pdf|gif)(\?|$)/i.test(v.url)) acc.push(v);
    for (const k of Object.keys(v)) files(v[k], acc);
  }
  return acc;
}
const abs = u => (u.startsWith('//') ? 'https:' + u : u);
const sha = b => createHash('sha256').update(b).digest('hex');

const manifest = { record: id, fetched: new Date().toISOString(), item_url: `https://www.loc.gov/pictures/item/${id}/`, rights: null, title: null, files: [] };
const item = await json(`https://www.loc.gov/item/${id}/?fo=json`);
writeFileSync(join(out, 'item.json'), JSON.stringify(item, null, 2));
manifest.title = item.item?.title ?? item.title ?? null;
manifest.rights = item.item?.rights_advisory ?? item.item?.rights ?? item.rights ?? null;

const all = files(item).map(f => ({ ...f, url: abs(f.url) }));
const pdfs = [...new Set(all.filter(f => /\/data\/.*\.pdf/i.test(f.url)).map(f => f.url))];
const sheetUrls = all.filter(f => /\/sheet\//i.test(f.url));
if (!sheetUrls.length) {
  // the item JSON may list resources only; walk the sheet resource page by page
  for (let sp = 1; sp <= 60; sp++) {
    let r; try { r = await json(`https://www.loc.gov/resource/hhh.${id}.sheet/?fo=json&sp=${sp}`); } catch { break; }
    const fs = files(r).map(f => ({ ...f, url: abs(f.url), sp }));
    if (!fs.length) break;
    sheetUrls.push(...fs.filter(f => /\/sheet\//i.test(f.url)));
  }
}
if (!sheetUrls.length) { console.error(`no sheet files found in the JSON for ${id}; item.json written for inspection`); process.exit(2); }

// group by sheet number (the 5-digit stem in .../sheet/00005...); keep the largest JPEG and any TIFF
const bySheet = new Map();
for (const f of sheetUrls) {
  const m = f.url.match(/\/sheet\/(\d{5})/); const n = m ? +m[1] : f.sp; if (!n) continue;
  const s = bySheet.get(n) || { jpg: null, tif: null }; const px = (f.width || 0) * (f.height || 0) || f.size || 0;
  if (/\.jpe?g/i.test(f.url) && !/_150px/.test(f.url) && (!s.jpg || px > s.jpg.px)) s.jpg = { url: f.url, px };
  if (/\.tiff?/i.test(f.url)) s.tif = { url: f.url, px };
  bySheet.set(n, s);
}
for (const [n, s] of [...bySheet].sort((a, b) => a[0] - b[0])) {
  for (const kind of ['jpg', 'tif']) {
    if (!s[kind]) continue;
    if (kind === 'tif' && process.env.HABS_TIFF !== '1') { manifest.files.push({ sheet: n, kind, url: s.tif.url, skipped: 'set HABS_TIFF=1 to download masters' }); continue; }
    const b = await bytes(s[kind].url); const name = `sheet-${String(n).padStart(2, '0')}.${kind}`;
    writeFileSync(join(out, name), b); manifest.files.push({ sheet: n, kind, url: s[kind].url, file: name, bytes: b.length, sha256: sha(b) });
    console.log(`sheet ${n} ${kind} ${b.length} bytes`);
  }
}
for (const u of pdfs) { const b = await bytes(u); const name = u.split('/').pop(); writeFileSync(join(out, name), b); manifest.files.push({ kind: 'data', url: u, file: name, bytes: b.length, sha256: sha(b) }); console.log(`data ${name}`); }
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`${manifest.files.length} files, rights: ${JSON.stringify(manifest.rights)}\nwrote ${join(out, 'manifest.json')}`);
