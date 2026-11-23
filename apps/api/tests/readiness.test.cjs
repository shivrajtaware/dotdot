const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseReadiness } = require('../dist/readiness.js');

test('readiness reports healthy only when the database probe succeeds', async () => {
  assert.deepEqual(await databaseReadiness(async () => 1), { status: 'ok', database: 'ok' });
  assert.deepEqual(await databaseReadiness(async () => { throw new Error('private connection detail'); }), {
    status: 'unavailable', database: 'unavailable',
  });
});
