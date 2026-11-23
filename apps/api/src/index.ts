import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaClient, Role, RecordStatus } from '../generated/client';
import { z } from 'zod';
import { calcStock, applyStockAdjustment, buildProductionMonitoring, normalizeOperationalSnapshots, normalizeReferenceSnapshots, preserveOperationalSnapshots, productionDateWithinSeason, resolveOptionalProductionDateRange, resolveProductionDate, resolveProductionDateRange, timeEntriesMatchProduction } from './calculations';
import { canAcknowledgeAssignedShiftChemist, canViewShiftRecordAsChemist, isActiveShiftChemist } from './permissions';
import { buildXlsx } from './excel';
import { buildClerkSummaryRows, buildCumulativeProductionRows, buildOpeningClosingReportRows } from './reports';
import { validateJwtSecrets } from './security';
import { databaseReadiness } from './readiness';

const { access: tokenKey, refresh: refreshKey } = validateJwtSecrets(process.env.JWT_SECRET, process.env.JWT_REFRESH_SECRET);
const prisma = new PrismaClient();
const app = express();
const dayStart = (date: string) => new Date(`${date}T00:00:00.000Z`);
const dayEnd = (date: string) => new Date(`${date}T23:59:59.999Z`);
app.use(helmet());
const allowedOrigins = [...(process.env.WEB_ORIGIN || 'http://localhost:5173').split(','), ...(process.env.MOBILE_ORIGIN || 'https://localhost').split(',')].map(x => x.trim()).filter(Boolean);
const corsForAllowedClients = cors({ origin: (origin, callback) => !origin || allowedOrigins.includes(origin) ? callback(null, true) : callback(new Error('Origin is not allowed.')), credentials: true });
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      // The web app and API share one public origin behind Nginx. Keep
      // same-origin requests CORS-simple so temporary tunnel hostnames work.
      if (new URL(origin).host === req.get('host')) return next();
    } catch { /* Reject malformed origins through the configured CORS policy. */ }
  }
  corsForAllowedClients(req, res, next);
});
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));

