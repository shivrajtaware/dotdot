const test = require('node:test');
const assert = require('node:assert/strict');
const { readInitialBalances, validateSeasonStartDate, validateSeedSeasonChoice } = require('../dist/seedConfig.js');

const grades = ['L30', 'M30', 'S1 30', 'S2 30'];
const verifiedEnv = {
  CONFIRM_INITIAL_BALANCES: 'true',
  OPENING_L30: '100', OPENING_M30: '0', OPENING_S1_30: '20', OPENING_S2_30: '5',
  CUMULATIVE_L30: '62810', CUMULATIVE_M30: '0', CUMULATIVE_S1_30: '500', CUMULATIVE_S2_30: '10',
};

test('initial balances require explicit confirmation and whole non-negative quantities', () => {
  assert.throws(() => readInitialBalances({ ...verifiedEnv, CONFIRM_INITIAL_BALANCES: 'false' }, grades), /CONFIRM_INITIAL_BALANCES=true/);
  assert.deepEqual(readInitialBalances(verifiedEnv, grades), {
    openingStock: { L30: 100, M30: 0, 'S1 30': 20, 'S2 30': 5 },
    openingCumulative: { L30: 62810, M30: 0, 'S1 30': 500, 'S2 30': 10 },
  });
  assert.throws(() => readInitialBalances({ ...verifiedEnv, OPENING_L30: '-1' }, grades), /non-negative whole number/);
  assert.throws(() => readInitialBalances({ ...verifiedEnv, CUMULATIVE_S2_30: '2.5' }, grades), /non-negative whole number/);
  assert.throws(() => readInitialBalances({ ...verifiedEnv, OPENING_M30: undefined }, grades), /non-negative whole number/);
});

test('season start date must be a real ISO calendar date', () => {
  assert.equal(validateSeasonStartDate('2026-10-01').toISOString(), '2026-10-01T00:00:00.000Z');
  assert.throws(() => validateSeasonStartDate('2026-02-29'), /real calendar date/);
  assert.throws(() => validateSeasonStartDate('01-10-2026'), /YYYY-MM-DD/);
});

test('seed cannot create a second active production season', () => {
  assert.equal(validateSeedSeasonChoice(null, '2026-27'), undefined);
  assert.equal(validateSeedSeasonChoice('2026-27', '2026-27'), undefined);
  assert.throws(() => validateSeedSeasonChoice('2025-26', '2026-27'), /Create another season through the owner settings/);
});
