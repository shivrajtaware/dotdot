export type StockInputs = { opening: number; production: number; dispatch: number };
export function factoryProductionDate(now = new Date(), dayBoundary = '04:00') {
  const boundary = /^(\d{2}):(\d{2})$/.exec(dayBoundary);
  const boundaryHour = boundary ? Number(boundary[1]) : Number.NaN;
  const boundaryMinute = boundary ? Number(boundary[2]) : Number.NaN;
  if (!Number.isInteger(boundaryHour) || boundaryHour < 0 || boundaryHour > 23 || !Number.isInteger(boundaryMinute) || boundaryMinute < 0 || boundaryMinute > 59) {
    throw new Error('Factory day boundary must be a valid 24-hour time.');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const calendarDate = `${values.year}-${values.month}-${values.day}`;
  const localMinutes = Number(values.hour) * 60 + Number(values.minute);
  if (localMinutes >= boundaryHour * 60 + boundaryMinute) return calendarDate;
  const previous = new Date(`${calendarDate}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

export function resolveProductionDate(value: unknown, now = new Date()): string | null {
  if (value === undefined) return factoryProductionDate(now);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

export function resolveProductionDateRange(fromValue: unknown, toValue: unknown, now = new Date()) {
  const from = fromValue === undefined ? '2000-01-01' : resolveProductionDate(fromValue, now);
  const to = toValue === undefined ? factoryProductionDate(now) : resolveProductionDate(toValue, now);
  if (!from || !to || from > to) return null;
  return { from, to };
}

export function resolveOptionalProductionDateRange(fromValue: unknown, toValue: unknown) {
  const from = fromValue === undefined ? undefined : resolveProductionDate(fromValue);
  const to = toValue === undefined ? undefined : resolveProductionDate(toValue);
  if ((fromValue !== undefined && !from) || (toValue !== undefined && !to) || (from && to && from > to)) return null;
  return { from, to };
}

export function calcStock({ opening, production, dispatch }: StockInputs) {
  if (![opening, production, dispatch].every(n => Number.isInteger(n) && n >= 0)) throw new Error('Stock quantities must be non-negative whole numbers.');
  const available = opening + production;
  if (dispatch > available) throw new Error('Dispatch exceeds available stock.');
  return { opening, production, available, dispatch, closing: available - dispatch };
}
export function sumGradeProduction(rows: Array<{ production: number }>) { return rows.reduce((total, row) => total + row.production, 0); }
export function timeEntriesMatchProduction(entries: Array<{ bags: number }>, production: number) {
  return entries.reduce((total, entry) => total + entry.bags, 0) === production;
}
export function addCumulative(previous: number, today: number) { return previous + today; }
export function productionDateWithinSeason(date: Date, season: { startDate: Date; endDate: Date | null }) {
  return date >= season.startDate && (!season.endDate || date < season.endDate);
}
export function normalizeOperationalSnapshots(configuredLabels: unknown, inputs: Array<{ code: string; label: string; bags: number }>) {
  if (!Array.isArray(configuredLabels) || configuredLabels.length !== 5 || configuredLabels.some(label => typeof label !== 'string' || !label.trim())) {
    throw new Error('Operational field labels are not configured correctly.');
  }
  if (inputs.length !== 5 || new Set(inputs.map(input => input.code)).size !== 5) {
    throw new Error('Provide each of the five operational counts once.');
  }
  return configuredLabels.map((label, index) => {
    const code = `OP${index + 1}`;
    const input = inputs.find(item => item.code === code);
    if (!input) throw new Error('Operational count codes do not match the configured fields.');
    return { code, labelSnapshot: label as string, bags: input.bags };
  });
}
export function preserveOperationalSnapshots(existing: Array<{ code: string; labelSnapshot: string }>, inputs: Array<{ code: string; label: string; bags: number }>) {
  if (inputs.length !== existing.length || new Set(inputs.map(input => input.code)).size !== existing.length) {
    throw new Error('Correction must preserve every existing operational field.');
  }
  return existing.map(field => {
    const input = inputs.find(item => item.code === field.code);
    if (!input) throw new Error('Correction cannot add or remove operational fields.');
    return { code: field.code, labelSnapshot: field.labelSnapshot, bags: input.bags };
  });
}
const registerReferenceLabels = ['दिनांक ____ चा शेवट नंबर', 'दिनांक ____ चा शेवट नंबर', 'दिनांक ____ (पाळी) चा उत्पादन'];
export function normalizeReferenceSnapshots(inputs: Array<{ code: string; label: string; referenceDate?: string; numberValue?: number }>) {
  if (inputs.length === 0) return [];
  if (inputs.length !== registerReferenceLabels.length || new Set(inputs.map(input => input.code)).size !== registerReferenceLabels.length) {
    throw new Error('Provide each of the three register references once.');
  }
  return registerReferenceLabels.map((label, index) => {
    const code = `REF${index + 1}`;
    const input = inputs.find(item => item.code === code);
    if (!input) throw new Error('Register reference codes do not match the charge book.');
    return { code, labelSnapshot: label, referenceDate: input.referenceDate, numberValue: input.numberValue };
  });
}
export type MonitoringGrade = { id: string; code: string; label: string };
export type MonitoringRecord = { productionDate: Date | string; stockLines: Array<{ gradeId: string; production: number; dispatch: number }> };
export function buildProductionMonitoring(startDate: string, endDate: string, trendRecords: MonitoringRecord[], seasonRecords: MonitoringRecord[], grades: MonitoringGrade[], openingCumulative: Record<string, number>) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new Error('Monitoring dates must be valid and ordered.');
  const dateKey = (value: Date | string) => value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
  const daily = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const rows = trendRecords.filter(record => dateKey(record.productionDate) === date);
    daily.push({ date, production: rows.reduce((sum, record) => sum + sumGradeProduction(record.stockLines), 0), dispatch: rows.reduce((sum, record) => sum + record.stockLines.reduce((total, line) => total + line.dispatch, 0), 0) });
  }
  const gradeRows = grades.map(grade => {
    const total = (records: MonitoringRecord[]) => records.flatMap(record => record.stockLines).filter(line => line.gradeId === grade.id).reduce((sum, line) => sum + line.production, 0);
    return { code: grade.code, label: grade.label, production: total(trendRecords), cumulative: addCumulative(Number(openingCumulative[grade.code] || 0), total(seasonRecords)) };
  });
  return { daily, grades: gradeRows, cumulativeTotal: gradeRows.reduce((sum, grade) => sum + grade.cumulative, 0) };
}
export function applyStockAdjustment(balance: number, delta: number) {
  if (!Number.isInteger(balance) || balance < 0 || !Number.isInteger(delta) || delta === 0) throw new Error('Enter a non-zero whole-number adjustment against a valid stock balance.');
  const next = balance + delta;
  if (next < 0) throw new Error('An adjustment cannot make the grade balance negative.');
  return next;
}
