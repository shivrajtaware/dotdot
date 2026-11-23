const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClerkSummaryRows, buildCumulativeProductionRows, buildOpeningClosingReportRows } = require('../dist/reports.js');

const record = ({ registerNo, productionDate, shift, clerk, lines }) => ({
  registerNo,
  productionDate,
  shift: { label: shift.label, sortOrder: shift.order },
  clerk: { id: clerk.id, name: clerk.name },
  stockLines: lines.map(([code, opening, production, dispatch]) => ({
    grade: { code },
    opening,
    production,
    available: opening + production,
    dispatch,
    closing: opening + production - dispatch,
  })),
});

const registers = [
  record({
    registerNo: 101,
    productionDate: new Date('2026-11-20T00:00:00.000Z'),
    shift: { label: '4-12', order: 0 },
    clerk: { id: 'clerk-a', name: 'Asha' },
    lines: [['L30', 100, 20, 5], ['M30', 50, 10, 0]],
  }),
  record({
    registerNo: 102,
    productionDate: '2026-11-20',
    shift: { label: '12-8', order: 1 },
    clerk: { id: 'clerk-a', name: 'Asha' },
    lines: [['L30', 115, 30, 10], ['M30', 60, 5, 2]],
  }),
  record({
    registerNo: 103,
    productionDate: new Date('2026-11-21T00:00:00.000Z'),
    shift: { label: '4-12', order: 0 },
    clerk: { id: 'clerk-b', name: 'Ravi' },
    lines: [['L30', 135, 15, 3]],
  }),
];

test('opening and closing report includes every grade from every selected shift', () => {
  const rows = buildOpeningClosingReportRows(registers);
  assert.deepEqual(rows[0], ['Register', 'Date', 'Shift', 'Grade', 'Opening', 'Production', 'Available', 'Dispatch', 'Closing']);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[1], [101, '2026-11-20', '4-12', 'L30', 100, 20, 120, 5, 115]);
  assert.deepEqual(rows[3], [102, '2026-11-20', '12-8', 'L30', 115, 30, 145, 10, 135]);
  assert.deepEqual(rows[5], [103, '2026-11-21', '4-12', 'L30', 135, 15, 150, 3, 147]);
});

test('clerk report groups approved records and uses each clerk latest closing balance', () => {
  const rows = buildClerkSummaryRows(registers);
  assert.deepEqual(rows[0], ['Clerk', 'Approved records', 'Production bags', 'Godown bags dispatched', 'Latest date', 'Latest register', 'Latest closing bags']);
  assert.deepEqual(rows[1], ['Asha', 2, 65, 17, '2026-11-20', 102, 198]);
  assert.deepEqual(rows[2], ['Ravi', 1, 15, 3, '2026-11-21', 103, 147]);
});

test('cumulative report uses selected season opening balances before the filtered range', () => {
  const rows = buildCumulativeProductionRows([
    { productionDate: '2026-10-01', stockLines: [{ grade: { code: 'L30' }, production: 100 }] },
    { productionDate: '2026-10-02', stockLines: [{ grade: { code: 'L30' }, production: 25 }, { grade: { code: 'M30' }, production: 5 }] },
    { productionDate: '2026-11-01', stockLines: [{ grade: { code: 'L30' }, production: 10 }] },
  ], { L30: 1000, M30: 200 }, '2026-11-01', '2026-11-30');
  assert.deepEqual(rows, [
    ['Date', 'Grade', 'Daily bags', 'To date bags'],
    ['2026-11-01', 'L30', 10, 1135],
  ]);
});

test('historical register exports prefer saved shift and clerk labels', () => {
  const historical = [{
    ...registers[0],
    shiftLabelSnapshot: '4-12 at entry',
    shiftSortOrderSnapshot: 0,
    clerkNameSnapshot: 'Asha at entry',
  }];
  assert.equal(buildOpeningClosingReportRows(historical)[1][2], '4-12 at entry');
  assert.deepEqual(buildClerkSummaryRows(historical)[1], ['Asha at entry', 1, 30, 5, '2026-11-20', 101, 175]);
});
