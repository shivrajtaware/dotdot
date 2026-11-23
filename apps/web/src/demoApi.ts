// Deliberately fake, browser-only sample data for reviewing the interface.
// Nothing in this module is sent to the production API or persisted to a server.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const grades = [
  { id: 'grade-l30', code: 'L30', label: 'L 30', order: 0, active: true },
  { id: 'grade-m30', code: 'M30', label: 'M 30', order: 1, active: true },
  { id: 'grade-s130', code: 'S1-30', label: 'S1 30', order: 2, active: true },
  { id: 'grade-s230', code: 'S2-30', label: 'S2 30', order: 3, active: true },
];
const shifts = [
  { id: 'shift-a', label: 'Morning', startsAt: '06:00', endsAt: '14:00', chemistId: 'chemist-1' },
  { id: 'shift-b', label: 'Evening', startsAt: '14:00', endsAt: '22:00', chemistId: 'chemist-2' },
  { id: 'shift-c', label: 'Night', startsAt: '22:00', endsAt: '06:00', chemistId: 'chemist-1' },
];
const season = { id: 'season-demo', name: 'Demo season 2026–27', startDate: '2026-10-01T00:00:00.000Z', active: true, openingStock: { L30: 480, M30: 360, 'S1-30': 240, 'S2-30': 160 }, openingCumulative: { L30: 1250, M30: 980, 'S1-30': 760, 'S2-30': 410 } };
const user = { id: 'demo-owner', name: 'Demo Owner', email: 'demo@example.test', role: 'OWNER' as const, active: true };
const employees = [user, { id: 'manager-1', name: 'Demo Manager', email: 'manager@example.test', role: 'MANAGER', active: true }, { id: 'chemist-1', name: 'A. Patil', email: 'chemist1@example.test', role: 'CHEMIST', active: true }, { id: 'chemist-2', name: 'S. Jadhav', email: 'chemist2@example.test', role: 'CHEMIST', active: true }];
const stockValues = [
  { opening: 520, production: 118, dispatch: 72 },
  { opening: 388, production: 94, dispatch: 54 },
  { opening: 256, production: 63, dispatch: 38 },
  { opening: 172, production: 41, dispatch: 24 },
];
const stockLines = () => grades.map((grade, i) => ({ id: `line-${i}`, gradeId: grade.id, grade, ...stockValues[i], available: stockValues[i].opening + stockValues[i].production, closing: stockValues[i].opening + stockValues[i].production - stockValues[i].dispatch }));
const demoRecord = {
  id: 'record-demo-1042', registerNo: 1042, productionDate: `${today}T00:00:00.000Z`, seasonId: season.id,
  status: 'APPROVED', clerkNameSnapshot: 'Demo Manager', shiftLabelSnapshot: 'Morning',
  shift: shifts[0], shiftId: shifts[0].id, shiftStartsAtSnapshot: shifts[0].startsAt, shiftEndsAtSnapshot: shifts[0].endsAt,
  clerk: employees[1], clerkId: employees[1].id, assignedChemistId: 'chemist-1', assignedChemistNameSnapshot: 'A. Patil',
  season, version: 1, scaleCheckTime: '07:15', remarks: 'All figures verified against the shift book.',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  stockLines: stockLines(), timeEntries: [
    { id: 'entry-1', entryTime: '08:00', fromNumber: 101, toNumber: 246, bags: 146 },
    { id: 'entry-2', entryTime: '11:30', fromNumber: 247, toNumber: 416, bags: 170 },
  ],
  operational: ['Hopper filled', 'Hopper balance', 'Molasses', 'Road dispatch', 'Road balance'].map((labelSnapshot, i) => ({ id: `op-${i}`, code: `OP${i + 1}`, labelSnapshot, bags: [92, 18, 12, 72, 0][i] })),
  references: ['Previous shift last number', 'Current shift last number', 'Production slip number'].map((labelSnapshot, i) => ({ id: `ref-${i}`, code: `REF${i + 1}`, labelSnapshot, referenceDate: `${today}T00:00:00.000Z`, numberValue: [100, 219, 77][i] })),
  handovers: [
    { id: 'handover-1', kind: 'GIVEN', userId: 'manager-1', employeeNameSnapshot: 'Demo Manager', employeeRoleSnapshot: 'MANAGER', acknowledgedAt: new Date().toISOString() },
    { id: 'handover-2', kind: 'RECEIVED', userId: 'chemist-1', employeeNameSnapshot: 'A. Patil', employeeRoleSnapshot: 'CHEMIST', acknowledgedAt: new Date().toISOString() },
    { id: 'handover-3', kind: 'CHEMIST', userId: 'chemist-1', employeeNameSnapshot: 'A. Patil', employeeRoleSnapshot: 'CHEMIST', acknowledgedAt: new Date().toISOString() },
  ],
};
let records: any[] = [demoRecord, ...['Evening', 'Night', 'Morning', 'Evening', 'Night', 'Morning'].map((shiftLabel, i) => ({
  ...demoRecord, id: `record-demo-${1041 - i}`, registerNo: 1041 - i,
  productionDate: `${new Date(Date.now() - (i + 1) * 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`,
  shift: shifts.find((s) => s.label === shiftLabel) || shifts[0], shiftLabelSnapshot: shiftLabel,
  shiftId: shifts.find((s) => s.label === shiftLabel)?.id || shifts[0].id,
  status: i === 0 ? 'SUBMITTED' : 'APPROVED',
}))];
let demoUsers: any[] = [...employees];
let demoGrades: any[] = [...grades];
let demoSeasons: any[] = [season];
let demoShifts: any[] = [...shifts];
let nextRegister = 1044;
let demoMovements: any[] = [
  ...stockLines().flatMap((line) => [
    { id: `opening-${line.gradeId}`, grade: line.grade, productionDate: season.startDate, shiftLabel: '—', registerNo: null, type: 'OPENING', quantity: season.openingStock[line.grade.code as keyof typeof season.openingStock] || 0, balanceAfter: line.opening, reason: 'Sample season opening balance', creatorName: 'Demo Owner', createdAt: new Date().toISOString() },
    { id: `production-${line.gradeId}`, grade: line.grade, productionDate: `${today}T00:00:00.000Z`, shiftLabel: 'Morning', registerNo: demoRecord.registerNo, type: 'PRODUCTION', quantity: line.production, balanceAfter: line.opening + line.production, reason: 'Approved sample register', creatorName: 'Demo Owner', createdAt: new Date().toISOString() },
    { id: `dispatch-${line.gradeId}`, grade: line.grade, productionDate: `${today}T00:00:00.000Z`, shiftLabel: 'Morning', registerNo: demoRecord.registerNo, type: 'DISPATCH', quantity: -line.dispatch, balanceAfter: line.closing, reason: 'Godown dispatch', creatorName: 'Demo Owner', createdAt: new Date().toISOString() },
  ]),
];
let demoCorrections: any[] = [{ id: 'correction-demo-1', record: { ...records[1], shift: shifts[1] }, requester: { name: 'Demo Manager', role: 'MANAGER' }, reason: 'Sample correction request for preview.', proposedValues: { stock: [{ grade: 'L30', production: 119 }], timeEntries: [{ entryTime: '12:00', bags: 1 }] }, createdAt: new Date().toISOString() }];

