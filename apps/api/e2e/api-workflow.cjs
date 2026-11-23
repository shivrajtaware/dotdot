const assert = require('node:assert/strict');

const base = process.env.E2E_API_BASE_URL;
const databaseUrl = process.env.E2E_DATABASE_URL;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;

if (!base || !databaseUrl || !ownerEmail || !ownerPassword) {
  throw new Error('Set E2E_API_BASE_URL, E2E_DATABASE_URL, E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD.');
}
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1).split('/').at(-1) || '');
if (!/(test|e2e)/i.test(databaseName)) {
  throw new Error('The E2E database name must contain "test" or "e2e". Do not run this workflow against production data.');
}

async function call(method, route, options = {}) {
  const headers = {};
  if (options.token) headers.authorization = 'Bearer ' + options.token;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;
  const response = await fetch(base.replace(/\/$/, '') + route, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
  return { response, data };
}

async function login(email, password) {
  const result = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(result.response.status, 200, 'Login failed: ' + JSON.stringify(result.data));
  return {
    token: result.data.token,
    user: result.data.user,
    refreshCookie: (result.response.headers.get('set-cookie') || '').split(';')[0]
  };
}

async function main() {
  const suffix = Date.now().toString();
  const health = await call('GET', '/health');
  assert.equal(health.response.status, 200);
  assert.equal((await call('GET', '/admin/users')).response.status, 401, 'Unauthenticated admin request must be rejected.');

  const owner = await login(ownerEmail, ownerPassword);
  const bootstrap = await call('GET', '/bootstrap', { token: owner.token });
  assert.equal(bootstrap.response.status, 200);
  assert.equal(bootstrap.data.grades.length, 4);
  const season = bootstrap.data.seasons[0];
  const shift = bootstrap.data.shifts.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0];
  assert.ok(season && shift, 'Seed the test database with a season and shifts first.');

  async function createUser(role, name) {
    const email = 'e2e-' + suffix + '-' + name.toLowerCase().replaceAll(' ', '-') + '@example.test';
    const result = await call('POST', '/admin/users', {
      token: owner.token,
      body: { name, email, password: 'E2E-Local-User-123!', role }
    });
    assert.equal(result.response.status, 201, 'Owner should create ' + role + ': ' + JSON.stringify(result.data));
    return { id: result.data.user.id, email, password: 'E2E-Local-User-123!' };
  }

  const manager = await createUser('MANAGER', 'E2E Manager One');
  const secondManager = await createUser('MANAGER', 'E2E Manager Two');
  const chemist = await createUser('CHEMIST', 'E2E Chemist One');
  const otherChemist = await createUser('CHEMIST', 'E2E Chemist Two');
  const viewer = await createUser('VIEWER', 'E2E Viewer');
  const managerSession = await login(manager.email, manager.password);
  const secondManagerSession = await login(secondManager.email, secondManager.password);
  const chemistSession = await login(chemist.email, chemist.password);
  const otherChemistSession = await login(otherChemist.email, otherChemist.password);
  const viewerSession = await login(viewer.email, viewer.password);
  const currentSequence = await call('GET', '/admin/register-sequence', { token: owner.token });
  assert.equal(currentSequence.response.status, 200);
  const configuredRegisterNo = currentSequence.data.nextNumber + 100;
  const setSequence = await call('PUT', '/admin/register-sequence', { token: owner.token, body: { nextNumber: configuredRegisterNo } });
  assert.equal(setSequence.response.status, 200);
  assert.equal(setSequence.data.nextNumber, configuredRegisterNo);
  assert.equal((await call('PUT', '/admin/register-sequence', { token: managerSession.token, body: { nextNumber: configuredRegisterNo + 1 } })).response.status, 403,
    'Register-number sequence changes are owner-only.');
  assert.equal((await call('GET', '/admin/users', { token: managerSession.token })).response.status, 403);
  assert.equal((await call('POST', '/records', { token: chemistSession.token, body: {} })).response.status, 403);
  assert.equal((await call('POST', '/records', { token: viewerSession.token, body: {} })).response.status, 403);
  assert.equal((await call('GET', '/admin/users', { token: viewerSession.token })).response.status, 403);

  const clearAssignment = await call('PUT', '/admin/shifts/' + shift.id, {
    token: owner.token,
    body: { label: shift.label, startsAt: shift.startsAt, endsAt: shift.endsAt, active: true, sortOrder: shift.sortOrder, chemistId: null }
  });
  assert.equal(clearAssignment.response.status, 200, 'The dedicated test database must allow changing the selected test shift.');

  const candidateDate = new Date(Math.max(Date.now(), new Date(season.startDate).getTime()));
  let date;
  for (let day = 0; day < 3650; day++) {
    const candidate = candidateDate.toISOString().slice(0, 10);
    const existing = await call('GET', '/records?from=' + candidate + '&to=' + candidate, { token: owner.token });
    assert.equal(existing.response.status, 200);
    if (!existing.data.records.length) { date = candidate; break; }
    candidateDate.setUTCDate(candidateDate.getUTCDate() + 1);
  }
  assert.ok(date, 'Find an unused production date for this test shift.');
  const opening = await call('GET', '/inventory/opening?date=' + date + '&shiftId=' + shift.id + '&seasonId=' + season.id, { token: managerSession.token });
  assert.equal(opening.response.status, 200);
  const grade = bootstrap.data.grades.find(g => g.code === 'L30') || bootstrap.data.grades[0];
  const openingLedger = await call('GET', '/inventory/ledger', { token: owner.token });
  assert.ok(openingLedger.data.movements.some(movement => movement.type === 'OPENING' && movement.seasonId === season.id && movement.gradeId === grade.id),
    'The configured season opening balance is recorded as a grade and season linked ledger transaction.');
  const emptyDateDashboard = await call('GET', '/dashboard?date=' + date, { token: owner.token });
  assert.equal(emptyDateDashboard.response.status, 200);
  assert.equal(emptyDateDashboard.data.grades.find(g => g.code === grade.code).opening, Number(season.openingStock?.[grade.code] || 0), 'Opening stock carries into a date before its first approved shift.');
  const payload = {
    offlineId: 'e2e-offline-' + suffix,
    productionDate: date,
    shiftId: shift.id,
    seasonId: season.id,
    scaleCheckTime: '11:55',
    stock: bootstrap.data.grades.map(g => ({
      gradeId: g.id,
      opening: Number(opening.data.opening[g.id] || 0),
      production: g.id === grade.id ? 50 : 0,
      dispatch: g.id === grade.id ? 30 : 0
    })),
    timeEntries: [],
    operational: bootstrap.data.settings.operationalLabels.map((_label, i) => ({ code: 'OP' + (i + 1), label: 'tampered label', bags: 0 })),
    references: [1, 2, 3].map(i => ({ code: 'REF' + i, label: 'tampered reference', numberValue: 0 }))
  };
  const beforeSeason = new Date(new Date(season.startDate).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  assert.equal((await call('POST', '/records', { token: managerSession.token, body: { ...payload, productionDate: beforeSeason } })).response.status, 400,
    'The API rejects new records dated before the selected season begins.');
  assert.equal((await call('POST', '/records', { token: managerSession.token, body: { ...payload, scaleCheckTime: '99:99' } })).response.status, 400,
    'The API rejects invalid clock times before saving a register.');
  const draft = await call('POST', '/records', { token: managerSession.token, body: payload });
  assert.equal(draft.response.status, 201, 'Create a test shift draft: ' + JSON.stringify(draft.data));
  const recordId = draft.data.record.id;
  const repeatedCreate = await call('POST', '/records', { token: managerSession.token, body: payload });
  assert.equal(repeatedCreate.response.status, 200, 'A repeated offline request returns its original server record.');
  assert.equal(repeatedCreate.data.record.id, recordId, 'Idempotent create does not allocate a second register.');
  assert.equal(draft.data.record.registerNo, configuredRegisterNo, 'New registers use the configured sequence.');
  const savedDraft = await call('GET', '/records/' + recordId, { token: managerSession.token });
  assert.deepEqual(savedDraft.data.record.operational.map(item => item.labelSnapshot), bootstrap.data.settings.operationalLabels,
    'Managers cannot overwrite administrator-configured operational labels.');
  assert.deepEqual(savedDraft.data.record.references.map(item => item.labelSnapshot), [
    'दिनांक ____ चा शेवट नंबर', 'दिनांक ____ चा शेवट नंबर', 'दिनांक ____ (पाळी) चा उत्पादन'
  ], 'Managers cannot overwrite the physical register reference labels.');
  assert.equal((await call('PUT', '/admin/register-sequence', { token: owner.token, body: { nextNumber: configuredRegisterNo } })).response.status, 409,
    'The sequence cannot be reset to a number already in use.');
  assert.equal((await call('GET', '/dashboard?date=' + date, { token: managerSession.token })).data.incomplete, 1, 'Manager sees their incomplete draft count.');
  assert.equal((await call('GET', '/dashboard?date=' + date, { token: secondManagerSession.token })).data.incomplete, 0, 'Manager draft counts remain private to that manager.');
  const mismatchedSubmit = await call('POST', '/records/' + recordId + '/submit', { token: managerSession.token, body: {} });
  assert.equal(mismatchedSubmit.response.status, 409, 'A production register with no time-wise number entries cannot be submitted.');
  assert.match(mismatchedSubmit.data.error, /Time-wise production total/);
  const correctedDraft = await call('PUT', '/records/' + recordId, {
    token: managerSession.token,
    body: { ...payload, timeEntries: [{ entryTime: '11:00', fromNumber: 1, toNumber: 50, bags: 50 }], expectedVersion: 1 }
  });
  assert.equal(correctedDraft.response.status, 200, 'The manager can complete the time-wise entries before submission.');
  assert.equal((await call('POST', '/records/' + recordId + '/submit', { token: managerSession.token, body: {} })).response.status, 409,
    'A shift cannot be submitted before a chemist is assigned.');

  const assigned = await call('PUT', '/admin/shifts/' + shift.id, {
    token: owner.token,
    body: { label: shift.label, startsAt: shift.startsAt, endsAt: shift.endsAt, active: true, sortOrder: shift.sortOrder, chemistId: chemist.id }
  });
  assert.equal(assigned.response.status, 200);
  const submitted = await call('POST', '/records/' + recordId + '/submit', { token: managerSession.token, body: {} });
  assert.equal(submitted.response.status, 200, 'Assigned chemist permits submission: ' + JSON.stringify(submitted.data));
  assert.equal(submitted.data.record.assignedChemistId, chemist.id, 'Submission snapshots the assigned chemist.');
  const handoverManagerDashboard = await call('GET', '/dashboard?date=' + date, { token: secondManagerSession.token });
  assert.equal(handoverManagerDashboard.data.shiftStatuses.find(s => s.id === recordId).status, 'SUBMITTED', 'The receiving manager can see a submitted handover register.');
  assert.equal((await call('GET', '/records/' + recordId, { token: otherChemistSession.token })).response.status, 403, 'A chemist must not inspect another chemist\'s submitted record.');
  const otherChemistList = await call('GET', '/records?from=' + date + '&to=' + date + '&shiftId=' + shift.id, { token: otherChemistSession.token });
  assert.equal(otherChemistList.response.status, 200);
  assert.equal(otherChemistList.data.records.some(record => record.id === recordId), false, 'Assigned chemist scope must apply to record lists.');
  assert.equal((await call('POST', '/records/' + recordId + '/handover', { token: otherChemistSession.token, body: { kind: 'CHEMIST' } })).response.status, 403);
  assert.equal((await call('POST', '/records/' + recordId + '/handover', { token: managerSession.token, body: { kind: 'GIVEN' } })).response.status, 200);
  assert.equal((await call('POST', '/records/' + recordId + '/handover', { token: secondManagerSession.token, body: { kind: 'GIVEN' } })).response.status, 409,
    'A different employee cannot replace an already recorded handover acknowledgement.');
  assert.equal((await call('POST', '/records/' + recordId + '/handover', { token: managerSession.token, body: { kind: 'GIVEN' } })).response.status, 200,
    'The same employee can safely retry their existing acknowledgement.');
  assert.equal((await call('POST', '/records/' + recordId + '/handover', { token: secondManagerSession.token, body: { kind: 'RECEIVED' } })).response.status, 200);
  assert.equal((await call('POST', '/records/' + recordId + '/handover', { token: chemistSession.token, body: { kind: 'CHEMIST' } })).response.status, 200);
  assert.equal((await call('POST', '/records/' + recordId + '/approve', { token: otherChemistSession.token, body: {} })).response.status, 403,
    'Only the assigned chemist or owner may approve the submitted register.');

  const simultaneousApprovals = await Promise.all([
    call('POST', '/records/' + recordId + '/approve', { token: owner.token, body: {} }),
    call('POST', '/records/' + recordId + '/approve', { token: chemistSession.token, body: {} })
  ]);
  assert.deepEqual(simultaneousApprovals.map(result => result.response.status).sort(), [200, 409],
    'Concurrent approval requests must transition and post inventory exactly once.');
  const approval = simultaneousApprovals.find(result => result.response.status === 200);
  assert.equal(approval.data.record.status, 'LOCKED');
  const postedMovements = await call('GET', '/reports/movement.csv?from=' + date + '&to=' + date, { token: owner.token });
  assert.equal(postedMovements.response.status, 200);
  const movementsForRegister = postedMovements.data.split(/\r?\n/).filter(line => line.split(',')[7] === '"' + configuredRegisterNo + '"');
  assert.deepEqual(movementsForRegister.map(line => line.split(',')[4].replaceAll('"', '')).sort(),
    ['DISPATCH', 'PRODUCTION', 'PRODUCTION', 'PRODUCTION', 'PRODUCTION'],
    'Concurrent approvals create exactly one production movement per grade and one dispatch movement.');
  assert.equal((await call('GET', '/records/' + recordId, { token: viewerSession.token })).response.status, 200, 'A read-only viewer can inspect approved history.');
  const ownerDashboard = await call('GET', '/dashboard?date=' + date, { token: owner.token });
  assert.equal(ownerDashboard.response.status, 200);
  assert.equal(ownerDashboard.data.monitoring.daily.length, 14);
  assert.deepEqual(ownerDashboard.data.monitoring.daily.at(-1), { date, production: 50, dispatch: 30 });
  const monitoredGrade = ownerDashboard.data.monitoring.grades.find(g => g.code === grade.code);
  assert.equal(monitoredGrade.production, 50);
  assert.equal(monitoredGrade.cumulative, Number(season.openingCumulative?.[grade.code] || 0) + 50);
  assert.equal(ownerDashboard.data.shiftStatuses.find(s => s.shift === shift.label).status, 'LOCKED');
  const secondManagerDashboard = await call('GET', '/dashboard?date=' + date, { token: secondManagerSession.token });
  assert.equal(secondManagerDashboard.response.status, 200);
  assert.equal(secondManagerDashboard.data.shiftStatuses.some(s => s.id === recordId), false, 'A manager dashboard must not expose another manager\'s register.');
  const otherManagerAccess = await call('GET', '/records/' + recordId, { token: secondManagerSession.token });
  assert.equal(otherManagerAccess.response.status, 403);
  assert.equal(otherManagerAccess.data.record, undefined, 'A manager must not receive another manager\'s record.');

  const ledger = await call('GET', '/inventory/ledger', { token: owner.token });
  assert.equal(ledger.response.status, 200);
  const balance = ledger.data.balances.find(g => g.gradeId === grade.id);
  assert.equal(balance.quantity, Number(opening.data.opening[grade.id] || 0) + 20, 'Opening + 50 production - 30 dispatch is reflected in the ledger.');
  const workbook = await fetch(base.replace(/\/$/, '') + '/reports/daily.xlsx?from=' + date + '&to=' + date, { headers: { authorization: 'Bearer ' + owner.token } });
  assert.equal(workbook.status, 200);
  assert.match(workbook.headers.get('content-type'), /spreadsheet/);
  const workbookBytes = Buffer.from(await workbook.arrayBuffer());
  assert.equal(workbookBytes.subarray(0, 2).toString(), 'PK', 'Excel export must be a ZIP-based workbook.');
  const audit = await call('GET', '/audit?recordId=' + recordId, { token: owner.token });
  assert.equal(audit.response.status, 200);
  assert.ok(audit.data.entries.some(entry => entry.action === 'RECORD_APPROVED_AND_LOCKED'));

  const resetPassword = await call('POST', '/admin/users/' + secondManager.id + '/password', {
    token: owner.token, body: { password: 'E2E-Local-Reset-456!' }
  });
  assert.equal(resetPassword.response.status, 200);
  assert.equal((await call('POST', '/auth/refresh', { cookie: secondManagerSession.refreshCookie, body: {} })).response.status, 401,
    'Password reset revokes existing refresh sessions.');
  assert.equal((await login(secondManager.email, 'E2E-Local-Reset-456!')).user.role, 'MANAGER');

  const promoteViewer = await call('PATCH', '/admin/users/' + viewer.id, { token: owner.token, body: { role: 'OWNER' } });
  assert.equal(promoteViewer.response.status, 200);
  assert.ok(promoteViewer.data.revokedSessions >= 1, 'Role changes revoke existing refresh sessions.');
  assert.equal((await call('GET', '/admin/users', { token: viewerSession.token })).response.status, 200,
    'An access token uses the current database role after an owner changes the account role.');
  assert.equal((await call('POST', '/auth/refresh', { cookie: viewerSession.refreshCookie, body: {} })).response.status, 401);

  const deactivateManager = await call('PATCH', '/admin/users/' + secondManager.id, { token: owner.token, body: { active: false } });
  assert.equal(deactivateManager.response.status, 200);
  assert.ok(deactivateManager.data.revokedSessions >= 1, 'Deactivation revokes existing refresh sessions.');
  assert.equal((await call('GET', '/bootstrap', { token: secondManagerSession.token })).response.status, 401,
    'A deactivated account loses access immediately, before its access token expires.');

  const correctedStock = payload.stock.map(line => ({
    ...line,
    production: line.gradeId === grade.id ? 55 : 0
  }));
  const invalidOpeningCorrection = await call('POST', '/records/' + recordId + '/corrections', {
    token: managerSession.token,
    body: {
      reason: 'Check that an opening balance cannot break ledger continuity.',
      changes: { stock: correctedStock.map(line => line.gradeId === grade.id ? { ...line, opening: line.opening + 1 } : line) }
    }
  });
  assert.equal(invalidOpeningCorrection.response.status, 201);
  assert.equal((await call('POST', '/corrections/' + invalidOpeningCorrection.data.correction.id + '/approve', {
    token: owner.token, body: {}
  })).response.status, 409, 'Owner correction cannot change the opening away from carried-forward stock.');
  assert.equal((await call('POST', '/corrections/' + invalidOpeningCorrection.data.correction.id + '/reject', {
    token: managerSession.token, body: { reason: 'This role cannot reject corrections.' }
  })).response.status, 403, 'Only the owner can reject correction requests.');
  assert.equal((await call('POST', '/corrections/' + invalidOpeningCorrection.data.correction.id + '/reject', {
    token: owner.token, body: { reason: 'Opening does not match the approved carried balance.' }
  })).response.status, 200, 'The owner can reject and resolve an invalid correction request with an audit reason.');
  const correctionRequest = await call('POST', '/records/' + recordId + '/corrections', {
    token: managerSession.token,
    body: {
      reason: 'The recorded production quantity was five bags short.',
      changes: {
        stock: correctedStock,
        timeEntries: [{ entryTime: '11:00', fromNumber: 1, toNumber: 55, bags: 55 }]
      }
    }
  });
  assert.equal(correctionRequest.response.status, 201, 'Manager can submit a reasoned correction request for their locked register.');
  const pendingCorrections = await call('GET', '/corrections', { token: owner.token });
  assert.equal(pendingCorrections.response.status, 200);
  assert.equal(pendingCorrections.data.corrections.some(item => item.id === correctionRequest.data.correction.id), true);
  assert.equal((await call('POST', '/corrections/' + correctionRequest.data.correction.id + '/approve', {
    token: managerSession.token, body: {}
  })).response.status, 403, 'Only the owner can approve a correction request.');
  const appliedCorrection = await call('POST', '/corrections/' + correctionRequest.data.correction.id + '/approve', {
    token: owner.token, body: {}
  });
  assert.equal(appliedCorrection.response.status, 200, 'Owner correction approval recalculates the locked stock movement.');
  assert.equal(appliedCorrection.data.affectedRecords, 1);
  const correctedRecord = await call('GET', '/records/' + recordId, { token: managerSession.token });
  assert.equal(correctedRecord.response.status, 200);
  assert.equal(correctedRecord.data.record.stockLines.find(line => line.gradeId === grade.id).production, 55);
  assert.equal(correctedRecord.data.record.timeEntries.reduce((sum, entry) => sum + entry.bags, 0), 55);
  const correctedLedger = await call('GET', '/inventory/ledger', { token: owner.token });
  assert.equal(correctedLedger.data.balances.find(item => item.gradeId === grade.id).quantity,
    Number(opening.data.opening[grade.id] || 0) + 25, 'The corrected production and original dispatch reconcile in the ledger.');
  const correctionAudit = await call('GET', '/audit?recordId=' + recordId, { token: owner.token });
  assert.ok(correctionAudit.data.entries.some(entry => entry.action === 'CORRECTION_APPLIED'));
  assert.ok(correctionAudit.data.entries.some(entry => entry.action === 'CORRECTION_REJECTED' && entry.reason === 'Opening does not match the approved carried balance.'));

  const changedShift = await call('PUT', '/admin/shifts/' + shift.id, {
    token: owner.token,
    body: { label: 'E2E ' + suffix.slice(-8), startsAt: '05:00', endsAt: '13:00', active: true, sortOrder: shift.sortOrder, chemistId: chemist.id }
  });
  assert.equal(changedShift.response.status, 200, 'The owner can reconfigure a shift for later registers.');
  const renamedManager = await call('PATCH', '/admin/users/' + manager.id, { token: owner.token, body: { name: 'E2E Renamed Manager' } });
  assert.equal(renamedManager.response.status, 200);
  const historicalRecord = await call('GET', '/records/' + recordId, { token: owner.token });
  assert.equal(historicalRecord.data.record.shiftLabelSnapshot, shift.label);
  assert.equal(historicalRecord.data.record.shiftStartsAtSnapshot, shift.startsAt);
  assert.equal(historicalRecord.data.record.shiftEndsAtSnapshot, shift.endsAt);
  assert.equal(historicalRecord.data.record.clerkNameSnapshot, 'E2E Manager One');
  assert.deepEqual(historicalRecord.data.record.handovers.map(item => [item.employeeNameSnapshot, item.employeeRoleSnapshot]).sort(), [
    ['E2E Chemist One', 'CHEMIST'], ['E2E Manager One', 'MANAGER'], ['E2E Manager Two', 'MANAGER']
  ]);
  const renamedShiftDashboard = await call('GET', '/dashboard?date=' + date, { token: owner.token });
  assert.equal(renamedShiftDashboard.data.shiftStatuses.find(item => item.shiftId === shift.id).status, 'LOCKED',
    'Dashboard shift matching remains stable when the owner renames a shift.');
  const historicalSummary = await call('GET', '/summary/daily?date=' + date + '&seasonId=' + season.id, { token: owner.token });
  assert.equal(historicalSummary.data.shiftLabels.find(item => item.id === shift.id).label, shift.label,
    'Historical daily summary keeps the shift label saved on its register.');
  assert.equal(historicalSummary.data.rows.find(item => item.gradeId === grade.id).shifts[shift.label], 55,
    'Historical daily production stays under its saved shift label after reconfiguration.');
  const historicalReport = await call('GET', '/reports/daily.csv?from=' + date + '&to=' + date, { token: owner.token });
  assert.equal(historicalReport.response.status, 200);
  assert.match(historicalReport.data, new RegExp(shift.label));
  assert.match(historicalReport.data, /E2E Manager One/);
  const movementReport = await call('GET', '/reports/movement.csv?from=' + date + '&to=' + date + '&seasonId=' + season.id, { token: owner.token });
  assert.equal(movementReport.response.status, 200);
  assert.match(movementReport.data, /"Transaction","Date","Shift","Grade","Type","Quantity","Balance after","Register","Employee","Reason","Created at"/);
  assert.match(movementReport.data, new RegExp(shift.label));

  console.log('API E2E passed: role isolation, handover, locking, corrections, historical snapshots, dashboard, stock, audit, movement export, XLSX and session revocation.');
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });

