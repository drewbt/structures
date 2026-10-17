import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../../app/core/functions.js';
import { Model } from '../../app/core/model.js';
import { convert, parseLength, formatLength } from '../../app/core/units.js';

test('calibrateScale: 500 px for 5 m is 0.01 m/px', () => {
  const r = registry.get('trace.calibrateScale').run({ p1: [100, 100], p2: [400, 500], distance_m: 5 });
  assert.equal(r.pixels, 500); assert.equal(r.scale_m_per_px, 0.01);
  assert.throws(() => registry.get('trace.calibrateScale').run({ p1: [1, 1], p2: [1, 1], distance_m: 5 }));
});

test('correcting the calibration distance changes the scale and the transform (nothing cached stale)', () => {
  const m = new Model('t');
  m.create({ id: 'DR', type: 'drawing', params: { cal_p1: { value: [0, 0], unit: 'px' }, cal_p2: { value: [500, 0], unit: 'px' }, cal_distance: { value: 5, unit: 'm' }, origin_px: { value: [0, 0], unit: 'px' } } });
  m.regenerate(); assert.deepEqual(m.result('DR').toWorld([250, 0]), [2.5, 0]);
  m.set('DR', 'cal_distance', 10); const r = m.regenerate(); assert.deepEqual(r.recomputed, ['DR']);
  assert.deepEqual(m.result('DR').toWorld([250, 0]), [5, 0]);
});

test('pixelToWorld: origin, flipped y, rotation, and an exact inverse', () => {
  const m = new Model('t');
  m.create({ id: 'DR', type: 'drawing', params: { cal_p1: { value: [700, 970], unit: 'px' }, cal_p2: { value: [1200, 970], unit: 'px' }, cal_distance: { value: 5, unit: 'm' }, origin_px: { value: [100, 800], unit: 'px' }, rotation: { value: 0, unit: 'deg' } } });
  m.regenerate(); assert.equal(m.result('DR').scale, 0.01, '500 px for 5 m');
  m.regenerate(); const t = m.result('DR');
  assert.deepEqual(t.toWorld([100, 800]), [0, 0]);
  assert.deepEqual(t.toWorld([700, 800]).map(x => +x.toFixed(9)), [6, 0]);
  assert.deepEqual(t.toWorld([100, 400]).map(x => +x.toFixed(9)), [0, 4], 'up on the image is +y in the world');
  const back = t.toPixel(t.toWorld([333, 444])); assert.ok(Math.hypot(back[0] - 333, back[1] - 444) < 1e-9);
  // rotate the drawing 90°: the world x axis is drawn pointing up the image
  m.set('DR', 'rotation', 90); m.regenerate(); const r = m.result('DR');
  assert.deepEqual(r.toWorld([100, 200]).map(x => +x.toFixed(9)), [6, 0], 'a point 600 px up the image is 6 m along world x');
});

test('an uncalibrated drawing reports an error rather than a transform', () => {
  const m = new Model('t'); m.create({ id: 'DR', type: 'drawing', params: { cal_p1: { value: [0, 0], unit: 'px' } } });
  const r = m.regenerate(); assert.match(r.errors.DR, /not calibrated/);
});

test('units convert, parse and format', () => {
  assert.equal(convert(250, 'mm', 'm'), 0.25);
  assert.equal(parseLength('250 mm'), 0.25); assert.equal(parseLength('0.3'), 0.3); assert.equal(parseLength('2m'), 2);
  assert.throws(() => convert(1, 'm', 'kN'));
  assert.equal(formatLength(0.25), '250 mm'); assert.equal(formatLength(12.3456), '12.346 m');
});