const bootstrap = {
  grades, shifts, seasons: [season], employees, chemists: employees.filter((x) => x.role === 'CHEMIST'),
  settings: { companyName: 'Krushinath Green Energy', factoryName: 'Sugar House', openingStock: season.openingStock, operationalLabels: ['Hopper filled', 'Hopper balance', 'Molasses', 'Road dispatch', 'Road balance'] },
};
const dashboard = {
  date: today, totals: { production: 316, closing: 1464, dispatch: 188 }, pending: 1,
  grades: stockLines().map((line) => ({ code: line.grade.code, opening: line.opening, production: line.production, dispatch: line.dispatch, closing: line.closing })),
  shiftStatuses: [{ shiftId: shifts[0].id, registerNo: 1042, status: 'APPROVED', clerk: 'Demo Manager' }, { shiftId: shifts[1].id, registerNo: 1043, status: 'SUBMITTED', clerk: 'A. Patil' }],
  shifts: [{ shift: 'Morning', production: 316 }, { shift: 'Evening', production: 0 }, { shift: 'Night', production: 0 }],
  monitoring: { season: season.name, daily: Array.from({ length: 7 }, (_, i) => ({ date: new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10), production: [240, 318, 276, 345, 291, 362, 316][i], dispatch: [172, 214, 190, 236, 182, 243, 188][i] })), grades: grades.map((g, i) => ({ code: g.code, production: [2210, 1830, 1240, 810][i], cumulative: [3460, 2810, 2000, 1220][i] })), cumulativeTotal: 9490 },
  incomplete: 0, recentActivity: [{ id: 'activity-1', action: 'RECORD_APPROVED', user: { name: 'Demo Owner' }, createdAt: new Date().toISOString() }],
};

