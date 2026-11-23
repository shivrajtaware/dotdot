import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateBootstrap } from '../src/bootstrapCache.mjs';
import { canSyncOfflineDrafts, readCachedManager, shouldPersistLocally } from '../src/offlineSession.mjs';

test('cold offline start restores the cached employee, shifts, grades, and settings bootstrap', async () => {
  const cached = { employees: [{ id: 'clerk-1' }], shifts: [{ id: 'night' }], grades: [{ id: 'l30' }], settings: { operationalLabels: ['saved'] } };
  const applied = [];
  const result = await hydrateBootstrap({
    online: false,
    readCached: async () => cached,
    loadRemote: async () => { throw new Error('must not call API while offline'); },
    saveRemote: async () => assert.fail('offline data must not be saved as new server data'),
    setValue: value => applied.push(value),
  });
  assert.equal(result, cached);
  assert.deepEqual(applied, [cached]);
});

test('transient API failure keeps cached bootstrap without signing out or replacing it', async () => {
  const cached = { shifts: [{ id: 'day' }] };
  const applied = [];
  const result = await hydrateBootstrap({
    online: true,
    readCached: async () => cached,
    loadRemote: async () => { throw new TypeError('network unavailable'); },
    saveRemote: async () => assert.fail('failed response must not replace cached data'),
    setValue: value => applied.push(value),
  });
  assert.equal(result, cached);
  assert.deepEqual(applied, [cached]);
});

test('reconnected client replaces cached bootstrap only after server load succeeds', async () => {
  const cached = { shifts: [{ id: 'old' }] };
  const remote = { shifts: [{ id: 'new' }] };
  const applied = [];
  let saved;
  const result = await hydrateBootstrap({
    online: true,
    readCached: async () => cached,
    loadRemote: async () => remote,
    saveRemote: async value => { saved = value; },
    setValue: value => applied.push(value),
  });
  assert.equal(result, remote);
  assert.equal(saved, remote);
  assert.deepEqual(applied, [cached, remote]);
});

test('failed online bootstrap without an existing cache remains an error', async () => {
  const failure = new TypeError('network unavailable');
  await assert.rejects(hydrateBootstrap({
    online: true,
    readCached: async () => undefined,
    loadRemote: async () => { throw failure; },
    saveRemote: async () => {},
    setValue: () => {},
  }), error => error === failure);
});

test('only cached manager profiles open the offline draft workspace', async () => {
  const manager = { id: 'manager-1', role: 'MANAGER', name: 'Manager' };
  assert.equal(await readCachedManager(async () => manager), manager);
  assert.equal(await readCachedManager(async () => ({ id: 'owner-1', role: 'OWNER' })), null);
  assert.equal(await readCachedManager(async () => { throw new Error('cache unavailable'); }), null);
});

test('offline-only sessions save locally and never start server synchronization', () => {
  assert.equal(shouldPersistLocally(false, false), true);
  assert.equal(shouldPersistLocally(true, true), true);
  assert.equal(shouldPersistLocally(true, false), false);
  assert.equal(canSyncOfflineDrafts(true, true, false), true);
  assert.equal(canSyncOfflineDrafts(true, false, true), false);
  assert.equal(canSyncOfflineDrafts(true, true, true), false);
  assert.equal(canSyncOfflineDrafts(false, true, false), false);
});
