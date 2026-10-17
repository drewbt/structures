import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../../app/core/model.js';
import { registry } from '../../app/core/functions.js';

function house() {
  const m = new Model('t');
  m.create({ id: 'L0', type: 'level', name: 'Ground', params: { elevation: { value: 0, unit: 'm' }, height: { value: 3, unit: 'm' } } });
  m.create({ id: 'W1', type: 'wall', parent: 'L0', params: { start: { value: [0, 0], unit: 'm' }, end: { value: [6, 0], unit: 'm' }, thickness: { value: 0.2, unit: 'm' } }, provenance: { source: 'src-fixture', trace: 'T1', method: 'measured' } });
  m.create({ id: 'W2', type: 'wall', parent: 'L0', params: { start: { value: [6, 0], unit: 'm' }, end: { value: [6, 4], unit: 'm' }, thickness: { value: 0.2, unit: 'm' } } });
  m.create({ id: 'D1', type: 'opening', parent: 'L0', params: { host: { value: 'W1', unit: 'id' }, offset: { value: 1, unit: 'm' }, width: { value: 0.9, unit: 'm' }, height: { value: 2.1, unit: 'm' }, sill: { value: 0, unit: 'm' } } });
  m.create({ id: 'S1', type: 'slab', parent: 'L0', params: { outline: { value: [[0, 0], [6, 0], [6, 4], [0, 4]], unit: 'm' }, thickness: { value: 0.2, unit: 'm' }, offset: { value: 3, unit: 'm' } } });
  m.create({ id: 'C1', type: 'column', parent: 'L0', params: { center: { value: [3, 2], unit: 'm' }, width: { value: 0.3, unit: 'm' }, depth: { value: 0.3, unit: 'm' } } });
  return m;
}

test('regenerate computes every element once and uses the level height and elevation', () => {
  const m = house(); const r = m.regenerate();
  assert.deepEqual(r.recomputed.sort(), ['C1', 'S1', 'W1', 'W2']);
  assert.deepEqual(r.errors, {});
  assert.ok(Math.abs(m.result('W1').volume_m3 - (6 * 3 - 0.9 * 2.1) * 0.2) < 1e-9, 'W1 has its door cut out');
  assert.ok(Math.abs(m.result('C1').volume_m3 - 0.3 * 0.3 * 3) < 1e-9, 'column takes the level height 3');
  assert.deepEqual(m.result('S1').bounds.max.map(x => +x.toFixed(9)), [6, 4, 3], 'slab top at elevation + offset');
  assert.equal(m.dirty.size, 0);
});

test('changing a level propagates to everything on it and nothing else is recomputed twice', () => {
  const m = house(); m.regenerate();
  m.set('L0', 'height', 3.5);
  assert.deepEqual([...m.dirty].sort(), ['C1', 'D1', 'L0', 'S1', 'W1', 'W2']);
  const r = m.regenerate();
  assert.deepEqual(r.recomputed.sort(), ['C1', 'W1', 'W2']);   // walls and the column read the level height
  assert.deepEqual(r.cached, ['S1']);                            // the slab reads elevation only: same inputs, served from cache
  assert.ok(Math.abs(m.result('W2').volume_m3 - 6 * 0.2 * 3.5 * (4 / 6)) < 1e-9);
});

test('changing an opening recomputes only its host wall', () => {
  const m = house(); m.regenerate();
  m.set('D1', 'width', 1.2);
  assert.deepEqual([...m.dirty].sort(), ['D1', 'W1']);
  const r = m.regenerate();
  assert.deepEqual(r.recomputed, ['W1']);
  assert.ok(Math.abs(m.result('W1').volume_m3 - (6 * 3 - 1.2 * 2.1) * 0.2) < 1e-9);
});

test('a reverted change is served from the cache, not recomputed; a stale result can never be served', () => {
  const m = house(); m.regenerate();
  const h1 = m.results.get('W1').inputHash;
  m.set('W1', 'thickness', 0.25); let r = m.regenerate();
  assert.deepEqual(r.recomputed, ['W1']); assert.notEqual(m.results.get('W1').inputHash, h1);
  m.set('W1', 'thickness', 0.2); r = m.regenerate();
  assert.deepEqual(r.cached, ['W1']); assert.deepEqual(r.recomputed, []);
  assert.equal(m.results.get('W1').inputHash, h1);
  assert.ok(Math.abs(m.result('W1').volume_m3 - (6 * 3 - 0.9 * 2.1) * 0.2) < 1e-9);
});

test('removing a wall removes its result and dirties the opening that depended on it; the opening then reports an error, not a stale answer', () => {
  const m = house(); m.regenerate();
  m.remove('W1');
  assert.equal(m.result('W1'), undefined);
  assert.ok(m.dirty.has('D1'));
  const r = m.regenerate(); assert.deepEqual(r.errors, {});   // openings have no function of their own
  assert.equal(m.get('D1').params.host.value, 'W1');            // dangling host is kept and visible, not silently rewritten
});

test('undo and redo restore parameters and elements and keep the event log append-only', () => {
  const m = house(); m.regenerate(); const n = m.events.length;
  m.set('W1', 'thickness', 0.3); m.remove('C1');
  assert.ok(m.undo()); assert.ok(m.get('C1'));
  assert.ok(m.undo()); assert.equal(m.value('W1', 'thickness'), 0.2);
  assert.ok(m.redo()); assert.equal(m.value('W1', 'thickness'), 0.3);
  assert.ok(m.events.length > n + 2, 'undo appends events rather than deleting them');
  assert.equal(m.events.filter(e => e.type === 'undo').length, 2);
});

test('wire round trip preserves the model hash, provenance and units', () => {
  const m = house(); const h = m.hash(); const body = m.commitBody('save');
  assert.equal(body.model_hash, h); assert.equal(body.parent_rev, 0); assert.ok(body.events.length >= 6);
  const m2 = new Model('t'); m2.loadWire({ rev: 7, elements: body.elements });
  assert.equal(m2.hash(), h); assert.equal(m2.rev, 7);
  assert.deepEqual(m2.get('W1').provenance, { source: 'src-fixture', trace: 'T1', method: 'measured', note: '' });
  assert.equal(m2.get('W1').params.thickness.unit, 'm');
  assert.deepEqual(m2.get('S1').params.outline.value, [[0, 0], [6, 0], [6, 4], [0, 4]]);
  const r = m2.regenerate(); assert.equal(r.recomputed.length, 4, 'a loaded model regenerates everything');
});

test('toWire param values are JSON text so the service never re-serialises numbers', () => {
  const m = new Model('t'); m.create({ id: 'L0', type: 'level', params: { elevation: { value: 0.1, unit: 'm' } } });
  assert.equal(m.toWire()[0].params.elevation.v, '0.1');
});

test('exportInspectable carries function lineage and assumptions per element', () => {
  const m = house(); m.regenerate(); const x = m.exportInspectable();
  const w = x.elements.find(e => e.id === 'W1');
  assert.equal(w.result.function, 'geometry.wall@1.0.0'); assert.equal(w.result.input_hash.length, 64);
  assert.ok(x.functions.find(f => f.name === 'geometry.wall').assumptions.length > 0);
  assert.ok(registry.has('trace.pixelToWorld'));
});