type AuthedRequest = Request & { user?: { id: string; role: Role; name: string } };
function sign(user: { id: string; role: Role; name: string }) {
  return jwt.sign(user, tokenKey, { expiresIn: '15m' });
}
function refreshHash(token: string) { return createHmac('sha256',refreshKey).update(token).digest('hex'); }
function cookieValue(req: Request, name: string) { const entry=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`)); return entry?.slice(name.length+1); }
function setRefreshCookie(res: Response, token: string) { res.cookie('refresh_token',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:process.env.NODE_ENV==='production'?'none':'strict',path:'/api/auth',maxAge:30*24*60*60*1000}); }
async function auth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !tokenKey) { res.status(401).json({ error: 'Please sign in.' }); return; }
  let userId: string;
  try {
    const payload = jwt.verify(token, tokenKey);
    if (typeof payload === 'string' || typeof payload.id !== 'string') { res.status(401).json({ error: 'Your session expired. Please sign in again.' }); return; }
    userId = payload.id;
  } catch { res.status(401).json({ error: 'Your session expired. Please sign in again.' }); return; }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, name: true, active: true } });
    if (!user || !user.active) { res.status(401).json({ error: 'This account is no longer active. Please contact the administrator.' }); return; }
    req.user = { id: user.id, role: user.role, name: user.name };
    next();
  } catch (error) { next(error); }
}
function allow(...roles: Role[]) { return (req: AuthedRequest, res: Response, next: NextFunction) => req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission for this action.' }); }
const writer = [Role.OWNER, Role.MANAGER];
const inventoryInput = z.object({ opening: z.number().int().nonnegative(), production: z.number().int().nonnegative(), dispatch: z.number().int().nonnegative() });
async function applyAdjustmentMovements(base:Record<string,number>,season:any,previous:any,date:Date){const movements=await prisma.inventoryMovement.findMany({where:{type:'ADJUSTMENT',seasonId:season.id,productionDate:{gte:previous?.productionDate||season.startDate,lte:date},...(previous?.approvedAt?{createdAt:{gte:previous.approvedAt}}:{})},orderBy:{createdAt:'asc'}});for(const movement of movements)base[movement.gradeId]=(base[movement.gradeId]||0)+movement.quantity;return base}
async function currentStockMap(season:any,date:Date,clerkId?:string){if(!season)return {latest:null as any,balances:{} as Record<string,number>};const latest=await prisma.shiftRecord.findFirst({where:{seasonId:season.id,productionDate:{gte:season.startDate,lte:date},status:{in:[RecordStatus.APPROVED,RecordStatus.LOCKED]},...(clerkId?{clerkId}:{})},orderBy:[{productionDate:'desc'},{shift:{sortOrder:'desc'}}],include:{shift:true,stockLines:true}});const setting=await prisma.factorySetting.findUnique({where:{key:'openingStock'}});const grades=await prisma.grade.findMany({where:{active:true}});const balances:Record<string,number>=Object.fromEntries(grades.map(g=>[g.id,latest?.stockLines.find((x:any)=>x.gradeId===g.id)?.closing??Number(((season.openingStock as any)?.[g.code]??(setting?.value as any)?.[g.code])||0)]));await applyAdjustmentMovements(balances,season,latest,date);return {latest,balances}}
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const recordInput = z.object({ productionDate: z.string().date(), offlineId: z.string().min(1).max(100).optional(), shiftId: z.string().min(1), seasonId: z.string().min(1), scaleCheckTime: clockTime.optional(), remarks: z.string().max(2000).optional(), stock: z.array(z.object({ gradeId: z.string(), ...inventoryInput.shape })).min(1), timeEntries: z.array(z.object({ entryTime: clockTime, fromNumber: z.number().int().nonnegative(), toNumber: z.number().int().nonnegative(), bags: z.number().int().nonnegative() })).default([]), operational: z.array(z.object({ code: z.string(), label: z.string(), bags: z.number().int().nonnegative() })).default([]), references: z.array(z.object({ code: z.string(), label: z.string(), referenceDate: z.string().date().optional(), numberValue: z.number().int().nonnegative().optional() })).default([]) });
async function operationalSnapshots(inputs: Array<{ code: string; label: string; bags: number }>) {
  const setting = await prisma.factorySetting.findUnique({ where: { key: 'operationalLabels' } });
  return normalizeOperationalSnapshots(setting?.value, inputs);
}
async function replaceSeasonOpeningMovements(tx: any, season: any, openingStock: Record<string, number>, createdBy: string) {
  await tx.inventoryMovement.deleteMany({ where: { seasonId: season.id, type: 'OPENING' } });
  const grades = await tx.grade.findMany({ where: { active: true } });
  await tx.inventoryMovement.createMany({ data: grades.map((grade: any) => {
    const quantity = Number(openingStock[grade.code] ?? 0);
    return { gradeId: grade.id, seasonId: season.id, productionDate: season.startDate, type: 'OPENING', quantity, balanceAfter: quantity, reason: `Season opening balance: ${season.name}`, createdBy };
  }) });
}

app.get('/api/health', async (_req, res) => {
  const readiness = await databaseReadiness(() => prisma.$queryRaw`SELECT 1`);
  res.status(readiness.status === 'ok' ? 200 : 503).json({ ...readiness, service: 'krushinath-api' });
});
app.post('/api/auth/login', async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !user.active || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const refreshToken=randomBytes(48).toString('base64url'); await prisma.refreshSession.create({data:{userId:user.id,tokenHash:refreshHash(refreshToken),expiresAt:new Date(Date.now()+30*24*60*60*1000)}});setRefreshCookie(res,refreshToken);
  res.json({ token: sign({ id: user.id, role: user.role, name: user.name }), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});
app.post('/api/auth/refresh',async(req,res)=>{const raw=cookieValue(req,'refresh_token');if(!raw)return res.status(401).json({error:'Please sign in again.'});const hash=refreshHash(raw);const session=await prisma.refreshSession.findUnique({where:{tokenHash:hash},include:{user:true}});if(!session||session.revokedAt||session.expiresAt<new Date()||!session.user.active)return res.status(401).json({error:'Please sign in again.'});const next=randomBytes(48).toString('base64url');const changed=await prisma.refreshSession.updateMany({where:{id:session.id,tokenHash:hash,revokedAt:null,expiresAt:{gt:new Date()}},data:{tokenHash:refreshHash(next),expiresAt:new Date(Date.now()+30*24*60*60*1000)}});if(changed.count!==1)return res.status(401).json({error:'Please sign in again.'});setRefreshCookie(res,next);res.json({token:sign({id:session.user.id,role:session.user.role,name:session.user.name})});});
app.post('/api/auth/logout',async(req,res)=>{const raw=cookieValue(req,'refresh_token');if(raw)await prisma.refreshSession.updateMany({where:{tokenHash:refreshHash(raw),revokedAt:null},data:{revokedAt:new Date()}});res.clearCookie('refresh_token',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/auth'});res.json({ok:true});});
app.get('/api/auth/me', auth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, name: true, email: true, role: true } }); res.json({ user });
});
app.get('/api/bootstrap', auth, async (_req, res) => {
  const [grades, shifts, seasons, employees, chemists, settings] = await Promise.all([
    prisma.grade.findMany({ where: { active: true }, orderBy: { order: 'asc' } }), prisma.shiftDefinition.findMany({ where: { active: true }, include: { chemist: { select: { id: true, name: true } } }, orderBy: { sortOrder: 'asc' } }),
    prisma.season.findMany({ where: { active: true } }), prisma.user.findMany({ where: { active: true, role: Role.MANAGER }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { active: true, role: Role.CHEMIST }, select: { id: true, name: true } }), prisma.factorySetting.findMany()
  ]);
  res.json({ grades, shifts, seasons, employees, chemists, settings: Object.fromEntries(settings.map(s => [s.key, s.value])) });
});

app.get('/api/dashboard', auth, async (req: AuthedRequest, res) => {
  const date = resolveProductionDate(req.query.date);
  if (!date) return res.status(400).json({ error: 'Production date must be a valid YYYY-MM-DD date.' });
  const managerScope = req.user!.role === Role.MANAGER ? { clerkId: req.user!.id } : {};
  const records = await prisma.shiftRecord.findMany({ where: { productionDate: dayStart(date), status: { in: [RecordStatus.APPROVED, RecordStatus.LOCKED] }, ...managerScope }, include: { shift: true, clerk: { select: { name: true } }, stockLines: { include: { grade: true } } }, orderBy: { shift: { sortOrder: 'asc' } } });
  const shiftStatusWhere = req.user!.role === Role.OWNER ? {} : req.user!.role === Role.MANAGER ? { OR: [{ clerkId: req.user!.id }, { status: RecordStatus.SUBMITTED }] } : req.user!.role === Role.CHEMIST ? { OR: [{ status: { in: [RecordStatus.APPROVED, RecordStatus.LOCKED] } }, { status: RecordStatus.SUBMITTED, assignedChemistId: req.user!.id }] } : { status: { in: [RecordStatus.SUBMITTED, RecordStatus.APPROVED, RecordStatus.LOCKED] } };
  const shiftStatuses = await prisma.shiftRecord.findMany({ where: { productionDate: dayStart(date), ...shiftStatusWhere }, include: { shift: true, clerk: { select: { name: true } } } });
  const allGrades = await prisma.grade.findMany({ where: { active: true }, orderBy: { order: 'asc' } });const activeSeason=await prisma.season.findFirst({where:{active:true}});const current=await currentStockMap(activeSeason,dayEnd(date));const openingAtStart=await currentStockMap(activeSeason,new Date(dayStart(date).getTime()-1));
  const trendStart = dayStart(date); trendStart.setUTCDate(trendStart.getUTCDate() - 13);
  const trendFrom = activeSeason && activeSeason.startDate > trendStart ? activeSeason.startDate : trendStart;
  const [trendRecords, seasonRecords, incompleteRecords] = activeSeason ? await Promise.all([
    prisma.shiftRecord.findMany({ where: { seasonId: activeSeason.id, productionDate: { gte: trendFrom, lte: dayEnd(date) }, status: { in: [RecordStatus.APPROVED, RecordStatus.LOCKED] }, ...managerScope }, include: { stockLines: true } }),
    prisma.shiftRecord.findMany({ where: { seasonId: activeSeason.id, productionDate: { gte: activeSeason.startDate, lte: dayEnd(date) }, status: { in: [RecordStatus.APPROVED, RecordStatus.LOCKED] }, ...managerScope }, include: { stockLines: true } }),
    req.user!.role === Role.OWNER || req.user!.role === Role.MANAGER ? prisma.shiftRecord.count({ where: { seasonId: activeSeason.id, productionDate: dayStart(date), status: RecordStatus.DRAFT, ...managerScope } }) : Promise.resolve(0)
  ]) : [[], [], 0];
  const monitoring = buildProductionMonitoring(trendStart.toISOString().slice(0, 10), date, trendRecords, seasonRecords, allGrades, (activeSeason?.openingCumulative || {}) as Record<string, number>);
  const byGrade = allGrades.map(g => { const lines = records.flatMap(r => r.stockLines).filter(l => l.gradeId === g.id); return { code: g.code, label: g.label, opening: lines[0]?.opening ?? openingAtStart.balances[g.id] ?? 0, production: lines.reduce((a, l) => a + l.production, 0), dispatch: lines.reduce((a, l) => a + l.dispatch, 0), closing: current.balances[g.id] ?? 0 }; });
  const latest = await prisma.auditLog.findMany({ where: req.user!.role === Role.MANAGER ? { userId: req.user!.id } : {}, take: 8, orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true } } } });
  res.json({ date, shifts: records.map(r => ({ id: r.id, registerNo: r.registerNo, shift: r.shiftLabelSnapshot, clerk: r.clerkNameSnapshot, status: r.status, production: r.stockLines.reduce((a, l) => a + l.production, 0), dispatch: r.stockLines.reduce((a, l) => a + l.dispatch, 0), closing: r.stockLines.reduce((a, l) => a + l.closing, 0) })), shiftStatuses: shiftStatuses.map(r => ({ id: r.id, shiftId: r.shiftId, registerNo: r.registerNo, shift: r.shiftLabelSnapshot, clerk: r.clerkNameSnapshot, status: r.status })), grades: byGrade, totals: byGrade.reduce((t, g) => ({ production: t.production + g.production, dispatch: t.dispatch + g.dispatch, closing: t.closing + g.closing }), { production: 0, dispatch: 0, closing: 0 }), pending: await prisma.shiftRecord.count({ where: { status: RecordStatus.SUBMITTED, ...(req.user!.role === Role.MANAGER ? { clerkId: req.user!.id } : {}) } }), incomplete: incompleteRecords, monitoring: { season: activeSeason?.name ?? null, ...monitoring }, recentActivity: latest, role: req.user!.role });
});
app.get('/api/inventory/ledger',auth,async(req:AuthedRequest,res)=>{const where:any={status:{in:[RecordStatus.APPROVED,RecordStatus.LOCKED]},...(req.user!.role===Role.MANAGER?{clerkId:req.user!.id}:{})};const [records,adjustments]=await Promise.all([prisma.shiftRecord.findMany({where,include:{shift:true,stockLines:{include:{grade:true}}},orderBy:[{productionDate:'desc'},{shift:{sortOrder:'asc'}}]}),prisma.inventoryMovement.findMany({include:{grade:true,season:{select:{name:true}}},orderBy:{createdAt:'desc'}})]);const ids=[...new Set(adjustments.map(x=>x.createdBy))];const users=await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,name:true}});const names=new Map(users.map(x=>[x.id,x.name]));const related=await prisma.shiftRecord.findMany({where:{id:{in:adjustments.map(x=>x.recordId).filter((id):id is string=>!!id)}},select:{id:true,registerNo:true,shiftLabelSnapshot:true}});const registerNumbers=new Map(related.map(x=>[x.id,x.registerNo]));const shiftLabels=new Map(related.map(x=>[x.id,x.shiftLabelSnapshot]));const season=await prisma.season.findFirst({where:{active:true}});const current=await currentStockMap(season,new Date());const grades=await prisma.grade.findMany({where:{active:true},orderBy:{order:'asc'}});res.json({records,movements:adjustments.map(x=>({...x,creatorName:names.get(x.createdBy)||'Unknown employee',registerNo:x.recordId?registerNumbers.get(x.recordId)??null:null,shiftLabel:x.recordId?shiftLabels.get(x.recordId)??null:null})),balances:grades.map(g=>({gradeId:g.id,code:g.code,label:g.label,quantity:current.balances[g.id]??0}))})});
app.post('/api/inventory/adjustments', auth, allow(Role.OWNER), async (req: AuthedRequest, res) => {
  const parsed = z.object({
    gradeId: z.string().min(1),
    productionDate: z.string().date(),
    delta: z.number().int().refine(value => value !== 0),
    reason: z.string().trim().min(5).max(1000),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Provide a grade, production date, non-zero adjustment quantity, and reason.' });

  try {
    const result = await prisma.$transaction(async tx => {
      const season = await tx.season.findFirst({ where: { active: true } });
      if (!season) return { status: 404, error: 'Active production season was not found.' } as const;
      const grade = await tx.grade.findUnique({ where: { id: parsed.data.gradeId } });
      if (!grade || !grade.active) return { status: 404, error: 'Active grade was not found.' } as const;
      const date = dayStart(parsed.data.productionDate);
      if (!productionDateWithinSeason(date, season)) return { status: 400, error: 'Adjustments must be dated within the active production season.' } as const;

      const latest = await tx.shiftRecord.findFirst({
        where: { seasonId: season.id, status: { in: [RecordStatus.APPROVED, RecordStatus.LOCKED] } },
        orderBy: [{ productionDate: 'desc' }, { shiftSortOrderSnapshot: 'desc' }],
        include: { stockLines: true },
      });
      if (!latest || latest.productionDate.getTime() !== date.getTime()) return { status: 409, error: 'Adjustments can only be posted after all approved shifts for the latest production date.' } as const;
      const activeShifts = await tx.shiftDefinition.findMany({ where: { active: true }, select: { id: true } });
      const dayRecords = await tx.shiftRecord.findMany({ where: { seasonId: season.id, productionDate: date }, select: { shiftId: true, status: true } });
      if (activeShifts.some(shift => !dayRecords.some(record => record.shiftId === shift.id && (record.status === RecordStatus.APPROVED || record.status === RecordStatus.LOCKED))) || dayRecords.some(record => record.status === RecordStatus.DRAFT || record.status === RecordStatus.SUBMITTED)) {
        return { status: 409, error: 'Complete and approve every shift on this production date before adjusting stock.' } as const;
      }
      const line = latest.stockLines.find(item => item.gradeId === grade.id);
      if (!line) return { status: 409, error: 'This grade has no stock line in the latest approved record.' } as const;
      const priorAdjustments = await tx.inventoryMovement.findMany({
        where: { type: 'ADJUSTMENT', seasonId: latest.seasonId, gradeId: grade.id, productionDate: date, createdAt: { gte: latest.approvedAt || latest.updatedAt } },
        orderBy: { createdAt: 'asc' },
      });
      const current = priorAdjustments.reduce((sum, movement) => sum + movement.quantity, line.closing);
      let balance: number;
      try { balance = applyStockAdjustment(current, parsed.data.delta); }
      catch (error) { return { status: 409, error: (error as Error).message } as const; }

      const movement = await tx.inventoryMovement.create({
        data: { gradeId: grade.id, seasonId: latest.seasonId, recordId: latest.id, productionDate: date, type: 'ADJUSTMENT', quantity: parsed.data.delta, balanceAfter: balance, reason: parsed.data.reason, createdBy: req.user!.id },
      });
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: 'INVENTORY_ADJUSTED', recordId: latest.id, previousValues: { gradeId: grade.id, balance: current }, updatedValues: { gradeId: grade.id, quantity: parsed.data.delta, balance, movementId: movement.id }, reason: parsed.data.reason },
      });
      return { movement, balance } as const;
    }, { isolationLevel: 'Serializable' });

    if ('error' in result) return res.status(result.status ?? 409).json({ error: result.error });
    res.status(201).json({ adjustment: result.movement, balance: result.balance });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Another inventory update was posted at the same time. Reload the balance and try again.' });
    throw error;
  }
});

app.get('/api/records', auth, async (req: AuthedRequest, res) => {
  const where: any = {};
  if (req.query.from !== undefined || req.query.to !== undefined) {
    const range = resolveOptionalProductionDateRange(req.query.from, req.query.to);
    if (!range) return res.status(400).json({ error: 'Record dates must be valid YYYY-MM-DD values with the start date no later than the end date.' });
    where.productionDate = { ...(range.from ? { gte: dayStart(range.from) } : {}), ...(range.to ? { lte: dayEnd(range.to) } : {}) };
  }
  if (typeof req.query.shiftId === 'string') where.shiftId = req.query.shiftId;
  if (typeof req.query.gradeId === 'string') where.stockLines = { some: { gradeId: req.query.gradeId } };
  if (typeof req.query.clerkId === 'string' && req.user!.role !== Role.MANAGER) where.clerkId = req.query.clerkId;
  if (typeof req.query.status === 'string') { if (!Object.values(RecordStatus).includes(req.query.status as RecordStatus)) return res.status(400).json({ error: 'Choose a valid record status.' }); where.status = req.query.status; }
  if (req.user!.role === Role.MANAGER) where.OR = [{ clerkId: req.user!.id }, { status: RecordStatus.SUBMITTED }];
  if (req.user!.role === Role.CHEMIST) { const selected = where.status; delete where.status; where.AND = [...(where.AND || []), { OR: [{ status: { in: [RecordStatus.APPROVED, RecordStatus.LOCKED] } }, { status: RecordStatus.SUBMITTED, assignedChemistId: req.user!.id }] }, ...(selected ? [{ status: selected }] : [])]; }
  if (req.user!.role === Role.VIEWER) { const selected = where.status; delete where.status; where.AND = [...(where.AND || []), { status: { in: [RecordStatus.SUBMITTED, RecordStatus.APPROVED, RecordStatus.LOCKED] } }, ...(selected ? [{ status: selected }] : [])]; }
  const records = await prisma.shiftRecord.findMany({ where, include: { shift: true, clerk: { select: { name: true } }, stockLines: { include: { grade: true } } }, orderBy: [{ productionDate: 'desc' }, { shift: { sortOrder: 'asc' } }] });
  res.json({ records });
});
app.get('/api/records/:id', auth, async (req: AuthedRequest, res) => {
  const record = await prisma.shiftRecord.findUnique({ where: { id: String(req.params.id) }, include: { shift: true, assignedChemist: { select: { id: true, name: true } }, clerk: { select: { id: true, name: true } }, season: true, stockLines: { include: { grade: true } }, timeEntries: { orderBy: { order: 'asc' } }, operational: true, references: true, handovers: { include: { user: { select: { name: true, role: true } } } } } });
  if (!record) return res.status(404).json({ error: 'Record not found.' });
  if (req.user!.role === Role.MANAGER && record.clerkId !== req.user!.id && record.status !== RecordStatus.SUBMITTED) return res.status(403).json({ error: 'You do not have permission to view this record.' });
  if ((req.user!.role === Role.CHEMIST || req.user!.role === Role.VIEWER) && record.status === RecordStatus.DRAFT) return res.status(403).json({ error: 'Draft records are not available to this role.' });
  if (req.user!.role === Role.CHEMIST && !canViewShiftRecordAsChemist(req.user!.id, record.status, record.assignedChemistId)) return res.status(403).json({ error: 'This record is not assigned to you or approved for chemist viewing.' });
  res.json({ record });
});
app.get('/api/inventory/opening', auth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ date: z.string().date(), shiftId: z.string().min(1), seasonId: z.string().min(1) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Provide a production date, shift, and season.' });
  const [shift, season] = await Promise.all([prisma.shiftDefinition.findUnique({ where: { id: parsed.data.shiftId } }), prisma.season.findUnique({ where: { id: parsed.data.seasonId } })]);
  if (!shift || !season) return res.status(404).json({ error: 'Selected shift or production season was not found.' });
  const date = dayStart(parsed.data.date);
  if (!productionDateWithinSeason(date, season)) return res.status(400).json({ error: 'Choose a production date within the selected season.' });
  const pendingEarlier = await prisma.shiftRecord.findFirst({ where: { seasonId: season.id, productionDate: { gte: season.startDate, lte: date }, OR: [{ productionDate: { lt: date } }, { productionDate: date, shift: { sortOrder: { lt: shift.sortOrder } } }], status: { in: [RecordStatus.DRAFT, RecordStatus.SUBMITTED] } } });
  if (pendingEarlier) return res.status(409).json({ error: 'A previous shift is still awaiting approval. Complete it before using a carried-forward balance.' });
  const previous = await prisma.shiftRecord.findFirst({ where: { seasonId: season.id, productionDate: { gte: season.startDate, lte: date }, status: { in: [RecordStatus.APPROVED, RecordStatus.LOCKED] }, OR: [{ productionDate: { lt: date } }, { productionDate: date, shift: { sortOrder: { lt: shift.sortOrder } } }] }, orderBy: [{ productionDate: 'desc' }, { shift: { sortOrder: 'desc' } }], include: { stockLines: { include: { grade: true } } } });
  const settings = await prisma.factorySetting.findUnique({ where: { key: 'openingStock' } });
  const activeGrades=await prisma.grade.findMany({where:{active:true}});const opening:Record<string,number>=Object.fromEntries(activeGrades.map(grade=>[grade.id,previous?.stockLines.find(line=>line.gradeId===grade.id)?.closing??Number(((season.openingStock as any)?.[grade.code]??(settings?.value as any)?.[grade.code])||0)]));await applyAdjustmentMovements(opening,season,previous,date);
  res.json({ opening, fromRegister: previous?.registerNo ?? null });
});

async function writeRecord(req: AuthedRequest, res: Response, submit = false) {
  const parsed = recordInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please check the register fields.', details: parsed.error.flatten() });
  const d = parsed.data;
  if (d.offlineId) {
    const existing = await prisma.shiftRecord.findUnique({ where: { offlineId: d.offlineId } });
    if (existing) {
      if (existing.clerkId !== req.user!.id) return res.status(409).json({ error: 'This offline request ID is already linked to another employee record.' });
      return res.status(200).json({ record: existing });
    }
  }
  let operational;
  try { operational = await operationalSnapshots(d.operational); } catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  let references;
  try { references = normalizeReferenceSnapshots(d.references); } catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  const activeGrades=await prisma.grade.findMany({where:{active:true}});const grades=activeGrades.filter(g=>d.stock.some(x=>x.gradeId===g.id));
  if (grades.length !== d.stock.length || grades.length !== activeGrades.length) return res.status(400).json({ error: 'Select each active sugar grade once.' });
  try { for (const item of d.stock) calcStock(item); } catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  const productionTotal = d.stock.reduce((a, x) => a + x.production, 0); const entryTotal = d.timeEntries.reduce((a, x) => a + x.bags, 0);
  if (entryTotal !== 0 && entryTotal !== productionTotal) return res.status(400).json({ error: 'Time-wise production total must match shift production.' });
  const [currentShift, season] = await Promise.all([prisma.shiftDefinition.findFirst({ where: { id: d.shiftId, active: true } }), prisma.season.findUnique({ where: { id: d.seasonId } })]);
  if (!currentShift || !season) return res.status(400).json({ error: 'Selected shift or production season is no longer active.' });
  const recordDate = dayStart(d.productionDate);
  if (!season.active || !productionDateWithinSeason(recordDate, season)) return res.status(400).json({ error: 'New shift records must use the active season and a date within its configured range.' });
  const earlierFilter: any[] = [{ productionDate: { lt: recordDate } }, { productionDate: recordDate, shift: { sortOrder: { lt: currentShift.sortOrder } } }];
  const pendingEarlier = await prisma.shiftRecord.findFirst({ where: { seasonId: d.seasonId, productionDate: { gte: season.startDate, lte: recordDate }, OR: earlierFilter, status: { in: [RecordStatus.DRAFT, RecordStatus.SUBMITTED] } } });
  if (pendingEarlier) return res.status(409).json({ error: 'A previous shift is still awaiting approval. Complete it before submitting this register.' });
  const previous = await prisma.shiftRecord.findFirst({ where: { seasonId: d.seasonId, productionDate: { gte: season.startDate, lte: recordDate }, status: { in: [RecordStatus.APPROVED, RecordStatus.LOCKED] }, OR: earlierFilter }, orderBy: [{ productionDate: 'desc' }, { shift: { sortOrder: 'desc' } }], include: { stockLines: true } });
  const setting=await prisma.factorySetting.findUnique({where:{key:'openingStock'}});const openingMap:Record<string,number>=Object.fromEntries(d.stock.map(item=>{const grade=grades.find(g=>g.id===item.gradeId)!;return [item.gradeId,previous?.stockLines.find(x=>x.gradeId===item.gradeId)?.closing??Number(((season.openingStock as any)?.[grade.code]??(setting?.value as any)?.[grade.code])||0)]}));await applyAdjustmentMovements(openingMap,season,previous,recordDate);for(const item of d.stock)if(item.opening!==openingMap[item.gradeId])return res.status(409).json({error:'Opening balance differs from the latest approved balance and authorized adjustments. Reload carried-forward stock.'});
  let record;
  try { record = await prisma.$transaction(async tx => {
    const created = await tx.shiftRecord.create({ data: { productionDate: dayStart(d.productionDate), offlineId: d.offlineId, scaleCheckTime: d.scaleCheckTime, remarks: d.remarks, clerkId: req.user!.id, clerkNameSnapshot: req.user!.name, shiftId: d.shiftId, shiftLabelSnapshot: currentShift.label, shiftStartsAtSnapshot: currentShift.startsAt, shiftEndsAtSnapshot: currentShift.endsAt, shiftSortOrderSnapshot: currentShift.sortOrder, seasonId: d.seasonId, status: submit ? RecordStatus.SUBMITTED : RecordStatus.DRAFT,
      stockLines: { create: d.stock.map(s => ({ gradeId: s.gradeId, ...calcStock(s) })) },
      timeEntries: { create: d.timeEntries.map((x, i) => ({ ...x, order: i })) }, operational: { create: operational }, references: { create: references.map(r => ({ ...r, referenceDate: r.referenceDate ? dayStart(r.referenceDate) : undefined })) } } });
    await tx.auditLog.create({ data: { userId: req.user!.id, action: submit ? 'RECORD_SUBMITTED' : 'RECORD_CREATED', recordId: created.id, updatedValues: { registerNo: created.registerNo, productionDate: d.productionDate, stock: d.stock } } });
    return created;
  }); } catch (error) {
    if (d.offlineId && (error as { code?: string }).code === 'P2002') {
      const existing = await prisma.shiftRecord.findUnique({ where: { offlineId: d.offlineId } });
      if (existing?.clerkId === req.user!.id) return res.status(200).json({ record: existing });
      if (existing) return res.status(409).json({ error: 'This offline request ID is already linked to another employee record.' });
      return res.status(409).json({ error: 'A register already exists for this production date and shift.' });
    }
    throw error;
  }
  res.status(201).json({ record });
}
app.post('/api/records', auth, allow(...writer), (req: AuthedRequest, res) => writeRecord(req, res));
app.put('/api/records/:id',auth,allow(...writer),async(req:AuthedRequest,res)=>{
  const id=String(req.params.id);const current=await prisma.shiftRecord.findUnique({where:{id},include:{stockLines:true,timeEntries:true,operational:true,references:true}});
  if(!current||current.status!==RecordStatus.DRAFT||(req.user!.role===Role.MANAGER&&current.clerkId!==req.user!.id))return res.status(409).json({error:'Only your unlocked draft can be updated.'});
  const parsed=recordInput.extend({expectedVersion:z.number().int().positive()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Please check the register fields and provide the version of the draft you opened.',details:parsed.error.flatten()});const d=parsed.data;
  let operational;try{operational=await operationalSnapshots(d.operational)}catch(e){return res.status(400).json({error:(e as Error).message})}
  let references;try{references=normalizeReferenceSnapshots(d.references)}catch(e){return res.status(400).json({error:(e as Error).message})}
  if(current.version!==d.expectedVersion)return res.status(409).json({error:'This draft was changed on another device. Reload the server copy and compare before saving your changes.'});
  const [currentShift,season,grades]=await Promise.all([prisma.shiftDefinition.findUnique({where:{id:d.shiftId}}),prisma.season.findUnique({where:{id:d.seasonId}}),prisma.grade.findMany({where:{id:{in:d.stock.map(x=>x.gradeId)},active:true}})]);
  if(!currentShift||!season||grades.length!==d.stock.length)return res.status(400).json({error:'Selected season, shift, or grade list is no longer valid.'});
  if(d.seasonId!==current.seasonId)return res.status(409).json({error:'A draft cannot be moved to a different production season.'});
  try{for(const s of d.stock)calcStock(s)}catch(e){return res.status(400).json({error:(e as Error).message})}
  const production=d.stock.reduce((a,x)=>a+x.production,0);const entrySum=d.timeEntries.reduce((a,x)=>a+x.bags,0);if(entrySum!==0&&entrySum!==production)return res.status(400).json({error:'Time-wise production total must match shift production.'});
  const date=dayStart(d.productionDate);if(!productionDateWithinSeason(date,season))return res.status(409).json({error:'The draft date must remain within its production season.'});const prior:any[]=[{productionDate:{lt:date}},{productionDate:date,shift:{sortOrder:{lt:currentShift.sortOrder}}}];
  const pending=await prisma.shiftRecord.findFirst({where:{id:{not:id},seasonId:d.seasonId,productionDate:{gte:season.startDate,lte:date},OR:prior,status:{in:[RecordStatus.DRAFT,RecordStatus.SUBMITTED]}}});if(pending)return res.status(409).json({error:'A previous shift is still awaiting approval.'});
  const previous=await prisma.shiftRecord.findFirst({where:{id:{not:id},seasonId:d.seasonId,productionDate:{gte:season.startDate,lte:date},OR:prior,status:{in:[RecordStatus.APPROVED,RecordStatus.LOCKED]}},orderBy:[{productionDate:'desc'},{shift:{sortOrder:'desc'}}],include:{stockLines:true}});const setting=await prisma.factorySetting.findUnique({where:{key:'openingStock'}});const openingMap:Record<string,number>=Object.fromEntries(d.stock.map(item=>{const grade=grades.find(g=>g.id===item.gradeId)!;return [item.gradeId,previous?.stockLines.find(x=>x.gradeId===item.gradeId)?.closing??Number(((season.openingStock as any)?.[grade.code]??(setting?.value as any)?.[grade.code])||0)]}));await applyAdjustmentMovements(openingMap,season,previous,date);for(const item of d.stock)if(item.opening!==openingMap[item.gradeId])return res.status(409).json({error:'Opening balance differs from the latest approved balance and authorized adjustments.'});
  const updated=await prisma.$transaction(async tx=>{const claimed=await tx.shiftRecord.updateMany({where:{id,status:RecordStatus.DRAFT,version:d.expectedVersion},data:{version:{increment:1}}});if(claimed.count!==1)return null;const row=await tx.shiftRecord.update({where:{id},data:{productionDate:date,shiftId:d.shiftId,shiftLabelSnapshot:currentShift.label,shiftStartsAtSnapshot:currentShift.startsAt,shiftEndsAtSnapshot:currentShift.endsAt,shiftSortOrderSnapshot:currentShift.sortOrder,seasonId:d.seasonId,scaleCheckTime:d.scaleCheckTime,remarks:d.remarks,stockLines:{deleteMany:{},create:d.stock.map(s=>({gradeId:s.gradeId,...calcStock(s)}))},timeEntries:{deleteMany:{},create:d.timeEntries.map((x,i)=>({...x,order:i}))},operational:{deleteMany:{},create:operational},references:{deleteMany:{},create:references.map(r=>({...r,referenceDate:r.referenceDate?dayStart(r.referenceDate):undefined}))}}});await tx.auditLog.create({data:{userId:req.user!.id,action:'DRAFT_UPDATED',recordId:id,previousValues:{version:current.version,stock:current.stockLines,timeEntries:current.timeEntries},updatedValues:{version:row.version,productionDate:d.productionDate,stock:d.stock}}});return row});if(!updated)return res.status(409).json({error:'This draft changed while you were saving. Reload the server copy and compare before trying again.'});res.json({record:updated});
});
app.post('/api/records/:id/submit', auth, allow(...writer), async (req: AuthedRequest, res) => {
  const id = String(req.params.id); const record = await prisma.shiftRecord.findUnique({ where: { id }, include: { shift: { include: { chemist: true } }, season: true, stockLines: true, timeEntries: true } });
  if (!record || (req.user!.role === Role.MANAGER && record.clerkId !== req.user!.id)) return res.status(404).json({ error: 'Draft not found.' });
  if (record.status !== RecordStatus.DRAFT) return res.status(409).json({ error: 'Only draft records can be submitted.' });
  if (!productionDateWithinSeason(record.productionDate, record.season)) return res.status(409).json({ error: 'This register date is outside its production season. Ask the owner to correct the season setup.' });
  const productionTotal = record.stockLines.reduce((total, line) => total + line.production, 0);
  if (!timeEntriesMatchProduction(record.timeEntries, productionTotal)) return res.status(409).json({ error: 'Time-wise production total must match shift production before submission.' });
  const assignedChemist = record.shift.chemist;
  if (!record.shift.chemistId || !isActiveShiftChemist(assignedChemist)) return res.status(409).json({ error: 'Assign an active shift chemist in Administration before submitting this register.' });
  const updated = await prisma.$transaction(async tx => {
    const claimed = await tx.shiftRecord.updateMany({ where: { id: record.id, status: RecordStatus.DRAFT, version: record.version }, data: { status: RecordStatus.SUBMITTED, assignedChemistId: record.shift.chemistId, assignedChemistNameSnapshot: assignedChemist.name, version: { increment: 1 } } });
    if (claimed.count !== 1) return null;
    const x = await tx.shiftRecord.findUnique({ where: { id: record.id } });
    if (!x) return null;
    await tx.auditLog.create({ data: { userId: req.user!.id, action: 'RECORD_SUBMITTED', recordId: x.id, previousValues: { status: record.status, assignedChemistId: record.assignedChemistId }, updatedValues: { status: x.status, assignedChemistId: x.assignedChemistId, assignedChemistName: x.assignedChemistNameSnapshot } } });
    return x;
  });
  if (!updated) return res.status(409).json({ error: 'This draft changed while you were submitting. Reload it and review the server copy.' });
  res.json({ record: updated });
});
app.post('/api/records/:id/approve', auth, allow(Role.OWNER, Role.CHEMIST), async (req: AuthedRequest, res) => {
  const current = await prisma.shiftRecord.findUnique({ where: { id: String(req.params.id) } });
  if (!current || current.status !== RecordStatus.SUBMITTED) return res.status(409).json({ error: 'Only submitted records can be approved.' });
  if (req.user!.role === Role.CHEMIST && current.assignedChemistId !== req.user!.id) return res.status(403).json({ error: 'Only the chemist assigned to this register may approve it.' });
  const acknowledgements = await prisma.handover.findMany({ where: { recordId: current.id }, select: { kind: true, userId: true } });
  const requiredKinds = ['GIVEN', 'RECEIVED', 'CHEMIST'];
  if (!requiredKinds.every(kind => acknowledgements.some(ack => ack.kind === kind)) || acknowledgements.find(ack => ack.kind === 'CHEMIST')?.userId !== current.assignedChemistId) return res.status(409).json({ error: 'All three authenticated handover acknowledgements, including the assigned chemist confirmation, are required before approval.' });
  const updated = await prisma.$transaction(async tx => {
    const claimed = await tx.shiftRecord.updateMany({ where: { id: current.id, status: RecordStatus.SUBMITTED }, data: { status: RecordStatus.LOCKED, approvedAt: new Date() } });
    if (claimed.count !== 1) return null;
    const x = await tx.shiftRecord.findUnique({ where: { id: current.id } });
    if (!x) return null;
    await tx.auditLog.create({ data: { userId: req.user!.id, action: 'RECORD_APPROVED_AND_LOCKED', recordId: x.id, previousValues: { status: current.status }, updatedValues: { status: x.status } } });
    for (const line of await tx.stockLine.findMany({ where: { recordId: x.id } })) {
      await tx.inventoryMovement.createMany({ data: [{ gradeId: line.gradeId, seasonId: x.seasonId, recordId: x.id, productionDate: x.productionDate, type: 'PRODUCTION', quantity: line.production, balanceAfter: line.available, createdBy: req.user!.id }, ...(line.dispatch ? [{ gradeId: line.gradeId, seasonId: x.seasonId, recordId: x.id, productionDate: x.productionDate, type: 'DISPATCH' as const, quantity: -line.dispatch, balanceAfter: line.closing, createdBy: req.user!.id }] : [])] });
    }
    return x;
  });
  if (!updated) return res.status(409).json({ error: 'This register was approved by another request.' });
  res.json({ record: updated });
});
app.post('/api/records/:id/corrections',auth,allow(Role.OWNER,Role.MANAGER,Role.CHEMIST),async(req:AuthedRequest,res)=>{
  const parsed=z.object({reason:z.string().min(5).max(1000),changes:z.object({remarks:z.string().max(2000).optional(),stock:z.array(z.object({gradeId:z.string(),opening:z.number().int().nonnegative(),production:z.number().int().nonnegative(),dispatch:z.number().int().nonnegative()})).optional(),timeEntries:z.array(z.object({entryTime:z.string(),fromNumber:z.number().int().nonnegative(),toNumber:z.number().int().nonnegative(),bags:z.number().int().nonnegative()})).optional(),operational:z.array(z.object({code:z.string(),label:z.string(),bags:z.number().int().nonnegative()})).optional()}).refine(v=>Object.keys(v).length>0)}).safeParse(req.body);
   if(!parsed.success)return res.status(400).json({error:'Provide a correction reason and at least one corrected section.'});const record=await prisma.shiftRecord.findUnique({where:{id:String(req.params.id)}});if(!record||(record.status!==RecordStatus.APPROVED&&record.status!==RecordStatus.LOCKED)||(req.user!.role===Role.MANAGER&&record.clerkId!==req.user!.id))return res.status(404).json({error:'Approved record not found or correction is not allowed.'});
  const correction=await prisma.correctionRequest.create({data:{recordId:record.id,requestedBy:req.user!.id,reason:parsed.data.reason,proposedValues:parsed.data.changes as any}});await prisma.auditLog.create({data:{userId:req.user!.id,action:'CORRECTION_REQUESTED',recordId:record.id,updatedValues:parsed.data.changes as any,reason:parsed.data.reason}});res.status(201).json({correction});
});
app.get('/api/corrections',auth,allow(Role.OWNER),async(_req,res)=>{const pending=await prisma.correctionRequest.findMany({where:{approvedAt:null,rejectedAt:null},orderBy:{createdAt:'asc'}});const corrections=await Promise.all(pending.map(async c=>{const [record,requester]=await Promise.all([prisma.shiftRecord.findUnique({where:{id:c.recordId},include:{clerk:true,shift:true}}),prisma.user.findUnique({where:{id:c.requestedBy},select:{name:true,role:true}})]);return {...c,record,requester}}));res.json({corrections})});
app.post('/api/corrections/:id/approve',auth,allow(Role.OWNER),async(req:AuthedRequest,res)=>{
  const id=String(req.params.id);const correction=await prisma.correctionRequest.findUnique({where:{id}});if(!correction||correction.approvedAt||correction.rejectedAt)return res.status(404).json({error:'Pending correction request not found.'});const changes=correction.proposedValues as any;const correctionTarget=await prisma.shiftRecord.findUnique({where:{id:correction.recordId},include:{season:true,stockLines:{include:{grade:true}}}});if(!correctionTarget)return res.status(404).json({error:'Correction target register was not found.'});const preceding=await prisma.shiftRecord.findFirst({where:{seasonId:correctionTarget.seasonId,status:{in:[RecordStatus.APPROVED,RecordStatus.LOCKED]},OR:[{productionDate:{lt:correctionTarget.productionDate}},{productionDate:correctionTarget.productionDate,shiftSortOrderSnapshot:{lt:correctionTarget.shiftSortOrderSnapshot}}]},orderBy:[{productionDate:'desc'},{shiftSortOrderSnapshot:'desc'}],include:{stockLines:true}});const openingSetting=await prisma.factorySetting.findUnique({where:{key:'openingStock'}});const expectedOpening:Record<string,number>=Object.fromEntries(correctionTarget.stockLines.map(line=>{const code=line.grade.code;return [line.gradeId,preceding?.stockLines.find(x=>x.gradeId===line.gradeId)?.closing??Number((correctionTarget.season.openingStock as any)?.[code]??(openingSetting?.value as any)?.[code]??0)]}));await applyAdjustmentMovements(expectedOpening,correctionTarget.season,preceding,correctionTarget.productionDate);const correctedLines=changes.stock||correctionTarget.stockLines;for(const line of correctedLines)if(Number(line.opening)!==expectedOpening[line.gradeId])return res.status(409).json({error:'Correction opening balances must match the preceding approved closing stock and authorized adjustments. Record a reasoned stock adjustment for any real discrepancy.'});const laterAdjustment=await prisma.inventoryMovement.findFirst({where:{type:'ADJUSTMENT',seasonId:correctionTarget.seasonId,productionDate:{gte:correctionTarget.productionDate},createdAt:{gte:correctionTarget.approvedAt||correctionTarget.updatedAt}}});if(laterAdjustment)return res.status(409).json({error:'A later authorized stock adjustment depends on this register. Reconcile the adjustment before correcting this historical record.'});
   try{const result=await prisma.$transaction(async tx=>{const claimed=await tx.correctionRequest.updateMany({where:{id,approvedAt:null,rejectedAt:null},data:{approvedBy:req.user!.id,approvedAt:new Date()}});if(claimed.count!==1)return null;const target=await tx.shiftRecord.findUnique({where:{id:correction.recordId},include:{shift:true,stockLines:{include:{grade:true}},timeEntries:true,operational:true}});if(!target)return null;const later=await tx.shiftRecord.findMany({where:{seasonId:target.seasonId,status:{in:[RecordStatus.APPROVED,RecordStatus.LOCKED]},OR:[{productionDate:{gt:target.productionDate}},{productionDate:target.productionDate,shiftSortOrderSnapshot:{gte:target.shiftSortOrderSnapshot}}]},include:{shift:true,stockLines:{include:{grade:true}}},orderBy:[{productionDate:'asc'},{shiftSortOrderSnapshot:'asc'}]});const records=[target,...later.filter(r=>r.id!==target.id)];const proposed=new Map((changes.stock||target.stockLines.map((l:any)=>({gradeId:l.gradeId,opening:l.opening,production:l.production,dispatch:l.dispatch}))).map((x:any)=>[x.gradeId,x]));const targetGradeIds=new Set(target.stockLines.map((l:any)=>l.gradeId));if(proposed.size!==targetGradeIds.size||[...proposed.keys()].some((gradeId:any)=>!targetGradeIds.has(gradeId)))throw new Error('Correction must include one stock line for every active grade.');if(changes.timeEntries&&changes.timeEntries.reduce((s:number,x:any)=>s+x.bags,0)!==[...proposed.values()].reduce((s:number,x:any)=>s+Number(x.production),0))throw new Error('Corrected time entries must total the corrected production quantity.');const operationalCorrections=changes.operational?preserveOperationalSnapshots(target.operational,changes.operational):undefined;let openingByGrade=new Map<string,number>();for(let index=0;index<records.length;index++){const r:any=records[index];const priorLines=r.stockLines as any[];const before={stock:priorLines.map((l:any)=>({gradeId:l.gradeId,opening:l.opening,production:l.production,dispatch:l.dispatch,closing:l.closing})),status:r.status};for(const l of priorLines){const change=index===0?proposed.get(l.gradeId):null;const opening=index===0?Number((change as any)?.opening??l.opening):(openingByGrade.get(l.gradeId)??l.opening);const production=Number((change as any)?.production??l.production);const dispatch=Number((change as any)?.dispatch??l.dispatch);const values=calcStock({opening,production,dispatch});await tx.stockLine.update({where:{id:l.id},data:values});openingByGrade.set(l.gradeId,values.closing)}if(index===0){if(changes.timeEntries){await tx.productionEntry.deleteMany({where:{recordId:r.id}});await tx.productionEntry.createMany({data:changes.timeEntries.map((x:any,i:number)=>({...x,recordId:r.id,order:i}))})}if(operationalCorrections){await tx.operationalCount.deleteMany({where:{recordId:r.id}});await tx.operationalCount.createMany({data:operationalCorrections.map((x:any)=>({...x,recordId:r.id}))})}await tx.shiftRecord.update({where:{id:r.id},data:{remarks:changes.remarks??r.remarks,version:{increment:1}}})}await tx.auditLog.create({data:{userId:req.user!.id,action:index===0?'CORRECTION_APPLIED':'STOCK_CARRY_FORWARD_RECALCULATED',recordId:r.id,previousValues:before as any,updatedValues:{stock:await tx.stockLine.findMany({where:{recordId:r.id}})} as any,reason:correction.reason}})}const recordIds=records.map((r:any)=>r.id);await tx.inventoryMovement.deleteMany({where:{recordId:{in:recordIds},type:{in:['PRODUCTION','DISPATCH']}}});for(const r of records){for(const l of await tx.stockLine.findMany({where:{recordId:r.id}})){await tx.inventoryMovement.createMany({data:[{gradeId:l.gradeId,seasonId:r.seasonId,recordId:r.id,productionDate:r.productionDate,type:'PRODUCTION',quantity:l.production,balanceAfter:l.available,createdBy:req.user!.id},...(l.dispatch?[{gradeId:l.gradeId,seasonId:r.seasonId,recordId:r.id,productionDate:r.productionDate,type:'DISPATCH' as const,quantity:-l.dispatch,balanceAfter:l.closing,createdBy:req.user!.id}]:[])]})}}return {recordId:target.id,affectedRecords:records.length}});if(!result)return res.status(404).json({error:'Shift record not found.'});res.json(result)}catch(e){res.status(409).json({error:(e as Error).message||'Correction could not be applied.'})}
});
app.post('/api/corrections/:id/reject',auth,allow(Role.OWNER),async(req:AuthedRequest,res)=>{
  const parsed=z.object({reason:z.string().trim().min(5).max(1000)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Provide a reason for rejecting this correction request.'});
  const id=String(req.params.id);const rejectedAt=new Date();
  const result=await prisma.$transaction(async tx=>{const correction=await tx.correctionRequest.findUnique({where:{id}});if(!correction||correction.approvedAt||correction.rejectedAt)return null;const changed=await tx.correctionRequest.updateMany({where:{id,approvedAt:null,rejectedAt:null},data:{rejectedBy:req.user!.id,rejectedAt,resolutionReason:parsed.data.reason}});if(changed.count!==1)return null;await tx.auditLog.create({data:{userId:req.user!.id,action:'CORRECTION_REJECTED',recordId:correction.recordId,previousValues:{approvedAt:correction.approvedAt,rejectedAt:correction.rejectedAt},updatedValues:{rejectedBy:req.user!.id,rejectedAt,resolutionReason:parsed.data.reason},reason:parsed.data.reason}});return {id,rejectedAt}});
  if(!result)return res.status(409).json({error:'This correction request was already resolved.'});
  res.json(result);
});
app.post('/api/records/:id/handover', auth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ kind: z.enum(['GIVEN', 'RECEIVED', 'CHEMIST']), signatureData: z.string().max(500000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose an acknowledgement type.' });
  if (parsed.data.kind === 'CHEMIST' && req.user!.role !== Role.CHEMIST) return res.status(403).json({ error: 'A shift chemist account must confirm this responsibility.' });
  if (parsed.data.kind !== 'CHEMIST' && req.user!.role !== Role.MANAGER) return res.status(403).json({ error: 'Only a Sugar House clerk account may acknowledge charge handover.' });
  const record = await prisma.shiftRecord.findUnique({ where: { id: String(req.params.id) }, include: { shift: { include: { chemist: true } }, assignedChemist: true } });
  if (!record || record.status !== RecordStatus.SUBMITTED) return res.status(409).json({ error: 'Only the assigned participants can acknowledge a submitted record.' });
  const assignedChemist = record.assignedChemistId ? record.assignedChemist : record.shift.chemist;
  if (parsed.data.kind === 'CHEMIST' && !canAcknowledgeAssignedShiftChemist(req.user!, assignedChemist)) return res.status(403).json({ error: 'Only the active chemist assigned to this shift may confirm it.' });
  const existingAck = await prisma.handover.findUnique({ where: { recordId_kind: { recordId: record.id, kind: parsed.data.kind } } });
  if (existingAck) {
    if (existingAck.userId !== req.user!.id) return res.status(409).json({ error: 'This handover responsibility has already been acknowledged by another employee.' });
    return res.json({ acknowledgement: existingAck, complete: await prisma.handover.count({ where: { recordId: record.id } }) === 3 });
  }
  const otherAcks=await prisma.handover.findMany({where:{recordId:record.id}});if(otherAcks.some(other=>other.userId===req.user!.id))return res.status(409).json({error:'Each handover responsibility must be acknowledged by its own authenticated employee.'});
  let ack;
  try {
    ack = await prisma.handover.create({ data: { recordId: record.id, kind: parsed.data.kind, userId: req.user!.id, employeeNameSnapshot: req.user!.name, employeeRoleSnapshot: req.user!.role, signatureData: parsed.data.signatureData } });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const racedAck = await prisma.handover.findUnique({ where: { recordId_kind: { recordId: record.id, kind: parsed.data.kind } } });
    if (racedAck?.userId === req.user!.id) return res.json({ acknowledgement: racedAck, complete: await prisma.handover.count({ where: { recordId: record.id } }) === 3 });
    return res.status(409).json({ error: 'This handover responsibility has already been acknowledged by another employee.' });
  }
  const count = await prisma.handover.count({ where: { recordId: record.id } });
  
  await prisma.auditLog.create({ data: { userId: req.user!.id, action: 'HANDOVER_ACKNOWLEDGED', recordId: record.id, updatedValues: { kind: ack.kind } } });
  res.json({ acknowledgement: ack, complete: count >= 3 });
});
app.get('/api/summary/daily', auth, async (req: AuthedRequest, res) => {
  const date = resolveProductionDate(req.query.date);
  if (!date) return res.status(400).json({ error: 'Production date must be a valid YYYY-MM-DD date.' });
  const seasonId = typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined;
  const season = seasonId ? await prisma.season.findUnique({ where: { id: seasonId } }) : await prisma.season.findFirst({ where: { active: true } });
  if (!season) return res.status(404).json({ error: 'No production season is configured.' });
  const records = await prisma.shiftRecord.findMany({ where: { seasonId: season.id, productionDate: { gte: season.startDate, lte: dayEnd(date) }, status: { in: [RecordStatus.APPROVED, RecordStatus.LOCKED] } }, include: { shift: true, stockLines: { include: { grade: true } } }, orderBy: [{ productionDate: 'asc' }, { shift: { sortOrder: 'asc' } }] });
  const grades = await prisma.grade.findMany({ where: { active: true }, orderBy: { order: 'asc' } });
  const dailyRecords = records.filter(r => r.productionDate.toISOString().slice(0, 10) === date);
  const shiftDefinitions = await prisma.shiftDefinition.findMany({ orderBy: { sortOrder: 'asc' } });
  const shiftLabels = shiftDefinitions.map(shift => {
    const historical = dailyRecords.find(record => record.shiftId === shift.id);
    return { id: shift.id, label: historical?.shiftLabelSnapshot ?? shift.label, sortOrder: historical?.shiftSortOrderSnapshot ?? shift.sortOrder };
  });
  const rows = grades.map(grade => { const total = (rs: typeof records) => rs.flatMap(r => r.stockLines).filter(l => l.gradeId === grade.id).reduce((n, l) => n + l.production, 0); return { gradeId: grade.id, code: grade.code, shifts: awaitShifts(dailyRecords, grade.id), toDay: total(dailyRecords), toDate: Number((season.openingCumulative as any)?.[grade.code] || 0) + total(records) }; });
  res.json({ date, season: season.name, shiftLabels, rows });
});
function awaitShifts(records: Array<{ shiftLabelSnapshot: string; stockLines: Array<{ gradeId: string; production: number }> }>, gradeId: string) { const values: Record<string, number> = {}; for (const record of records) values[record.shiftLabelSnapshot] = record.stockLines.filter(line => line.gradeId === gradeId).reduce((sum, line) => sum + line.production, 0); return values; }
app.get('/api/audit', auth, allow(Role.OWNER), async (req, res) => { const recordId = typeof req.query.recordId === 'string' ? req.query.recordId : undefined; res.json({ entries: await prisma.auditLog.findMany({ where: { recordId }, include: { user: { select: { name: true, role: true } } }, orderBy: { createdAt: 'desc' }, take: 250 }) }); });
app.get('/api/admin/users', auth, allow(Role.OWNER), async (_req, res) => { res.json({ users: await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, active: true }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }) }); });
app.post('/api/admin/users', auth, allow(Role.OWNER), async (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().min(2).max(100), email: z.string().email(), password: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72), role: z.nativeEnum(Role) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Provide a name, valid email, role, and a password of 12 to 72 UTF-8 bytes.' });
  try { const { password, ...userData } = parsed.data; const user = await prisma.user.create({ data: { ...userData, email: userData.email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12) }, select: { id: true, name: true, email: true, role: true, active: true } }); await prisma.auditLog.create({ data: { userId: req.user!.id, action: 'USER_CREATED', updatedValues: user } }); res.status(201).json({ user }); } catch { res.status(409).json({ error: 'An account with this email already exists.' }); }
});
app.post('/api/admin/users/:id/password', auth, allow(Role.OWNER), async (req: AuthedRequest, res) => {
  const parsed = z.object({ password: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Use a password between 12 and 72 UTF-8 bytes.' });
  const id = String(req.params.id); const target = await prisma.user.findUnique({ where: { id }, select: { id: true, active: true } });
  if (!target) return res.status(404).json({ error: 'Account not found.' });
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const revokedSessions = await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id }, data: { passwordHash } });
    const revoked = await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { userId: req.user!.id, action: 'USER_PASSWORD_RESET', updatedValues: { targetUserId: id, sessionsRevoked: revoked.count } } });
    return revoked.count;
  });
  res.json({ ok: true, revokedSessions });
});
app.patch('/api/admin/users/:id', auth, allow(Role.OWNER), async (req: AuthedRequest, res) => {
  const parsed = z.object({ active: z.boolean().optional(), role: z.nativeEnum(Role).optional(), name: z.string().min(2).max(100).optional() }).safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) return res.status(400).json({ error: 'Provide an account change.' });
  const id = String(req.params.id); const previous = await prisma.user.findUnique({ where: { id }, select: { name: true, role: true, active: true } }); if (!previous) return res.status(404).json({ error: 'Account not found.' });
  if (parsed.data.active === false || (previous.role === Role.CHEMIST && parsed.data.role && parsed.data.role !== Role.CHEMIST)) { const assignments = await prisma.shiftDefinition.findMany({ where: { chemistId: id }, select: { label: true } }); const pendingChemistry = await prisma.shiftRecord.count({ where: { assignedChemistId: id, status: RecordStatus.SUBMITTED, handovers: { none: { kind: 'CHEMIST' } } } }); if (assignments.length || pendingChemistry) return res.status(409).json({ error: 'Reassign this chemist from shifts and complete any pending shift verifications before deactivation or role change.', shifts: assignments.map(x => x.label), pendingVerifications: pendingChemistry }); }
  if (id === req.user!.id && parsed.data.active === false) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  if (id === req.user!.id && parsed.data.role && parsed.data.role !== Role.OWNER) return res.status(400).json({ error: 'You cannot remove your own owner access.' });
  const permissionsChanged = (!!parsed.data.role && parsed.data.role !== previous.role) || (parsed.data.active === false && previous.active);
  const { user, revokedSessions } = await prisma.$transaction(async tx => {
    const updated = await tx.user.update({ where: { id }, data: parsed.data, select: { id: true, name: true, email: true, role: true, active: true } });
    const revoked = permissionsChanged ? await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }) : { count: 0 };
    await tx.auditLog.create({ data: { userId: req.user!.id, action: 'USER_UPDATED', previousValues: previous, updatedValues: { ...updated, sessionsRevoked: revoked.count } } });
    return { user: updated, revokedSessions: revoked.count };
  });
  res.json({ user, revokedSessions });
});
app.get('/api/admin/register-sequence', auth, allow(Role.OWNER), async (_req, res) => {
  const [sequence] = await prisma.$queryRaw<Array<{ last_value: bigint; is_called: boolean }>>`SELECT last_value, is_called FROM "ShiftRecord_registerNo_seq"`;
  if (!sequence) throw new Error('Register number sequence is unavailable.');
  res.json({ nextNumber: Number(sequence.last_value) + (sequence.is_called ? 1 : 0) });
});
app.put('/api/admin/register-sequence', auth, allow(Role.OWNER), async (req: AuthedRequest, res) => {
  const parsed = z.object({ nextNumber: z.number().int().min(1).max(2147483647) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a positive register number.' });
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`LOCK TABLE "ShiftRecord" IN EXCLUSIVE MODE`;
      const maxRegisterNo = (await tx.shiftRecord.aggregate({ _max: { registerNo: true } }))._max.registerNo;
      if (maxRegisterNo !== null && parsed.data.nextNumber <= maxRegisterNo) throw new Error('NEXT_NUMBER_NOT_AVAILABLE');
      const [sequence] = await tx.$queryRaw<Array<{ last_value: bigint; is_called: boolean }>>`SELECT last_value, is_called FROM "ShiftRecord_registerNo_seq"`;
      if (!sequence) throw new Error('Register number sequence is unavailable.');
      const previousNextNumber = Number(sequence.last_value) + (sequence.is_called ? 1 : 0);
      await tx.$queryRaw`SELECT setval('"ShiftRecord_registerNo_seq"'::regclass, ${parsed.data.nextNumber}, false)`;
      await tx.auditLog.create({ data: { userId: req.user!.id, action: 'REGISTER_SEQUENCE_UPDATED', previousValues: { nextNumber: previousNextNumber }, updatedValues: { nextNumber: parsed.data.nextNumber } } });
      return { previousNextNumber, nextNumber: parsed.data.nextNumber };
    });
    res.json(result);
  } catch (error) {
    if ((error as Error).message === 'NEXT_NUMBER_NOT_AVAILABLE') return res.status(409).json({ error: 'The next register number must be greater than every number already in use.' });
    throw error;
  }
});
app.get('/api/admin/grades',auth,allow(Role.OWNER),async(_req,res)=>res.json({grades:await prisma.grade.findMany({orderBy:{order:'asc'}})}));
app.post('/api/admin/grades',auth,allow(Role.OWNER),async(req:AuthedRequest,res)=>{const parsed=z.object({code:z.string().trim().regex(/^[A-Z0-9][A-Z0-9 _-]{0,14}$/),label:z.string().trim().min(1).max(60),order:z.number().int().nonnegative()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Enter a unique grade code, a label, and display order.'});try{const grade=await prisma.$transaction(async tx=>{const created=await tx.grade.create({data:{...parsed.data,active:true}});const setting=await tx.factorySetting.findUnique({where:{key:'openingStock'}});const opening={...((setting?.value as any)||{}),[created.code]:0};await tx.factorySetting.upsert({where:{key:'openingStock'},create:{key:'openingStock',value:opening},update:{value:opening}});for(const season of await tx.season.findMany({where:{active:true}}))await tx.season.update({where:{id:season.id},data:{openingCumulative:{...((season.openingCumulative as any)||{}),[created.code]:0},openingStock:{...((season.openingStock as any)||{}),[created.code]:0}}});await tx.auditLog.create({data:{userId:req.user!.id,action:'GRADE_CREATED',updatedValues:{grade:created,openingStock:opening} as any}});return created});res.status(201).json({grade})}catch{res.status(409).json({error:'A grade with this code already exists.'})}});
app.patch('/api/admin/grades/:id',auth,allow(Role.OWNER),async(req:AuthedRequest,res)=>{
  const parsed=z.object({label:z.string().trim().min(1).max(60).optional(),order:z.number().int().nonnegative().optional(),active:z.boolean().optional()}).safeParse(req.body);
  if(!parsed.success||!Object.keys(parsed.data).length)return res.status(400).json({error:'Provide a label, display order, or active status.'});
  const current=await prisma.grade.findUnique({where:{id:String(req.params.id)}});if(!current)return res.status(404).json({error:'Grade not found.'});
  if(parsed.data.active===false&&current.active){const pending=await prisma.stockLine.count({where:{gradeId:current.id,record:{status:{in:[RecordStatus.DRAFT,RecordStatus.SUBMITTED]}}}});const last=await prisma.shiftRecord.findFirst({where:{status:{in:[RecordStatus.APPROVED,RecordStatus.LOCKED]}},orderBy:[{productionDate:'desc'},{shift:{sortOrder:'desc'}}],include:{stockLines:{where:{gradeId:current.id}}}});if(pending||((last?.stockLines[0]?.closing)||0)>0)return res.status(409).json({error:'Finish pending registers and bring this grade balance to zero before deactivating it.'})}
  const grade=await prisma.$transaction(async tx=>{const changed=await tx.grade.update({where:{id:current.id},data:parsed.data});if(parsed.data.active!==undefined&&parsed.data.active!==current.active){const setting=await tx.factorySetting.findUnique({where:{key:'openingStock'}});const opening={...((setting?.value as any)||{})};if(parsed.data.active)opening[current.code]=0;else delete opening[current.code];await tx.factorySetting.upsert({where:{key:'openingStock'},create:{key:'openingStock',value:opening},update:{value:opening}});if(parsed.data.active){for(const season of await tx.season.findMany({where:{active:true}}))await tx.season.update({where:{id:season.id},data:{openingStock:{...((season.openingStock as any)||{}),[current.code]:0}}})}}await tx.auditLog.create({data:{userId:req.user!.id,action:'GRADE_UPDATED',previousValues:current as any,updatedValues:changed as any}});return changed});res.json({grade})
});
app.get('/api/admin/seasons',auth,allow(Role.OWNER),async(_req,res)=>res.json({seasons:await prisma.season.findMany({orderBy:{startDate:'desc'}})}));
app.post('/api/admin/seasons',auth,allow(Role.OWNER),async(req:AuthedRequest,res)=>{const parsed=z.object({name:z.string().trim().min(1).max(60),startDate:z.string().date(),openingStock:z.record(z.string(),z.number().int().nonnegative()).optional(),openingCumulative:z.record(z.string(),z.number().int().nonnegative()).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Enter a season name and start date.'});const activeSeason=await prisma.season.findFirst({where:{active:true}});if(activeSeason&&dayStart(parsed.data.startDate)<=activeSeason.startDate)return res.status(409).json({error:'A new season must start after the active season start date.'});const latestRecord=await prisma.shiftRecord.findFirst({where:{status:{in:[RecordStatus.APPROVED,RecordStatus.LOCKED]}},orderBy:{productionDate:'desc'}});if(latestRecord&&dayStart(parsed.data.startDate)<=latestRecord.productionDate)return res.status(409).json({error:'The new season must begin after the latest approved production date.'});if(activeSeason&&await prisma.shiftRecord.count({where:{seasonId:activeSeason.id,status:{in:[RecordStatus.DRAFT,RecordStatus.SUBMITTED]}}}))return res.status(409).json({error:'Resolve all pending registers in the current season before closing it.'});const grades=await prisma.grade.findMany({where:{active:true}});const cumulative=parsed.data.openingCumulative||Object.fromEntries(grades.map(g=>[g.code,0]));const carried=await currentStockMap(activeSeason,dayEnd(parsed.data.startDate));const openingStock=parsed.data.openingStock||Object.fromEntries(grades.map(g=>[g.code,carried.balances[g.id]??0]));const codes=grades.map(g=>g.code).sort();if(JSON.stringify(Object.keys(cumulative).sort())!==JSON.stringify(codes)||JSON.stringify(Object.keys(openingStock).sort())!==JSON.stringify(codes))return res.status(400).json({error:'Provide opening stock and cumulative production for every active grade.'});try{const season=await prisma.$transaction(async tx=>{const current=await tx.season.findFirst({where:{active:true}});if(current){const closed=await tx.season.update({where:{id:current.id},data:{active:false,endDate:dayStart(parsed.data.startDate)}});await tx.auditLog.create({data:{userId:req.user!.id,action:'SEASON_CLOSED',previousValues:{active:current.active,endDate:current.endDate},updatedValues:{active:closed.active,endDate:closed.endDate}}})}const created=await tx.season.create({data:{name:parsed.data.name,startDate:dayStart(parsed.data.startDate),active:true,openingStock,openingCumulative:cumulative}});await replaceSeasonOpeningMovements(tx,created,openingStock,req.user!.id);await tx.auditLog.create({data:{userId:req.user!.id,action:'SEASON_CREATED',updatedValues:created as any}});return created});res.status(201).json({season})}catch{res.status(409).json({error:'A season with this name already exists.'})}});
app.put('/api/admin/settings/:key', auth, allow(Role.OWNER), async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  if (!['companyName','factoryName','operationalLabels','openingStock'].includes(key)) return res.status(400).json({ error: 'Setting key is not editable through this endpoint.' });
  const valueCheck = key === 'openingStock' ? z.record(z.string(), z.number().int().nonnegative()).safeParse(req.body.value) : key === 'operationalLabels' ? z.array(z.string().min(1).max(100)).length(5).safeParse(req.body.value) : z.string().max(150).safeParse(req.body.value);
  if (!valueCheck.success) return res.status(400).json({ error: 'Setting value does not match the expected format.' });
  if (key === 'openingStock') { const codes=(await prisma.grade.findMany({where:{active:true},select:{code:true}})).map(g=>g.code).sort();if(JSON.stringify(Object.keys(req.body.value).sort())!==JSON.stringify(codes))return res.status(400).json({error:'Provide an opening balance for every active grade.'}); }
  if (key === 'openingStock' && await prisma.shiftRecord.count()) return res.status(409).json({ error: 'Opening stock is locked after the first shift register is created.' });
  const previous=await prisma.factorySetting.findUnique({where:{key}});const setting=await prisma.$transaction(async tx=>{const value=await tx.factorySetting.upsert({where:{key},create:{key,value:req.body.value as any},update:{value:req.body.value as any}});if(key==='openingStock'){const active=await tx.season.findFirst({where:{active:true}});if(active){const updated=await tx.season.update({where:{id:active.id},data:{openingStock:req.body.value as any}});await replaceSeasonOpeningMovements(tx,updated,req.body.value as Record<string,number>,req.user!.id)}}return value});await prisma.auditLog.create({data:{userId:req.user!.id,action:'SETTING_UPDATED:'+key,previousValues:previous?.value as any,updatedValues:setting.value as any}});res.json({setting});
});
app.put('/api/admin/seasons/:id', auth, allow(Role.OWNER), async (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().min(1).max(60).optional(), startDate: z.string().date().optional(), openingStock: z.record(z.string(), z.number().int().nonnegative()).optional(), openingCumulative: z.record(z.string(), z.number().int().nonnegative()).optional(), active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) return res.status(400).json({ error: 'Provide valid season settings.' });
  const id = String(req.params.id); const season = await prisma.season.findUnique({ where: { id } }); if (!season) return res.status(404).json({ error: 'Season not found.' });
  if ((parsed.data.startDate || parsed.data.openingStock || parsed.data.openingCumulative) && await prisma.shiftRecord.count({ where: { seasonId: id } })) return res.status(409).json({ error: 'Season start and opening balances are locked after a shift register is created.' });
   if(parsed.data.openingCumulative){const codes=(await prisma.grade.findMany({where:{active:true},select:{code:true}})).map(g=>g.code).sort();if(!codes.every(code=>Object.prototype.hasOwnProperty.call(parsed.data.openingCumulative,code)))return res.status(400).json({error:'Provide an opening cumulative value for every active grade.'})}
   if(parsed.data.openingStock){const codes=(await prisma.grade.findMany({where:{active:true},select:{code:true}})).map(g=>g.code).sort();if(JSON.stringify(Object.keys(parsed.data.openingStock).sort())!==JSON.stringify(codes))return res.status(400).json({error:'Provide an opening stock value for every active grade.'})}
   if(parsed.data.active===false&&season.active&&await prisma.season.count({where:{active:true}})<=1)return res.status(409).json({error:'At least one production season must remain active.'});
  const updated = await prisma.$transaction(async tx => { if (parsed.data.active === true) await tx.season.updateMany({ where: { active: true, id: { not: id } }, data: { active: false, endDate: parsed.data.startDate ? dayStart(parsed.data.startDate) : new Date() } }); const result = await tx.season.update({ where: { id }, data: { ...parsed.data, startDate: parsed.data.startDate ? dayStart(parsed.data.startDate) : undefined, openingCumulative: parsed.data.openingCumulative as any } }); if (parsed.data.openingStock) await replaceSeasonOpeningMovements(tx, result, parsed.data.openingStock, req.user!.id); return result; });
  await prisma.auditLog.create({ data: { userId: req.user!.id, action: 'SEASON_UPDATED', previousValues: { name: season.name, startDate: season.startDate, openingStock: season.openingStock as any, openingCumulative: season.openingCumulative as any, active: season.active }, updatedValues: { name: updated.name, startDate: updated.startDate, openingStock: updated.openingStock as any, openingCumulative: updated.openingCumulative as any, active: updated.active } } }); res.json({ season: updated });
});
app.put('/api/admin/shifts/:id', auth, allow(Role.OWNER), async (req: AuthedRequest, res) => {
  const parsed = z.object({ label: z.string().min(1).max(20), startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), active: z.boolean().optional(), sortOrder: z.number().int().nonnegative().optional(), chemistId: z.string().min(1).nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the shift label, 24-hour times, and chemist assignment.' });
  if (parsed.data.chemistId) { const chemist = await prisma.user.findFirst({ where: { id: parsed.data.chemistId, active: true, role: Role.CHEMIST }, select: { id: true } }); if (!chemist) return res.status(400).json({ error: 'Choose an active user with the Shift Chemist role.' }); }
  try { const id = String(req.params.id); const previous = await prisma.shiftDefinition.findUnique({ where: { id } }); if (!previous) return res.status(404).json({ error: 'Shift not found.' }); const shift = await prisma.shiftDefinition.update({ where: { id }, data: parsed.data, include: { chemist: { select: { id: true, name: true } } } }); await prisma.auditLog.create({ data: { userId: req.user!.id, action: 'SHIFT_UPDATED', previousValues: previous, updatedValues: shift } }); res.json({ shift }); } catch { res.status(409).json({ error: 'Shift label already exists or shift is unavailable.' }); }
});
app.get('/api/reports/:type.:format(csv|xlsx)', auth, async (req: AuthedRequest, res) => {
  const range = resolveProductionDateRange(req.query.from, req.query.to);
  if (!range) return res.status(400).json({ error: 'Report dates must be valid YYYY-MM-DD values with the start date no later than the end date.' });
  const from = dayStart(range.from);
  const to = dayEnd(range.to);
  const type = String(req.params.type);
  const requestedSeasonId = typeof req.query.seasonId === 'string' ? req.query.seasonId : undefined;
  const selectedSeason = requestedSeasonId
    ? await prisma.season.findUnique({ where: { id: requestedSeasonId } })
    : await prisma.season.findFirst({ where: { active: true } });
  if (requestedSeasonId && !selectedSeason) return res.status(404).json({ error: 'Selected production season was not found.' });
  const records = await prisma.shiftRecord.findMany({ where: { productionDate: { gte: from, lte: to }, ...(selectedSeason ? { seasonId: selectedSeason.id } : {}), status: { in: [RecordStatus.APPROVED, RecordStatus.LOCKED] }, ...(req.user!.role === Role.MANAGER ? { clerkId: req.user!.id } : {}) }, include: { shift: true, clerk: true, stockLines: { include: { grade: true } }, operational: true, handovers: { include: { user: true } } }, orderBy: [{ productionDate: 'asc' }, { shift: { sortOrder: 'asc' } }] });
  const esc = (x: unknown) => `"${String(x ?? '').replaceAll('"', '""')}"`;
  const day=(r:any)=>r.productionDate.toISOString().slice(0,10); let rows:any[][]=[];let cumulativeSheetRows:any[][]=[['Date','Grade','Daily bags','To date bags']];let inventorySheetRows:any[][]=[['Date','Shift','Grade','Opening','Production','Available','Dispatch','Closing']];
  const stockRows=records.flatMap(r=>r.stockLines.map(l=>({r,l})));
  if(type==='daily'||type==='shift') rows=[['Register','Date','Shift','Clerk','Status','Production bags','Dispatched bags','Closing bags'],...records.map(r=>[r.registerNo,day(r),r.shiftLabelSnapshot,r.clerkNameSnapshot,r.status,r.stockLines.reduce((a,l)=>a+l.production,0),r.stockLines.reduce((a,l)=>a+l.dispatch,0),r.stockLines.reduce((a,l)=>a+l.closing,0)])];
  else if(type==='clerk') rows=buildClerkSummaryRows(records);
  else if(type==='grade') rows=[['Register','Date','Shift','Grade','Opening','Production','Available','Dispatch','Closing'],...stockRows.map(({r,l})=>[r.registerNo,day(r),r.shiftLabelSnapshot,l.grade.code,l.opening,l.production,l.available,l.dispatch,l.closing])];
  else if(type==='inventory') { const season=selectedSeason;const current=await currentStockMap(season,to);const d=current.latest?day(current.latest):season?.startDate.toISOString().slice(0,10)||'';const shift=current.latest?.shiftLabelSnapshot||'Season opening';const active=await prisma.grade.findMany({where:{active:true},orderBy:{order:'asc'}});rows=[['Date','Shift','Grade','Opening','Production','Available','Dispatch','Closing'],...active.map(g=>[d,shift,g.code,current.latest?.stockLines.find((l:any)=>l.gradeId===g.id)?.opening??current.balances[g.id]??0,current.latest?.stockLines.find((l:any)=>l.gradeId===g.id)?.production??0,current.balances[g.id]??0,current.latest?.stockLines.find((l:any)=>l.gradeId===g.id)?.dispatch??0,current.balances[g.id]??0])];inventorySheetRows=rows; }
   else if(type==='opening-closing') { rows=buildOpeningClosingReportRows(records);inventorySheetRows=rows; }
  else if(type==='dispatch') rows=[['Register','Date','Shift','Grade','Bags dispatched'],...stockRows.filter(x=>x.l.dispatch).map(({r,l})=>[r.registerNo,day(r),r.shiftLabelSnapshot,l.grade.code,l.dispatch])];
  else if(type==='hopper') rows=[['Register','Date','Shift','Clerk','Operational field','Bags'],...records.flatMap(r=>r.operational.map(o=>[r.registerNo,day(r),r.shiftLabelSnapshot,r.clerkNameSnapshot,o.labelSnapshot,o.bags]))];
  else if(type==='cumulative') { const season=selectedSeason;if(!season)return res.status(404).json({error:'No production season is configured.'});const history=await prisma.shiftRecord.findMany({where:{seasonId:season.id,productionDate:{gte:season.startDate,lte:to},status:{in:[RecordStatus.APPROVED,RecordStatus.LOCKED]},...(req.user!.role===Role.MANAGER?{clerkId:req.user!.id}:{})},include:{stockLines:{include:{grade:true}}},orderBy:[{productionDate:'asc'},{shift:{sortOrder:'asc'}}]});cumulativeSheetRows=buildCumulativeProductionRows(history,season.openingCumulative as Record<string,number>,from.toISOString().slice(0,10),to.toISOString().slice(0,10));rows=cumulativeSheetRows; }
  else if(type==='handover') rows=[['Register','Date','Shift','Responsibility','Employee','Role','Acknowledged at'],...records.flatMap(r=>r.handovers.map(h=>[r.registerNo,day(r),r.shiftLabelSnapshot,h.kind,h.employeeNameSnapshot,h.employeeRoleSnapshot,h.acknowledgedAt.toISOString()]))];
  else if(type==='movement') {
    const movementWhere: any = { productionDate: { gte: from, lte: to }, ...(selectedSeason ? { seasonId: selectedSeason.id } : {}) };
    if (req.user!.role === Role.MANAGER) movementWhere.OR = [
      { recordId: { in: records.map(record => record.id) } },
      ...(selectedSeason ? [{ type: 'OPENING', seasonId: selectedSeason.id }] : [])
    ];
    const movements = await prisma.inventoryMovement.findMany({ where: movementWhere, include: { grade: true }, orderBy: { createdAt: 'asc' } });
    const [linkedRecords, movementUsers] = await Promise.all([
      prisma.shiftRecord.findMany({ where: { id: { in: movements.map(movement => movement.recordId).filter((id): id is string => !!id) } }, select: { id: true, registerNo: true, shiftLabelSnapshot: true } }),
      prisma.user.findMany({ where: { id: { in: [...new Set(movements.map(movement => movement.createdBy))] } }, select: { id: true, name: true } })
    ]);
    const linkedById = new Map(linkedRecords.map(record => [record.id, record]));
    const userById = new Map(movementUsers.map(user => [user.id, user.name]));
    rows = [['Transaction','Date','Shift','Grade','Type','Quantity','Balance after','Register','Employee','Reason','Created at'],
      ...movements.map(movement => {
        const linked = movement.recordId ? linkedById.get(movement.recordId) : undefined;
        return [movement.id, day(movement), linked?.shiftLabelSnapshot ?? (movement.type === 'OPENING' ? 'Season opening' : ''), movement.grade.code, movement.type, movement.quantity, movement.balanceAfter, linked ? linked.registerNo : '', userById.get(movement.createdBy) || 'Unknown employee', movement.reason || '', movement.createdAt.toISOString()];
      })];
  }
  else return res.status(404).json({error:'Report type not found.'});
  if(req.params.format==='xlsx'){const shiftRows:any[][]=[['Register','Date','Shift','Clerk','Status','Production bags','Dispatched bags','Closing bags'],...records.map(r=>[r.registerNo,day(r),r.shiftLabelSnapshot,r.clerkNameSnapshot,r.status,r.stockLines.reduce((a,l)=>a+l.production,0),r.stockLines.reduce((a,l)=>a+l.dispatch,0),r.stockLines.reduce((a,l)=>a+l.closing,0)])];const productionRows:any[][]=[['Register','Date','Shift','Grade','Production bags'],...stockRows.map(({r,l})=>[r.registerNo,day(r),r.shiftLabelSnapshot,l.grade.code,l.production])];const dispatchRows:any[][]=[['Register','Date','Shift','Grade','Bags dispatched'],...stockRows.filter(x=>x.l.dispatch).map(({r,l})=>[r.registerNo,day(r),r.shiftLabelSnapshot,l.grade.code,l.dispatch])];const buffer=buildXlsx([{name:'Selected report',rows},{name:'Shift Records',rows:shiftRows},{name:'Production',rows:productionRows},{name:'Inventory',rows:inventorySheetRows},{name:'Godown Dispatch',rows:dispatchRows},{name:'Cumulative Summary',rows:cumulativeSheetRows}]);res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="sugar-house-'+type+'.xlsx"');return res.send(Buffer.from(buffer));}res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="sugar-house-${type}.csv"`);res.send('\ufeff'+rows.map(row=>row.map(esc).join(',')).join('\r\n'));
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => { console.error(err); res.status(500).json({ error: 'A server error occurred. Please try again.' }); });
const port = Number(process.env.API_PORT || 4000);
app.listen(port, () => console.log(`Krushinath API listening on ${port}`));



