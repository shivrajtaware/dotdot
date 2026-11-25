const test = require('node:test');
const assert = require('node:assert/strict');
const { calcStock, sumGradeProduction, addCumulative, applyStockAdjustment, buildProductionMonitoring, factoryProductionDate, normalizeOperationalSnapshots, normalizeReferenceSnapshots, preserveOperationalSnapshots, productionDateWithinSeason, resolveOptionalProductionDateRange, resolveProductionDate, resolveProductionDateRange, timeEntriesMatchProduction } = require('../dist/calculations.js');
const { isActiveShiftChemist, canAcknowledgeAssignedShiftChemist, canViewShiftRecordAsChemist } = require('../dist/permissions.js');
test('opening + production - dispatch yields the closing stock', () => {
  assert.deepEqual(calcStock({ opening: 100, production: 50, dispatch: 30 }), { opening: 100, production: 50, available: 150, dispatch: 30, closing: 120 });
});
test('grade production totals reconcile', () => {
  assert.equal(sumGradeProduction([{production:0},{production:0},{production:300},{production:200}]), 500);
});
test('shift figures sum to the daily total', () => {
  assert.equal(sumGradeProduction([{production:500},{production:250},{production:400}]), 1150);
});
test('time-wise entries must reconcile, including an empty table', () => {
  assert.equal(timeEntriesMatchProduction([{bags:300},{bags:200}],500),true);
  assert.equal(timeEntriesMatchProduction([],0),true);
  assert.equal(timeEntriesMatchProduction([],500),false);
});
test('season cumulative adds the day production to opening cumulative', () => {
  assert.equal(addCumulative(62810,1150),63960);
});
test('production dates include season start and exclude the next season start', () => {
  const season = { startDate: new Date('2026-10-01T00:00:00.000Z'), endDate: new Date('2027-10-01T00:00:00.000Z') };
  assert.equal(productionDateWithinSeason(new Date('2026-10-01T00:00:00.000Z'), season), true);
  assert.equal(productionDateWithinSeason(new Date('2027-09-30T00:00:00.000Z'), season), true);
  assert.equal(productionDateWithinSeason(new Date('2027-10-01T00:00:00.000Z'), season), false);
  assert.equal(productionDateWithinSeason(new Date('2026-09-30T00:00:00.000Z'), season), false);
});
test('factory production date keeps the overnight shift on its start date in Asia/Kolkata', () => {
  assert.equal(factoryProductionDate(new Date('2026-11-22T19:30:00.000Z')), '2026-11-22'); // 01:00 IST
  assert.equal(factoryProductionDate(new Date('2026-11-22T22:29:00.000Z')), '2026-11-22'); // 03:59 IST
  assert.equal(factoryProductionDate(new Date('2026-11-22T22:30:00.000Z')), '2026-11-23'); // 04:00 IST
  assert.equal(factoryProductionDate(new Date('2026-11-22T19:30:00.000Z'), '05:00'), '2026-11-22');
  assert.throws(() => factoryProductionDate(new Date('2026-11-22T19:30:00.000Z'), '25:00'), /valid 24-hour time/);
});
test('date filters accept valid production dates and reject malformed calendar dates', () => {
  const now = new Date('2026-11-22T19:30:00.000Z');
  assert.equal(resolveProductionDate(undefined, now), '2026-11-22');
  assert.equal(resolveProductionDate('2028-02-29', now), '2028-02-29');
  assert.equal(resolveProductionDate('2026-02-29', now), null);
  assert.equal(resolveProductionDate('2026-11-22T00:00:00Z', now), null);
  assert.equal(resolveProductionDate(['2026-11-22'], now), null);
});
test('report date ranges validate both dates and reject reversed ranges', () => {
  const now = new Date('2026-11-22T19:30:00.000Z');
  assert.deepEqual(resolveProductionDateRange('2026-11-01', '2026-11-22', now), { from: '2026-11-01', to: '2026-11-22' });
  assert.equal(resolveProductionDateRange(undefined, undefined, now).to, '2026-11-22');
  assert.equal(resolveProductionDateRange('2026-11-23', '2026-11-22', now), null);
  assert.equal(resolveProductionDateRange('2026-02-29', '2026-03-01', now), null);
});
test('record date filters validate supplied bounds and preserve open-ended ranges', () => {
  assert.deepEqual(resolveOptionalProductionDateRange('2026-11-01', undefined), { from: '2026-11-01', to: undefined });
  assert.deepEqual(resolveOptionalProductionDateRange(undefined, '2026-11-22'), { from: undefined, to: '2026-11-22' });
  assert.equal(resolveOptionalProductionDateRange(undefined, '2026-02-30'), null);
  assert.equal(resolveOptionalProductionDateRange('2026-11-23', '2026-11-22'), null);
});
test('register field labels come from administrator configuration and the physical register', () => {
  const configured = ['Field 1', 'Field 2', 'Field 3', 'Field 4', 'Field 5'];
  const inputs = configured.map((_, i) => ({ code: `OP${i + 1}`, label: 'tampered', bags: i }));
  assert.deepEqual(normalizeOperationalSnapshots(configured, inputs).map(x => x.labelSnapshot), configured);
  assert.throws(() => normalizeOperationalSnapshots(configured, inputs.slice(1)), /five operational counts/);
  assert.deepEqual(preserveOperationalSnapshots(configured.map((label, i) => ({ code: `OP${i + 1}`, labelSnapshot: label })), inputs).map(x => x.labelSnapshot), configured);
  assert.throws(() => preserveOperationalSnapshots(configured.map((label, i) => ({ code: `OP${i + 1}`, labelSnapshot: label })), inputs.slice(1)), /preserve every existing operational field/);
  assert.deepEqual(normalizeReferenceSnapshots([]), [], 'register reference fields are optional when the worker form omits them.');
  const references = normalizeReferenceSnapshots([1, 2, 3].map(i => ({ code: `REF${i}`, label: 'tampered' })));
  assert.deepEqual(references.map(x => x.labelSnapshot), ['दिनांक ____ चा शेवट नंबर', 'दिनांक ____ चा शेवट नंबर', 'दिनांक ____ (पाळी) चा उत्पादन']);
});
test('dashboard monitoring reconciles daily production, dispatch, grades, and season cumulative', () => {
  const grades = [{ id: 'l30', code: 'L30', label: 'L30' }, { id: 'm30', code: 'M30', label: 'M30' }];
  const previous = { productionDate: new Date('2026-11-20T00:00:00.000Z'), stockLines: [{ gradeId: 'l30', production: 300, dispatch: 25 }] };
  const today = { productionDate: new Date('2026-11-21T00:00:00.000Z'), stockLines: [{ gradeId: 'l30', production: 200, dispatch: 40 }, { gradeId: 'm30', production: 100, dispatch: 50 }] };
  const result = buildProductionMonitoring('2026-11-08', '2026-11-21', [previous, today], [previous, today], grades, { L30: 62810, M30: 31170 });
  assert.equal(result.daily.length, 14);
  assert.deepEqual(result.daily.at(-2), { date: '2026-11-20', production: 300, dispatch: 25 });
  assert.deepEqual(result.daily.at(-1), { date: '2026-11-21', production: 300, dispatch: 90 });
  assert.deepEqual(result.grades, [{ code: 'L30', label: 'L30', production: 500, cumulative: 63310 }, { code: 'M30', label: 'M30', production: 100, cumulative: 31270 }]);
  assert.equal(result.cumulativeTotal, 94580);
});
test('dispatch beyond available stock is rejected', () => {
  assert.throws(() => calcStock({opening:20,production:5,dispatch:26}), /exceeds available/);
});

