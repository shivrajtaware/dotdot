import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '../generated/client';
import { validateOwnerCredentials } from '../src/security';
import { readInitialBalances, validateSeasonStartDate, validateSeedSeasonChoice } from '../src/seedConfig';
const prisma = new PrismaClient();
async function main() {
  const { email, password } = validateOwnerCredentials(process.env.OWNER_EMAIL, process.env.OWNER_PASSWORD);
  const grades = ['L30','M30','S1 30','S2 30'];
  const { openingStock: opening, openingCumulative } = readInitialBalances(process.env, grades);
  const seasonName = process.env.SEASON_NAME?.trim() || '2026–27';
  if (seasonName.length > 60) throw new Error('SEASON_NAME must be 60 characters or fewer.');
  const startDate = validateSeasonStartDate(process.env.SEASON_START_DATE);
  const shifts = [{label:'4-12',startsAt:'04:00',endsAt:'12:00'},{label:'12-8',startsAt:'12:00',endsAt:'20:00'},{label:'8-4',startsAt:'20:00',endsAt:'04:00'}];
  const existingOwner = await prisma.user.findUnique({ where: { email } });
  if (existingOwner && existingOwner.role !== Role.OWNER) throw new Error('OWNER_EMAIL already belongs to a non-owner account. Choose the intended owner account before seeding.');
  const [existingGrades, existingShifts, openingSetting, operationalSetting, existingSeason, activeSeason] = await Promise.all([
    prisma.grade.findMany({ where: { code: { in: grades } }, select: { code: true } }),
    prisma.shiftDefinition.findMany({ where: { label: { in: shifts.map(shift => shift.label) } }, select: { label: true } }),
    prisma.factorySetting.findUnique({ where: { key: 'openingStock' } }),
    prisma.factorySetting.findUnique({ where: { key: 'operationalLabels' } }),
    prisma.season.findUnique({ where: { name: seasonName } }),
    prisma.season.findFirst({ where: { active: true }, select: { name: true } }),
  ]);
  validateSeedSeasonChoice(activeSeason?.name, seasonName);
  const existingGradeCodes = new Set(existingGrades.map(grade => grade.code));
  for (const [order, code] of grades.entries()) {
    if (!existingGradeCodes.has(code)) await prisma.grade.create({ data: { code, label: code, order } });
  }
  const existingShiftLabels = new Set(existingShifts.map(shift => shift.label));
  for (const [sortOrder, shift] of shifts.entries()) {
    if (!existingShiftLabels.has(shift.label)) await prisma.shiftDefinition.create({ data: { ...shift, sortOrder } });
  }
  if (!openingSetting) await prisma.factorySetting.create({ data: { key: 'openingStock', value: opening } });
  const operational = ["हॉपरवर टाकलेली पोती","हॉपरवर टाकायची पोती","झाडलेली शिल्लक पोती","रोडी. मेल्ट पोती","रोडी शिल्लक पोती"];
  if (!operationalSetting) await prisma.factorySetting.create({ data: { key: 'operationalLabels', value: operational } });
  const season = existingSeason || await prisma.season.create({ data: { name: seasonName, startDate, active: true, openingStock: opening, openingCumulative } });
  const owner = existingOwner || await prisma.user.create({ data: { email, name: process.env.OWNER_NAME || 'System Owner', role: Role.OWNER, passwordHash: await bcrypt.hash(password, 12) } });
  for (const grade of await prisma.grade.findMany({ where: { code: { in: grades } } })) {
    const quantity = Number((season.openingStock as any)?.[grade.code] ?? opening[grade.code]);
    const exists = await prisma.inventoryMovement.findFirst({ where: { gradeId: grade.id, seasonId: season.id, type: 'OPENING' } });
    if (!exists) await prisma.inventoryMovement.create({ data: { gradeId: grade.id, seasonId: season.id, productionDate: season.startDate, type: 'OPENING', quantity, balanceAfter: quantity, reason: `Season opening balance: ${season.name}`, createdBy: owner.id } });
  }
  console.log('Base grades, shifts, season, and factory settings are ready.');
}
main().finally(() => prisma.$disconnect());
