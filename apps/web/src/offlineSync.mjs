export async function syncPendingDrafts({ drafts, api, userId, saveDraft, deleteDraft }) {
  const results = [];
  for (const original of drafts) {
    if (!original.pending) continue;
    let draft = original;
    let recordId = draft.serverId;
    try {
      const payload = draft.payload;
      let record;
      if (recordId) {
        const current = await api(`/records/${recordId}`);
        if (current.record.status !== 'DRAFT') {
          if (draft.submitAfterSync && draft.submitAttempted && ['SUBMITTED', 'APPROVED', 'LOCKED'].includes(current.record.status)) {
            await deleteDraft(draft.localId);
            results.push({ localId: draft.localId, status: 'synced' });
            continue;
          }
          throw new Error('The server record has moved beyond draft status. Compare it with this saved copy before deciding what to do.');
        }
        if (!draft.serverVersion) {
          throw new Error('This saved copy is missing its edit version. Reopen the server draft to compare it before syncing.');
        }
        const updated = await api(`/records/${recordId}`, {
          method: 'PUT',
          body: JSON.stringify({ ...payload, expectedVersion: draft.serverVersion })
        });
        record = updated.record;
      } else {
        const found = await api(`/records?from=${payload.productionDate}&to=${payload.productionDate}`);
        const existing = found.records.find(item => item.shiftId === payload.shiftId &&
          item.productionDate.slice(0, 10) === payload.productionDate && item.clerkId === userId);
        if (existing) {
          const offlineId = payload.offlineId || draft.localId;
          if (!offlineId || existing.offlineId !== offlineId || existing.status !== 'DRAFT') {
            throw new Error(existing.status === 'DRAFT'
              ? 'A server draft already exists for this date and shift. It was not overwritten. Open it from Shift records and compare the entries.'
              : 'A shift record already exists for this date and shift. Review the server record and this saved copy.');
          }
          recordId = existing.id;
          const updated = await api(`/records/${recordId}`, {
            method: 'PUT',
            body: JSON.stringify({ ...payload, expectedVersion: existing.version })
          });
          record = updated.record;
        } else {
          const created = await api('/records', { method: 'POST', body: JSON.stringify({ ...payload, offlineId: payload.offlineId || draft.localId }) });
          record = created.record;
          recordId = record.id;
        }
      }

      draft = { ...draft, serverId: recordId, serverVersion: record.version };
      if (draft.submitAfterSync) {
        draft = { ...draft, submitAttempted: true };
        await saveDraft(draft);
        await api(`/records/${recordId}/submit`, { method: 'POST', body: '{}' });
        await deleteDraft(draft.localId);
      } else {
        await saveDraft({ ...draft, pending: false, syncError: undefined });
      }
      results.push({ localId: draft.localId, status: 'synced' });
    } catch (error) {
      const failedDraft = {
        ...draft,
        serverId: recordId || undefined,
        syncError: error instanceof Error ? error.message : 'Could not sync this saved draft.'
      };
      await saveDraft(failedDraft);
      results.push({ localId: draft.localId, status: 'conflict', error: failedDraft.syncError });
    }
  }
  return results;
}
