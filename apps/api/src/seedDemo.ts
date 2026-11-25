import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role, RecordStatus, MovementType } from '../generated/client';

const prisma = new PrismaClient();
const demoPassword = process.env.DEMO_SEED_PASSWORD;

function assertLocalDemoDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required.');
  const url = new URL(raw);
  const databaseName = decodeURIComponent(url.pathname.slice(1).split('/').at(-1) || '');
  if (process.env.NODE_ENV === 'production' || databaseName !== 'krushinath_local_dev' || !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Demo seeding is restricted to the empty local krushinath_local_dev database.');
  }
  if (!demoPassword || demoPassword.length < 12) throw new Error('Set DEMO_SEED_PASSWORD (at least 12 characters) in apps/api/.env.');
}

async function main() {
  assertLocalDemoDatabase();
  const [userCount, recordCount, seasonCount, gradeCount, movementCount] = await Promise.all([
    prisma.user.count(), prisma.shiftRecord.count(), prisma.season.count(), prisma.grade.count(), prisma.inventoryMovement.count(),
  ]);
  if (userCount + recordCount + seasonCount + gradeCount + movementCount !== 0) {
    throw new Error('The local database is not empty. Demo seeding will not change existing factory or demo data.');
  }

  const passwordHash = await bcrypt.hash(demoPassword!, 12);
  const [owner, managerA, managerB, chemistA, chemistB, viewer] = await Promise.all([
    prisma.user.create({ data: { email: 'demo-owner@example.test', name: 'Demo Owner', role: Role.OWNER, passwordHash } }),
    prisma.user.create({ data: { email: 'demo.manager1@example.test', name: 'Demo Manager One', role: Role.MANAGER, passwordHash } }),
    prisma.user.create({ data: { email: 'demo.manager2@example.test', name: 'Demo Manager Two', role: Role.MANAGER, passwordHash } }),
    prisma.user.create({ data: { email: 'demo.chemist1@example.test', name: 'Demo Chemist One', role: Role.CHEMIST, passwordHash } }),
    prisma.user.create({ data: { email: 'demo.chemist2@example.test', name: 'Demo Chemist Two', role: Role.CHEMIST, passwordHash } }),
    prisma.user.create({ data: { email: 'demo.viewer@example.test', name: 'Demo Viewer', role: Role.VIEWER, passwordHash } }),
  ]);

  const gradeSpecs = [
    { code: 'L30', label: 'L 30', order: 0 }, { code: 'M30', label: 'M 30', order: 1 },
    { code: 'S1 30', label: 'S1 30', order: 2 }, { code: 'S2 30', label: 'S2 30', order: 3 },
  ];
  const grades = await Promise.all(gradeSpecs.map(spec => prisma.grade.create({ data: spec })));
  const shiftSpecs = [
    { label: '4-12', startsAt: '04:00', endsAt: '12:00', sortOrder: 0, chemistId: chemistA.id },
    { label: '12-8', startsAt: '12:00', endsAt: '20:00', sortOrder: 1, chemistId: chemistB.id },
    { label: '8-4', startsAt: '20:00', endsAt: '04:00', sortOrder: 2, chemistId: chemistA.id },
  ];
  const shifts = await Promise.all(shiftSpecs.map(spec => prisma.shiftDefinition.create({ data: spec })));
  const openingStock = { L30: 480, M30: 360, 'S1 30': 240, 'S2 30': 160 };
  const openingCumulative = { L30: 1250, M30: 980, 'S1 30': 760, 'S2 30': 410 };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const clock = Object.fromEntries(parts.map(part => [part.type, part.value]));
  let today = `${clock.year}-${clock.month}-${clock.day}`;
  if (Number(clock.hour) < 4) {
    const previousProductionDate = new Date(`${today}T00:00:00.000Z`);
    previousProductionDate.setUTCDate(previousProductionDate.getUTCDate() - 1);
    today = previousProductionDate.toISOString().slice(0, 10);
  }
  const seasonStart = new Date(`${today}T00:00:00.000Z`);
  seasonStart.setUTCDate(seasonStart.getUTCDate() - 29);
  const season = await prisma.season.create({ data: {
    name: 'Local Demo Season', startDate: seasonStart, active: true,
    openingStock, openingCumulative,
  } });
  const operationalLabels = ['हॉपरवर टाकलेली पोती', 'हॉपरवर टाकायची पोती', 'झाडलेली शिल्लक पोती', 'रोडी. मेल्ट पोती', 'रोडी शिल्लक पोती'];
  const settings = [
    ['companyName', 'Krushinath Green Energy'], ['factoryName', 'Krushinath Sugar House'],
    ['openingStock', openingStock], ['operationalLabels', operationalLabels], ['localDemo', true],
  ] as const;
  await Promise.all(settings.map(([key, value]) => prisma.factorySetting.create({ data: { key, value: value as any } })));
  await prisma.inventoryMovement.createMany({ data: grades.map(grade => ({
    gradeId: grade.id, seasonId: season.id, productionDate: seasonStart, type: MovementType.OPENING,
    quantity: openingStock[grade.code as keyof typeof openingStock]!, balanceAfter: openingStock[grade.code as keyof typeof openingStock]!,
    reason: 'Synthetic opening balance for local demo only', createdBy: owner.id,
  })) });

  const balances = grades.map(grade => openingStock[grade.code as keyof typeof openingStock]!);
  const firstDate = new Date(`${today}T00:00:00.000Z`);
  firstDate.setUTCDate(firstDate.getUTCDate() - 5);
  let bagNumber = 1000;
  const clerkUsers = [managerA, managerB];
  for (let day = 0; day < 6; day++) {
    const date = new Date(firstDate);
    date.setUTCDate(date.getUTCDate() + day);
    for (let shiftIndex = 0; shiftIndex < shifts.length; shiftIndex++) {
      const shift = shifts[shiftIndex]!;
      const clerk = clerkUsers[(day + shiftIndex) % clerkUsers.length]!;
      const chemist = shift.chemistId === chemistA.id ? chemistA : chemistB;
      const production = [92 + day * 3 + shiftIndex * 5, 74 + day * 2 + shiftIndex * 4, 46 + day + shiftIndex * 3, 31 + day + shiftIndex * 2];
      const dispatch = [22 + shiftIndex, 16 + shiftIndex, 11 + shiftIndex, 7 + shiftIndex];
      const available = balances.map((balance, i) => balance + production[i]!);
      const closing = available.map((quantity, i) => quantity - dispatch[i]!);
      const totalProduction = production.reduce((sum, quantity) => sum + quantity, 0);
      bagNumber += totalProduction;
      const record = await prisma.shiftRecord.create({ data: {
        productionDate: date, scaleCheckTime: `${String(shiftIndex * 8 + 3).padStart(2, '0')}:45`,
        clerkId: clerk.id, clerkNameSnapshot: clerk.name,
        assignedChemistId: chemist.id, assignedChemistNameSnapshot: chemist.name,
        shiftId: shift.id, shiftLabelSnapshot: shift.label, shiftStartsAtSnapshot: shift.startsAt,
        shiftEndsAtSnapshot: shift.endsAt, shiftSortOrderSnapshot: shift.sortOrder,
        seasonId: season.id, status: RecordStatus.LOCKED, approvedAt: date,
        remarks: 'Synthetic sample record for local demo; replace with verified factory entries.',
        stockLines: { create: grades.map((grade, i) => ({ gradeId: grade.id, opening: balances[i]!, production: production[i]!, available: available[i]!, dispatch: dispatch[i]!, closing: closing[i]! })) },
        timeEntries: { create: [{ entryTime: shift.startsAt, fromNumber: bagNumber - totalProduction + 1, toNumber: bagNumber, bags: totalProduction, order: 0 }] },
        operational: { create: operationalLabels.map((label, i) => ({ code: `OP${i + 1}`, labelSnapshot: label, bags: 10 + day + shiftIndex + i })) },
        references: { create: [
          { code: 'REF1', labelSnapshot: 'दिनांक ____ चा शेवट नंबर', referenceDate: date, numberValue: 100 + day * 10 + shiftIndex * 3 },
          { code: 'REF2', labelSnapshot: 'दिनांक ____ चा शेवट नंबर', referenceDate: date, numberValue: 101 + day * 10 + shiftIndex * 3 },
          { code: 'REF3', labelSnapshot: 'दिनांक ____ (पाळी) चा उत्पादन', referenceDate: date, numberValue: 102 + day * 10 + shiftIndex * 3 },
        ] },
        handovers: { create: [
          { kind: 'GIVEN', userId: clerk.id, employeeNameSnapshot: clerk.name, employeeRoleSnapshot: Role.MANAGER, acknowledgedAt: date },
          { kind: 'RECEIVED', userId: clerkUsers[(day + shiftIndex + 1) % clerkUsers.length]!.id, employeeNameSnapshot: clerkUsers[(day + shiftIndex + 1) % clerkUsers.length]!.name, employeeRoleSnapshot: Role.MANAGER, acknowledgedAt: date },
          { kind: 'CHEMIST', userId: chemist.id, employeeNameSnapshot: chemist.name, employeeRoleSnapshot: Role.CHEMIST, acknowledgedAt: date },
        ] },
      } });
      await prisma.auditLog.create({ data: { userId: owner.id, action: 'DEMO_RECORD_APPROVED', recordId: record.id, reason: 'Synthetic local demo data.', updatedValues: { status: RecordStatus.LOCKED } } });
      await prisma.inventoryMovement.createMany({ data: grades.flatMap((grade, i) => [
        { gradeId: grade.id, seasonId: season.id, recordId: record.id, productionDate: date, type: MovementType.PRODUCTION, quantity: production[i]!, balanceAfter: available[i]!, createdBy: owner.id },
        { gradeId: grade.id, seasonId: season.id, recordId: record.id, productionDate: date, type: MovementType.DISPATCH, quantity: -dispatch[i]!, balanceAfter: closing[i]!, createdBy: owner.id },
      ]) });
      balances.splice(0, balances.length, ...closing);
    }
  }
  await prisma.auditLog.create({ data: { userId: owner.id, action: 'LOCAL_DEMO_SEEDED', reason: 'Synthetic accounts, stock, and shift registers for local preview only.' } });
  console.log(`Seeded local demo data: ${userCount + 6} accounts, ${grades.length} grades, ${shifts.length} shifts, 18 approved demo records. Password is the value of DEMO_SEED_PASSWORD.`);
  void viewer;
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Local demo seeding failed.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
