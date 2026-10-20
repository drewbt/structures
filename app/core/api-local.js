// api-local.js - the service API answered inside the browser, for the published (static) build of Coral.
//
// Same interface as api.js. The model is kept in this browser's storage (localStorage, falling back to
// memory when storage is unavailable or full), with revisions, events and per-element parameter history
// as the C++ store keeps them. The model hash is computed by the same canonical form as the service.
//
// The structural engine cannot run in a published page (it is a native C++ program in a private
// repository, DECISIONS D-11). This API answers /analyse only from a table of engine results captured
// from real runs of the engine (engine-cache.json, keyed exactly as the service keys them: SHA-256 of the
// model text). Any other model is refused with a message that says so; nothing is approximated.

import { modelHash, sha256 } from './hash.js';

const mem = new Map();
const store = {
  get(k) { try { const v = localStorage.getItem(k); if (v !== null) return JSON.parse(v); } catch { /* storage unavailable */ } return mem.has(k) ? structuredClone(mem.get(k)) : null; },
  set(k, v) { mem.set(k, v); try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

export class LocalApi {
  constructor({ seedUrl = 'seed.json', cacheUrl = 'engine-cache.json' } = {}) { this.seedUrl = seedUrl; this.cacheUrl = cacheUrl; this.local = true; this.persisted = true; }
  async _cache() {
    if (!this.cache) { try { this.cache = await (await fetch(this.cacheUrl)).json(); } catch { this.cache = { engine: null, results: {} }; } }
    return this.cache;
  }
  async _seed() { if (this.seed === undefined) { try { this.seed = await (await fetch(this.seedUrl)).json(); } catch { this.seed = null; } } return this.seed; }
  /** Storage is per project and per published seed: a rebuilt copy opens on its own seed, not on an older copy's saved model. */
  key(p) { const h = this.seed?.project === p ? this.seed.model_hash?.slice(0, 12) : null; return h ? `coral:${p}@${h}` : `coral:${p}`; }
  async _project(p) {
    const seed = await this._seed();
    let s = store.get(this.key(p));
    if (!s) {
      s = { rev: 0, elements: [], revisions: [], events: [], sources: [], history: {} };
      try { if (seed?.project === p) Object.assign(s, { rev: 1, elements: seed.elements, sources: seed.sources || [], revisions: [{ rev: 1, parent_rev: 0, time: seed.created, message: 'seed: the reference frame, designed and detailed by the local service and engine', actor: 'build-static', model_hash: modelHash(seed.elements) }] }); } catch { /* seed unreadable */ }
      this.persisted = store.set(this.key(p), s);
    }
    return s;
  }
  async health() { const c = await this._cache(); return { ok: true, schema_version: 'browser', sqlite: 'none: this browser\'s storage', engine: c.engine, mode: 'static' }; }
  async projects() { return []; }
  async loadModel(p) { const s = await this._project(p); return { project: p, rev: s.rev, model_hash: modelHash(s.elements), elements: s.elements }; }
  async commit(p, body) {
    const s = await this._project(p);
    if (body.parent_rev !== undefined && body.parent_rev !== s.rev) return { conflict: true, rev: s.rev };
    const rev = s.rev + 1, hash = modelHash(body.elements), before = new Map(s.elements.map(e => [e.id, e])); let changed = 0;
    for (const e of body.elements) {
      const old = before.get(e.id);
      for (const [name, pv] of Object.entries(e.params || {})) if (!old || old.params?.[name]?.v !== pv.v || old.params?.[name]?.unit !== pv.unit) { (s.history[e.id] ||= []).push({ rev, name, value_json: pv.v, unit: pv.unit }); changed++; }
      if (!old) changed++;
    }
    for (const id of before.keys()) if (!body.elements.some(e => e.id === id)) changed++;
    s.elements = body.elements; s.rev = rev;
    s.revisions.push({ rev, parent_rev: rev - 1, time: new Date().toISOString(), message: body.message || '', actor: body.actor || '', model_hash: hash });
    for (const ev of body.events || []) s.events.push({ ...ev, seq: s.events.length + 1, rev });
    if (s.events.length > 5000) s.events = s.events.slice(-5000);
    this.persisted = store.set(this.key(p), s);
    return { rev, parent_rev: rev - 1, model_hash: hash, changed, client_hash_agrees: body.model_hash ? body.model_hash === hash : null, persisted: this.persisted };
  }
  async analyse(p, body) {
    const c = await this._cache(), text = JSON.stringify(body.model), model_sha = sha256(text), hit = c.results[model_sha];
    if (!hit) throw new Error('The structural engine runs only in the local Coral service. This published page carries engine results for the reference frame\'s beams and the default cantilever; other beams need Coral running locally (see the README).');
    return { cached: true, precomputed: true, engine: c.engine, model_sha, function: `${body.function}@${body.version}`, output: hit };
  }
  async history(p) { return (await this._project(p)).revisions; }
  async events(p, since = 0) { return (await this._project(p)).events.filter(e => e.seq > since); }
  async elementHistory(p, id) { return (await this._project(p)).history[id] || []; }
  async sources(p) { return (await this._project(p)).sources; }
  async putSource(p, src) { const s = await this._project(p); s.sources = s.sources.filter(q => q.id !== src.id).concat([{ ...src, updated: new Date().toISOString() }]); this.persisted = store.set(this.key(p), s); return { ok: true }; }
  async putArtifact(blob) { const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); }); const sha = sha256(url); mem.set(`art:${sha}`, url); return { sha, size: blob.size, url }; }
  artifactUrl(sha) { return mem.get(`art:${sha}`) || ''; }
}
