// feasibility.test.mjs - the appraisal: areas from the model, costs from its quantities, cash flow arithmetic,
// break-evens that actually break even, and exits that add up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Model } from '../../app/core/model.js';
import '../../app/core/functions.js';
import { createSiteTower } from '../../app/core/sitetower.js';
import { gravityInputs } from '../../app/core/tower.js';
import * as F from '../../app/core/feasibility.js';

const site = JSON.parse(readFileSync(new URL('../../app/data/site-park-lane.json', import.meta.url), 'utf8'));
const m = new Model('f'), app = { model: m, regenerate() { return m.regenerate(); } };
createSiteTower(app, site); m.regenerate();
const q = F.modelQuantities(m, gravityInputs(m).concrete_m3), a = {}, r = F.appraise(m, a, q);

test('irr: a known flow', () => {
  assert.ok(Math.abs(F.irr([-100, 110]) - 0.10) < 1e-9);
  assert.ok(Math.abs(F.irr([-100, 0, 121]) - 0.10) < 1e-9);
  assert.equal(F.irr([-100, -5]), null);
});

test('areas come from the model: sellable below gross, terraces only on penthouses, no sales in cellars or plant', () => {
  const A = r.areas; assert.ok(A.sellable_sf > 0 && A.sellable_sf < A.gsf);
  for (const row of A.rows) {
    if (['cellar', 'mechanical', 'crown', 'lobby', 'amenity'].includes(row.use)) assert.equal(row.sellable_sf, 0, row.name);
    if (row.terrace_sf > 0) assert.equal(row.use, 'penthouse');
  }
  const slabs = m.byType('slab').filter(s => s.params.role?.value !== 'mat').reduce((s, x) => s + m.result(x.id).area_m2, 0);
  assert.ok(Math.abs(A.gsf - slabs * 10.7639) < 1);
});

test('the cost plan prices the model\'s own quantities and adds up', () => {
  const line = n => r.cost.lines.find(l => l.name.startsWith(n)).amount;
  assert.ok(Math.abs(line('Structure') - q.concrete_m3 * F.FEAS_DEFAULTS.concrete_rate.v) < 1);
  assert.ok(Math.abs(line('Tuned mass damper') - q.damper_t * F.FEAS_DEFAULTS.damper_rate.v) < 1);
  assert.ok(Math.abs(r.cost.total - r.cost.lines.reduce((s, l) => s + l.amount, 0)) < 1);
  assert.ok(r.cost.lines.every(l => l.basis), 'every line states its basis');
});

test('cash flow: every dollar of cost is funded, the loan is repaid, equity flows reconcile with profit', () => {
  const cf = r.cf, cost = cf.rows.reduce((s, x) => s + x.cost, 0), funded = cf.rows.reduce((s, x) => s + x.equity_in + x.loan_draw, 0);
  assert.ok(Math.abs(funded - cost - cf.loan_fee) < 1);
  const income = cf.rows.reduce((s, x) => s + x.income, 0);
  assert.ok(Math.abs(income - r.rev.net) < 1);
  if (r.profit > 0) assert.ok(cf.rows.at(-1).loan < 1, 'loan repaid');
  if (cf.rows.at(-1).loan < 1) assert.ok(Math.abs(cf.profit - (income - cost - cf.interest - cf.loan_fee)) < 1);
});

test('break-evens break even', () => {
  const rl = F.residualLand(m, a, q, 'profit');
  if (typeof rl === 'number') assert.ok(Math.abs(F.appraise(m, { land_price: { v: rl } }, q).profit) < 2e6);
  const be = F.breakevenPrice(m, a, q, 'profit'); assert.ok(be && be.factor > 0);
  const k = be.factor, b = { price_base: { v: F.FEAS_DEFAULTS.price_base.v * k }, price_podium: { v: F.FEAS_DEFAULTS.price_podium.v * k }, price_penthouse: { v: F.FEAS_DEFAULTS.price_penthouse.v * k } };
  assert.ok(Math.abs(F.appraise(m, b, q).profit) < 2e6);
});

test('profit rises with price and falls with cost', () => {
  const s = F.sensitivity(m, a, q);
  for (const row of s) for (let i = 1; i < row.cells.length; i++) assert.ok(row.cells[i].profit > row.cells[i - 1].profit);
  for (let j = 1; j < s.length; j++) assert.ok(s[j].cells[2].profit < s[j - 1].cells[2].profit);
});

test('process and exits: every stage names who is paid; exits state capital, net, time and tax', () => {
  const st = F.processStages(r, a); assert.ok(st.length >= 7 && st.every(x => x.who.length && x.to >= x.from));
  const ex = F.exitOptions(m, r, a, q); assert.ok(ex.length >= 5);
  for (const x of ex) assert.ok(Number.isFinite(x.net) && x.capital >= 0 && x.years > 0 && x.tax);
  assert.equal(ex.find(x => x.route.startsWith('Fee')).capital, 0);
});
