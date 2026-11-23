const test = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const { buildXlsx } = require('../dist/excel.js');

test('Excel export is a valid multi-sheet OOXML workbook', () => {
  const buffer = buildXlsx([
    { name: 'Selected report', rows: [['Grade', 'Bags'], ['L30', 42]] },
    { name: 'Godown Dispatch', rows: [['Date', 'Quantity'], ['2026-11-21', 7]] },
  ]);
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4b);
  const files = unzipSync(buffer);
  const workbook = strFromU8(files['xl/workbook.xml']);
  const firstSheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(workbook, /Selected report/);
  assert.match(workbook, /Godown Dispatch/);
  assert.match(firstSheet, /L30/);
  assert.match(firstSheet, /<v>42<\/v>/);
});

test('Excel export escapes text and replaces forbidden sheet-name characters', () => {
  const buffer = buildXlsx([{ name: 'bad/name', rows: [['A&B'], ['<safe>']] }]);
  const files = unzipSync(buffer);
  assert.match(strFromU8(files['xl/workbook.xml']), /bad_name/);
  assert.match(strFromU8(files['xl/worksheets/sheet1.xml']), /A&amp;B/);
  assert.match(strFromU8(files['xl/worksheets/sheet1.xml']), /&lt;safe&gt;/);
});
