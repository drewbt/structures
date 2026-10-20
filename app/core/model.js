// model.js - the authoritative building model (ARCHITECTURE.md "single source of truth").
//
// One Model instance per open project. Every page reads and writes THIS object; there is no second
// copy of geometry anywhere. Each element is {id, type, name, parent, params: {name: {value, unit}},
// provenance?: {source, trace, method, note}}. Mutations go through create/set/remove so that:
//   - an append-only event is recorded (events[] is pending until commit; the service keeps them);
//   - an undo record is kept;
//   - the dependency graph marks the element and its dependents dirty;
//   - listeners are told.
// regenerate() recomputes only dirty elements through the versioned function registry, with a
// result cache keyed by name@version + sha256(canonical inputs): unchanged inputs are never recomputed
// and a changed dependency can never serve a stale result, because the key changes with it.

import { registry, fnFor } from './functions.js';
import { sha256, canonicalJSON, modelHash } from './hash.js';

/** Element types owned by their parent: removed with it. */
const OWNED = new Set(['rebar', 'pile', 'drop_panel', 'punching_zone', 'soil_layer']);

let counter = 0;
export function newId(prefix) { counter++; return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`; }

export class Model {
  constructor(project = 'default') {
    this.project = project;
    this.elements = new Map();
    this.rev = 0;                 // last committed revision from the service
    this.events = [];             // pending (uncommitted) events, append-only
    this.undoStack = []; this.redoStack = [];
    this.dirty = new Set();
    this.results = new Map();     // element id -> {fn, version, inputHash, output}
    this.cache = new Map();       // `${fn}@${ver}:${inputHash}` -> output
    this.stats = { computed: 0, cached: 0 };
    this.listeners = new Set();
  }

  // ---- reading ---------------------------------------------------------------------------------------
  get(id) { return this.elements.get(id); }
  all() { return [...this.elements.values()]; }
  byType(type) { return this.all().filter(e => e.type === type); }
  children(parentId) { return this.all().filter(e => e.parent === parentId); }
  value(id, name, dflt) { const e = this.get(id); const p = e && e.params[name]; return p === undefined ? dflt : p.value; }
  result(id) { return this.results.get(id)?.output; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { if (this._batch) { this._batch.count++; return; } for (const l of this.listeners) l(ev, this); }
  /**
   * Run many mutations as one: listeners hear a single {kind: 'batch'} event, and undo/redo treat the
   * whole batch as one step. Every mutation inside still appends its own event to the log.
   */
  batch(label, fn) {
    if (this._batch) return fn();
    this._batch = { count: 0, undo: [] };
    try { fn(); } finally {
      const b = this._batch; this._batch = null;
      if (b.undo.length) { const steps = b.undo; this.undoStack.push({ label, undo: () => this._silently(() => { for (let i = steps.length - 1; i >= 0; i--) steps[i].undo(); }), redo: () => this._silently(() => { for (const st of steps) st.redo(); }) }); this.redoStack.length = 0; }
      this.emit({ kind: 'batch', label, count: b.count });
    }
  }
  _silently(fn) { const outer = this._batch; this._batch = { count: 0, undo: [] }; try { fn(); } finally { const c = this._batch.count; this._batch = outer; if (!outer) this.emit({ kind: 'batch', count: c }); } }

  // ---- mutation ---------------------------------------------------------------------------------------
  create({ id, type, name, parent = '', params = {}, provenance = null }, { record = true } = {}) {
    if (!type) throw new Error('element needs a type');
    id = id || newId(type);
    if (this.elements.has(id)) throw new Error(`element ${id} exists`);
    const el = { id, type, name: name || id, parent, params: {}, provenance: provenance ? { ...provenance } : null };
    for (const [k, v] of Object.entries(params)) el.params[k] = normParam(v);
    this.elements.set(id, el); this._structural();
    this._event({ type: 'element.create', element: id, payload: { type, name: el.name, parent, params: el.params, provenance } });
    if (record) this._pushUndo({ undo: () => this.remove(id, { record: false }), redo: () => this.create(structuredClone(el), { record: false }) });
    this._invalidate(id);
    this.emit({ kind: 'create', id });
    return el;
  }

  set(id, name, value, unit, { record = true } = {}) {
    const el = this.get(id); if (!el) throw new Error(`no element ${id}`);
    const before = el.params[name] ? { ...el.params[name] } : undefined;
    const after = normParam(unit === undefined && before ? { value, unit: before.unit } : { value, unit: unit ?? '' });
    if (before && before.unit === after.unit && JSON.stringify(before.value) === JSON.stringify(after.value)) return el;
    el.params[name] = after; if (name === 'host') this._structural();
    this._event({ type: 'param.set', element: id, payload: { name, before, after } });
    if (record) this._pushUndo({ undo: () => before ? this.set(id, name, before.value, before.unit, { record: false }) : this.unset(id, name, { record: false }), redo: () => this.set(id, name, after.value, after.unit, { record: false }) });
    this._invalidate(id);
    this.emit({ kind: 'set', id, name });
    return el;
  }
  unset(id, name, { record = true } = {}) {
    const el = this.get(id); if (!el || !el.params[name]) return;
    const before = { ...el.params[name] }; delete el.params[name];
    this._event({ type: 'param.unset', element: id, payload: { name, before } });
    if (record) this._pushUndo({ undo: () => this.set(id, name, before.value, before.unit, { record: false }), redo: () => this.unset(id, name, { record: false }) });
    this._invalidate(id); this.emit({ kind: 'set', id, name });
  }
  rename(id, name) { const el = this.get(id); const before = el.name; el.name = name; this._event({ type: 'element.rename', element: id, payload: { before, after: name } }); this._pushUndo({ undo: () => this.rename(id, before), redo: () => this.rename(id, name) }); this.emit({ kind: 'rename', id }); }
  setProvenance(id, prov) { const el = this.get(id); el.provenance = prov ? { ...prov } : null; this._event({ type: 'provenance.set', element: id, payload: prov }); this.emit({ kind: 'set', id }); }

  remove(id, { record = true } = {}) {
    const el = this.get(id); if (!el) return;
    // parts belong to their host (bars, piles, drop panels, punching zones): removing the host removes them, each as its own event
    for (const child of this.all()) if (child.parent === id && OWNED.has(child.type)) this.remove(child.id, { record });
    const dependents = this.dependentsOf(id);
    const snapshot = structuredClone(el);
    this._invalidate(id);
    this.elements.delete(id); this.results.delete(id); this.dirty.delete(id); this._structural();
    for (const d of dependents) this._invalidate(d);
    this._event({ type: 'element.remove', element: id, payload: { type: el.type, name: el.name } });
    if (record) this._pushUndo({ undo: () => this.create(snapshot, { record: false }), redo: () => this.remove(id, { record: false }) });
    this.emit({ kind: 'remove', id });
  }

  undo() { const r = this.undoStack.pop(); if (!r) return false; r.undo(); this.redoStack.push(r); this._event({ type: 'undo' }); return true; }
  redo() { const r = this.redoStack.pop(); if (!r) return false; r.redo(); this.undoStack.push(r); this._event({ type: 'redo' }); return true; }
  _pushUndo(r) { if (this._batch) { this._batch.undo.push(r); return; } this.undoStack.push(r); this.redoStack.length = 0; }
  _event(e) { this.events.push({ time: new Date().toISOString(), ...e }); }

  // ---- dependency graph ---------------------------------------------------------------------------------
  /** Ids this element's computation reads besides its own parameters. */
  dependsOn(el) {
    const deps = [];
    if (el.parent && this.elements.has(el.parent)) deps.push(el.parent);
    if (el.type === 'wall') for (const o of this.all()) if (o.type === 'opening' && o.params.host?.value === el.id) deps.push(o.id);
    if (el.type === 'opening' && el.params.host) deps.push(el.params.host.value);
    return deps;
  }
  /** Ids whose computations read `id` (direct). */
  /** Ids whose computations read `id` (direct). A reverse index rebuilt only after a structural change. */
  dependentsOf(id) {
    if (!this._rev || this._revStamp !== this._structStamp) {
      this._rev = new Map();
      for (const e of this.elements.values()) for (const d of this.dependsOn(e)) { if (d === e.id) continue; if (!this._rev.has(d)) this._rev.set(d, []); this._rev.get(d).push(e.id); }
      this._revStamp = this._structStamp;
    }
    return this._rev.get(id) || [];
  }
  _structural() { this._structStamp = (this._structStamp || 0) + 1; }
  _invalidate(id) {
    const stack = [id], seen = new Set();
    while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); if (this.elements.has(x)) this.dirty.add(x); for (const d of this.dependentsOf(x)) stack.push(d); }
  }

  /** Recompute every dirty element whose type has a function. Returns {recomputed:[ids], cached:[ids], errors:{id:msg}}. */
  regenerate() {
    const out = { recomputed: [], cached: [], errors: {} };
    for (const id of [...this.dirty]) {
      const el = this.get(id); this.dirty.delete(id);
      if (!el) continue;
      const fn = fnFor(el.type); if (!fn) continue;
      try {
        const inputs = fn.inputs(this, el);
        const inputHash = sha256(canonicalJSON(inputs));
        const key = `${fn.name}@${fn.version}:${inputHash}`;
        let output = this.cache.get(key);
        if (output === undefined) { output = fn.run(inputs); this.cache.set(key, output); this.stats.computed++; out.recomputed.push(id); }
        else { this.stats.cached++; out.cached.push(id); }
        this.results.set(id, { fn: fn.name, version: fn.version, inputHash, output, assumptions: fn.assumptions });
      } catch (err) { out.errors[id] = err.message; this.results.delete(id); }
    }
    if (out.recomputed.length || out.cached.length || Object.keys(out.errors).length) this.emit({ kind: 'regenerate', ...out });
    return out;
  }

  // ---- wire form (what the service stores) --------------------------------------------------------------
  toWire() {
    return this.all().map(e => {
      const params = {}; for (const k of Object.keys(e.params).sort()) params[k] = { v: JSON.stringify(e.params[k].value), unit: e.params[k].unit ?? '' };
      const o = { id: e.id, type: e.type, name: e.name, parent: e.parent ?? '', params };
      if (e.provenance) o.provenance = { source: e.provenance.source ?? '', trace: e.provenance.trace ?? '', method: e.provenance.method ?? '', note: e.provenance.note ?? '' };
      return o;
    });
  }
  hash() { return modelHash(this.toWire()); }
  commitBody(message, actor = 'coral-app') {
    return { parent_rev: this.rev, message, actor, model_hash: this.hash(), elements: this.toWire(), events: this.events.map(e => ({ ...e, payload: e.payload === undefined ? undefined : e.payload })) };
  }
  /** Replace the whole state from the service's load() result. Everything becomes dirty. */
  loadWire({ rev = 0, elements = [] }) {
    this.elements.clear(); this.results.clear(); this.dirty.clear(); this.events.length = 0; this.undoStack.length = 0; this.redoStack.length = 0;
    for (const w of elements) {
      const params = {}; for (const [k, p] of Object.entries(w.params ?? {})) params[k] = { value: JSON.parse(p.v), unit: p.unit ?? '' };
      const prov = w.provenance && (w.provenance.source || w.provenance.trace || w.provenance.method) ? { ...w.provenance } : null;
      this.elements.set(w.id, { id: w.id, type: w.type, name: w.name, parent: w.parent ?? '', params, provenance: prov }); this._structural();
    }
    this.rev = rev;
    for (const id of this.elements.keys()) this.dirty.add(id);
    this.emit({ kind: 'load' });
  }
  committed(rev) { this.rev = rev; this.events.length = 0; this.emit({ kind: 'commit', rev }); }

  /** Inspectable export: every element with its parameters, provenance, result lineage and assumptions. */
  exportInspectable() {
    return {
      project: this.project, rev: this.rev, model_hash: this.hash(), exported: new Date().toISOString(),
      functions: [...registry.values()].map(f => ({ name: f.name, version: f.version, assumptions: f.assumptions })),
      elements: this.all().map(e => {
        const r = this.results.get(e.id);
        return { ...e, result: r ? { function: `${r.fn}@${r.version}`, input_hash: r.inputHash, volume_m3: r.output?.volume_m3, area_m2: r.output?.area_m2, bounds: r.output?.bounds } : null };
      }),
    };
  }
}

function normParam(p) {
  if (p && typeof p === 'object' && 'value' in p) return { value: p.value, unit: p.unit ?? '' };
  return { value: p, unit: '' };
}