function demoWorkbook(): Blob {
  const rows: any[][] = [
    ['Production date', 'Shift', 'Register', 'Grade', 'Opening bags', 'Production bags', 'Dispatch bags', 'Closing bags'],
    ...records.flatMap((r) => r.stockLines.map((line: any) => [r.productionDate.slice(0, 10), r.shiftLabelSnapshot, r.registerNo, line.grade.code, line.opening, line.production, line.dispatch, line.closing])),
  ];
  const esc = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const col = (n: number) => { let out = ''; for (n++; n; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out; return out; };
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, ri) => `<row r="${ri + 1}">${row.map((value, ci) => { const ref = `${col(ci)}${ri + 1}`; return typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(String(value ?? ''))}</t></is></c>`; }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Demo report" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  };
  const enc = new TextEncoder();
  const crc32 = (bytes: Uint8Array) => { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320); } return (crc ^ -1) >>> 0; };
  const parts: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = enc.encode(name), data = enc.encode(content), crc = crc32(data);
    const local = new Uint8Array(30 + filename.length + data.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, filename.length, true); local.set(filename, 30); local.set(data, 30 + filename.length); parts.push(local);
    const dir = new Uint8Array(46 + filename.length), dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint32(16, crc, true); dv.setUint32(20, data.length, true); dv.setUint32(24, data.length, true); dv.setUint16(28, filename.length, true); dv.setUint32(42, offset, true); dir.set(filename, 46); central.push(dir); offset += local.length;
  }
  const centralSize = central.reduce((sum, p) => sum + p.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const archive = new Uint8Array(offset + centralSize + end.length); let cursor = 0;
  for (const part of [...parts, ...central, end]) { archive.set(part, cursor); cursor += part.length; }
  return new Blob([archive.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export const DEMO_USER = user;
export const DEMO_BOOTSTRAP = bootstrap;

export async function demoApi(path: string, options: RequestInit = {}): Promise<any> {
  const method = options.method || 'GET';
  const clean = path.split('?')[0];
  const input = options.body ? JSON.parse(String(options.body)) : {};
  const recordId = clean.split('/')[2];
  if (method !== 'GET') {
    if (clean === '/records') {
      const shift = demoShifts.find((s) => s.id === input.shiftId) || demoShifts[0];
      const next = { ...demoRecord, id: `record-demo-${nextRegister}`, registerNo: nextRegister++, productionDate: `${input.productionDate || today}T00:00:00.000Z`, seasonId: input.seasonId || season.id, status: 'DRAFT', version: 1, shift, shiftId: shift.id, shiftLabelSnapshot: shift.label, shiftStartsAtSnapshot: shift.startsAt, shiftEndsAtSnapshot: shift.endsAt, clerk: user, clerkId: user.id, clerkNameSnapshot: user.name, scaleCheckTime: input.scaleCheckTime || '', remarks: input.remarks || '', handovers: [], stockLines: (input.stock || []).map((line: any) => { const grade = demoGrades.find((g) => g.id === line.gradeId) || demoGrades[0]; return { ...line, id: `line-${grade.id}`, grade, available: Number(line.opening || 0) + Number(line.production || 0), closing: Number(line.opening || 0) + Number(line.production || 0) - Number(line.dispatch || 0) }; }), timeEntries: (input.timeEntries || []).map((entry: any, i: number) => ({ ...entry, id: `entry-${i}` })), operational: (input.operational || []).map((o: any, i: number) => ({ ...o, id: `op-${i}`, labelSnapshot: o.label })), references: (input.references || []).map((r: any, i: number) => ({ ...r, id: `ref-${i}`, labelSnapshot: r.label })) };
      records.unshift(next);
      return { record: next };
    }
    if (clean.startsWith('/records/') && clean.endsWith('/submit')) { const r = records.find((x) => x.id === recordId); if (r) r.status = 'SUBMITTED'; return { record: r || demoRecord }; }
    if (clean.startsWith('/records/') && clean.endsWith('/approve')) { const r = records.find((x) => x.id === recordId); if (r) r.status = 'APPROVED'; return { record: r || demoRecord, affectedRecords: 1 }; }
    if (clean.startsWith('/records/') && clean.endsWith('/handover')) { const r = records.find((x) => x.id === recordId) || demoRecord; r.handovers.push({ id: `handover-${r.handovers.length + 1}`, kind: input.kind, userId: user.id, employeeNameSnapshot: user.name, employeeRoleSnapshot: user.role, acknowledgedAt: new Date().toISOString(), signatureData: input.signatureData }); return { handover: r.handovers.at(-1) }; }
    if (clean.startsWith('/records/') && clean.endsWith('/corrections')) { demoCorrections.unshift({ id: `correction-demo-${Date.now()}`, record: records.find((x) => x.id === recordId) || demoRecord, requester: { name: user.name, role: user.role }, reason: input.reason, proposedValues: input.changes, createdAt: new Date().toISOString() }); return { correction: demoCorrections[0] }; }
    if (clean === '/inventory/adjustments') { const grade = demoGrades.find((g) => g.id === input.gradeId) || demoGrades[0]; const balanceAfter = (stockValues[demoGrades.indexOf(grade)]?.opening || 0) + Number(input.delta || 0); const movement = { id: `adjustment-${Date.now()}`, grade, productionDate: `${input.productionDate || today}T00:00:00.000Z`, shiftLabel: '—', registerNo: null, type: 'ADJUSTMENT', quantity: Number(input.delta), balanceAfter, reason: input.reason, creatorName: user.name, createdAt: new Date().toISOString() }; demoMovements.unshift(movement); return { balance: balanceAfter, movement }; }
    if (clean === '/admin/users') { const created = { id: `demo-user-${Date.now()}`, name: input.name, email: input.email, role: input.role, active: true }; demoUsers.unshift(created); return { user: created }; }
    if (clean.startsWith('/admin/users/')) { const target = demoUsers.find((x) => x.id === recordId); if (target && clean.endsWith('/password')) return { ok: true }; if (target) Object.assign(target, input); return { user: target || demoUsers[0] }; }
    if (clean === '/admin/grades') { const grade = { id: `grade-${Date.now()}`, ...input, active: true }; demoGrades.push(grade); return { grade }; }
    if (clean.startsWith('/admin/grades/')) { const grade = demoGrades.find((x) => x.id === recordId); if (grade) Object.assign(grade, input); return { grade: grade || demoGrades[0] }; }
    if (clean === '/admin/seasons') { const created = { id: `season-${Date.now()}`, ...input, active: true, startDate: `${input.startDate}T00:00:00.000Z` }; demoSeasons.unshift(created); return { season: created }; }
    if (clean.startsWith('/admin/seasons/')) { const target = demoSeasons.find((x) => x.id === recordId); if (target) Object.assign(target, input); return { season: target || season }; }
    if (clean.startsWith('/admin/settings/')) return { ok: true, key: recordId, value: input.value };
    if (clean === '/admin/register-sequence') { nextRegister = Number(input.nextNumber) || nextRegister; return { nextNumber: nextRegister }; }
    if (clean.startsWith('/admin/shifts/')) { const target = demoShifts.find((x) => x.id === recordId); if (target) Object.assign(target, input); return { shift: target || demoShifts[0] }; }
    if (clean.startsWith('/corrections/') && clean.endsWith('/approve')) { demoCorrections = demoCorrections.filter((x) => x.id !== recordId); return { affectedRecords: 1 }; }
    if (clean.startsWith('/corrections/') && clean.endsWith('/reject')) { demoCorrections = demoCorrections.filter((x) => x.id !== recordId); return { ok: true }; }
    if (clean.startsWith('/records/')) { const r = records.find((x) => x.id === recordId); if (r) Object.assign(r, input); return { record: r || demoRecord }; }
    throw new Error('This demo action is unavailable. No production data was changed.');
  }
  if (clean === '/auth/login' || clean === '/auth/refresh') return { token: 'demo-session', user };
  if (clean === '/auth/me') return { user };
  if (clean === '/auth/logout') return {};
  if (clean === '/bootstrap') return bootstrap;
  if (clean === '/dashboard') return dashboard;
  if (clean === '/records') { const q = new URLSearchParams(path.split('?')[1] || ''); return { records: records.filter((r) => (!q.get('status') || r.status === q.get('status')) && (!q.get('shiftId') || r.shiftId === q.get('shiftId')) && (!q.get('clerkId') || r.clerkId === q.get('clerkId')) && (!q.get('from') || r.productionDate.slice(0, 10) >= q.get('from')!) && (!q.get('to') || r.productionDate.slice(0, 10) <= q.get('to')!)) }; }
  if (clean.startsWith('/records/') && clean.split('/').length === 3) return { record: records.find((r) => r.id === recordId) || demoRecord };
  if (clean === '/inventory/ledger') return { records: records.filter((r) => ['APPROVED', 'LOCKED'].includes(r.status)), movements: demoMovements, balances: stockLines().map((l) => ({ gradeId: l.gradeId, code: l.grade.code, label: l.grade.label, quantity: l.closing })) };
  if (clean === '/inventory/opening') { const opening = Object.fromEntries(demoGrades.map((g, i) => [g.id, stockValues[i]?.opening || 0])); return { opening, fromRegister: 1041 }; }
  if (clean === '/summary/daily') { const rows = demoGrades.map((g) => { const dayRecords = records.filter((r) => r.productionDate.slice(0, 10) === (new URLSearchParams(path.split('?')[1] || '').get('date') || today)); const shiftsForDay = Object.fromEntries(demoShifts.map((s) => [s.label, dayRecords.filter((r) => r.shiftId === s.id).reduce((sum, r) => sum + Number(r.stockLines.find((x: any) => x.gradeId === g.id)?.production || 0), 0)])); const toDay = Object.values(shiftsForDay).reduce((a: number, b: any) => a + b, 0); const toDate = Number(season.openingCumulative[g.code as keyof typeof season.openingCumulative] || 0) + records.filter((r) => r.status === 'APPROVED').reduce((sum, r) => sum + Number(r.stockLines.find((x: any) => x.gradeId === g.id)?.production || 0), 0); return { gradeId: g.id, code: g.code, shifts: shiftsForDay, toDay, toDate }; }); return { rows, shiftLabels: demoShifts.map((s) => ({ id: s.id, label: s.label, sortOrder: demoShifts.indexOf(s) })) }; }
  if (clean === '/audit') return { entries: [{ id: 'audit-1', action: 'RECORD_APPROVED', user, createdAt: new Date().toISOString(), reason: 'Sample audit entry' }] };
  if (clean === '/corrections') return { corrections: demoCorrections };
  if (clean === '/admin/grades') return { grades: demoGrades };
  if (clean === '/admin/seasons') return { seasons: demoSeasons };
  if (clean === '/admin/users') return { users: demoUsers };
  if (clean === '/admin/register-sequence') return { nextNumber: nextRegister };
  if (clean.startsWith('/reports/')) { const kind = clean.split('/')[2].split('.')[0]; const csv = [['Production date', 'Shift', 'Register', 'Grade', 'Opening bags', 'Production bags', 'Dispatch bags', 'Closing bags'], ...records.flatMap((r) => r.stockLines.map((line: any) => [r.productionDate.slice(0, 10), r.shiftLabelSnapshot, r.registerNo, line.grade.code, line.opening, line.production, line.dispatch, line.closing]))].map((row: any[]) => row.map((v: any) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n'); if (clean.endsWith('.csv')) return new Blob([`Report: ${kind}\r\nDemo sample data only\r\n${csv}`], { type: 'text/csv;charset=utf-8' }); return demoWorkbook(); }
  return {};
}
