import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPendingDrafts } from '../src/offlineSync.mjs';

const baseDraft = (overrides = {}) => ({
  localId: '2026-11-21-shift-a',
  payload: { offlineId: 'offline-key-1', productionDate: '2026-11-21', shiftId: 'shift-a' },
  createdAt: '2026-11-21T08:00:00.000Z',
  pending: true,
  submitAfterSync: false,
  ...overrides
});

function harness(apiImpl) {
  const calls = [];
  const saved = [];
  const deleted = [];
  const api = async (path, options) => { calls.push({ path, options }); return apiImpl(path, options); };
  return {
    calls, saved, deleted, api,
    saveDraft: async draft => saved.push(draft),
    deleteDraft: async id => deleted.push(id)
  };
}

test('creates and submits a new offline shift when no server collision exists', async () => {
  const h = harness(async (path) => {
    if (path.startsWith('/records?')) return { records: [] };
    if (path === '/records') return { record: { id: 'server-1', version: 1 } };
    if (path === '/records/server-1/submit') return { record: { status: 'SUBMITTED' } };
    throw new Error(`Unexpected API path: ${path}`);
  });
  const result = await syncPendingDrafts({ drafts: [baseDraft({ submitAfterSync: true })], userId: 'clerk-1', ...h });
  assert.deepEqual(result, [{ localId: '2026-11-21-shift-a', status: 'synced' }]);
  assert.deepEqual(h.deleted, ['2026-11-21-shift-a']);
  assert.equal(h.calls.some(call => call.options?.method === 'PUT'), false);
});

test('preserves an offline draft rather than overwriting a matching server draft', async () => {
  const h = harness(async path => ({ records: [{ shiftId: 'shift-a', productionDate: '2026-11-21T00:00:00.000Z', clerkId: 'clerk-1', status: 'DRAFT' }] }));
  const result = await syncPendingDrafts({ drafts: [baseDraft()], userId: 'clerk-1', ...h });
  assert.equal(result[0].status, 'conflict');
  assert.match(h.saved[0].syncError, /not overwritten/);
  assert.equal(h.saved[0].pending, true);
  assert.equal(h.calls.some(call => call.options?.method === 'PUT'), false);
});

test('sends the opened version and stores the next server version', async () => {
  const h = harness(async (path, options) => {
    if (path === '/records/server-1' && options?.method === 'PUT') return { record: { id: 'server-1', version: 8 } };
    if (path === '/records/server-1') return { record: { id: 'server-1', status: 'DRAFT', version: 7 } };
    throw new Error(`Unexpected API request: ${path}`);
  });
  const result = await syncPendingDrafts({ drafts: [baseDraft({ serverId: 'server-1', serverVersion: 7 })], ...h });
  assert.equal(result[0].status, 'synced');
  const update = h.calls.find(call => call.options?.method === 'PUT');
  assert.equal(JSON.parse(update.options.body).expectedVersion, 7);
  assert.equal(h.saved[0].serverVersion, 8);
  assert.equal(h.saved[0].pending, false);
});

test('retains the updated version when the submit action fails', async () => {
  const h = harness(async (path, options) => {
    if (path === '/records/server-1' && options?.method === 'PUT') return { record: { id: 'server-1', version: 4 } };
    if (path === '/records/server-1') return { record: { id: 'server-1', status: 'DRAFT', version: 3 } };
    if (path === '/records/server-1/submit') throw new Error('All handover acknowledgements are required.');
    throw new Error(`Unexpected API request: ${path}`);
  });
  const result = await syncPendingDrafts({ drafts: [baseDraft({ serverId: 'server-1', serverVersion: 3, submitAfterSync: true })], ...h });
  assert.equal(result[0].status, 'conflict');
  assert.equal(h.saved.at(-1).serverVersion, 4);
  assert.equal(h.saved.at(-1).pending, true);
  assert.match(h.saved.at(-1).syncError, /handover acknowledgements/);
});

test('retries an offline create idempotently after the server response is lost', async () => {
  let serverRecord;
  const h = harness(async (path, options) => {
    if (path.startsWith('/records?')) return { records: serverRecord ? [serverRecord] : [] };
    if (path === '/records' && options?.method === 'POST') {
      serverRecord = { id: 'server-2', offlineId: 'offline-key-1', clerkId: 'clerk-1', shiftId: 'shift-a', productionDate: '2026-11-21T00:00:00.000Z', status: 'DRAFT', version: 1 };
      throw new Error('The server saved the record but the response was lost.');
    }
    if (path === '/records/server-2' && options?.method === 'PUT') {
      serverRecord.version = 2;
      return { record: serverRecord };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });

  const first = await syncPendingDrafts({ drafts: [baseDraft()], userId: 'clerk-1', ...h });
  assert.equal(first[0].status, 'conflict');
  const retryDraft = h.saved.at(-1);
  const retry = await syncPendingDrafts({ drafts: [retryDraft], userId: 'clerk-1', ...h });
  assert.equal(retry[0].status, 'synced');
  assert.equal(h.calls.filter(call => call.options?.method === 'POST').length, 1);
  assert.equal(h.calls.filter(call => call.options?.method === 'PUT').length, 1);
  assert.equal(h.saved.at(-1).pending, false);
});

test('cleans up a local draft when a submit request succeeded but its response was lost', async () => {
  const h = harness(async () => ({ record: { id: 'server-3', status: 'SUBMITTED' } }));
  const result = await syncPendingDrafts({
    drafts: [baseDraft({ serverId: 'server-3', serverVersion: 4, submitAfterSync: true, submitAttempted: true })],
    ...h
  });
  assert.equal(result[0].status, 'synced');
  assert.deepEqual(h.deleted, ['2026-11-21-shift-a']);
});
