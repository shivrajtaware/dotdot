export type StockReportLine = {
  grade: { code: string };
  opening: number;
  production: number;
  available: number;
  dispatch: number;
  closing: number;
};

export type RegisterReportRecord = {
  registerNo: number;
  productionDate: Date | string;
  shiftLabelSnapshot?: string;
  shiftSortOrderSnapshot?: number;
  clerkNameSnapshot?: string;
  shift: { label: string; sortOrder?: number };
  clerk: { id?: string; name: string };
  stockLines: StockReportLine[];
};

const productionDay = (date: Date | string) =>
  date instanceof Date ? date.toISOString().slice(0, 10) : date.slice(0, 10);

const total = (lines: StockReportLine[], field: 'production' | 'dispatch' | 'closing') =>
  lines.reduce((sum, line) => sum + line[field], 0);

export function buildOpeningClosingReportRows(records: RegisterReportRecord[]) {
  return [
    ['Register', 'Date', 'Shift', 'Grade', 'Opening', 'Production', 'Available', 'Dispatch', 'Closing'],
    ...records.flatMap(record => record.stockLines.map(line => [
      record.registerNo,
      productionDay(record.productionDate),
      record.shiftLabelSnapshot ?? record.shift.label,
      line.grade.code,
      line.opening,
      line.production,
      line.available,
      line.dispatch,
      line.closing,
    ])),
  ];
}

export function buildCumulativeProductionRows(
  records: Array<{ productionDate: Date | string; stockLines: Array<{ grade: { code: string }; production: number }> }>,
  openingCumulative: Record<string, number>,
  fromDate: string,
  toDate: string,
) {
  const byDate = new Map<string, Map<string, number>>();
  for (const record of records) {
    const date = productionDay(record.productionDate);
    if (date > toDate) continue;
    const grades = byDate.get(date) ?? new Map<string, number>();
    for (const line of record.stockLines) grades.set(line.grade.code, (grades.get(line.grade.code) ?? 0) + line.production);
    byDate.set(date, grades);
  }

  const cumulative = { ...openingCumulative };
  const rows: Array<Array<string | number>> = [['Date', 'Grade', 'Daily bags', 'To date bags']];
  for (const [date, grades] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [grade, quantity] of grades) {
      cumulative[grade] = (cumulative[grade] ?? 0) + quantity;
      if (date >= fromDate) rows.push([date, grade, quantity, cumulative[grade]]);
    }
  }
  return rows;
}

export function buildClerkSummaryRows(records: RegisterReportRecord[]) {
  const clerks = new Map<string, {
    name: string;
    records: number;
    production: number;
    dispatch: number;
    latestDate: string;
    latestShiftOrder: number;
    latestRegister: number;
    latestClosing: number;
  }>();

  for (const record of records) {
    const clerkName = record.clerkNameSnapshot ?? record.clerk.name;
    const key = record.clerk.id || clerkName;
    const date = productionDay(record.productionDate);
    const shiftOrder = record.shiftSortOrderSnapshot ?? record.shift.sortOrder ?? 0;
    const summary = clerks.get(key) ?? {
      name: clerkName,
      records: 0,
      production: 0,
      dispatch: 0,
      latestDate: '',
      latestShiftOrder: -1,
      latestRegister: 0,
      latestClosing: 0,
    };
    summary.records += 1;
    summary.production += total(record.stockLines, 'production');
    summary.dispatch += total(record.stockLines, 'dispatch');
    if (date > summary.latestDate || (date === summary.latestDate && shiftOrder > summary.latestShiftOrder)) {
      summary.latestDate = date;
      summary.latestShiftOrder = shiftOrder;
      summary.latestRegister = record.registerNo;
      summary.latestClosing = total(record.stockLines, 'closing');
    }
    clerks.set(key, summary);
  }

  return [
    ['Clerk', 'Approved records', 'Production bags', 'Godown bags dispatched', 'Latest date', 'Latest register', 'Latest closing bags'],
    ...[...clerks.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(clerk => [clerk.name, clerk.records, clerk.production, clerk.dispatch, clerk.latestDate, clerk.latestRegister, clerk.latestClosing]),
  ];
}