test('authorized stock adjustments apply signed deltas to the balance', () => {
  assert.equal(applyStockAdjustment(120, 15), 135);
  assert.equal(applyStockAdjustment(120, -20), 100);
});
test('stock adjustments reject negative balances and zero deltas', () => {
  assert.throws(() => applyStockAdjustment(10, -11), /negative/);
  assert.throws(() => applyStockAdjustment(10, 0), /non-zero/);
});

test('only the active chemist assigned to a shift can acknowledge it', () => {
  const assigned = { id: 'chemist-1', role: 'CHEMIST', active: true };
  assert.equal(isActiveShiftChemist(assigned), true);
  assert.equal(canAcknowledgeAssignedShiftChemist({ id: 'chemist-1', role: 'CHEMIST' }, assigned), true);
  assert.equal(canAcknowledgeAssignedShiftChemist({ id: 'chemist-2', role: 'CHEMIST' }, assigned), false);
  assert.equal(canAcknowledgeAssignedShiftChemist({ id: 'chemist-1', role: 'MANAGER' }, assigned), false);
  assert.equal(isActiveShiftChemist({ ...assigned, active: false }), false);
  assert.equal(isActiveShiftChemist(null), false);
});

test('chemists can view only assigned submitted registers and approved history', () => {
  assert.equal(canViewShiftRecordAsChemist('chemist-1', 'SUBMITTED', 'chemist-1'), true);
  assert.equal(canViewShiftRecordAsChemist('chemist-2', 'SUBMITTED', 'chemist-1'), false);
  assert.equal(canViewShiftRecordAsChemist('chemist-2', 'APPROVED', 'chemist-1'), true);
  assert.equal(canViewShiftRecordAsChemist('chemist-2', 'DRAFT', null), false);
});
