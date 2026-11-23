-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'CHEMIST', 'VIEWER');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING', 'PRODUCTION', 'DISPATCH', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "openingCumulative" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactorySetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactorySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftDefinition" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TEXT NOT NULL,
    "endsAt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ShiftDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRecord" (
    "id" TEXT NOT NULL,
    "registerNo" SERIAL NOT NULL,
    "productionDate" DATE NOT NULL,
    "scaleCheckTime" TEXT,
    "account" TEXT NOT NULL DEFAULT 'Production',
    "clerkId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "adjustmentReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ShiftRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLine" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "opening" INTEGER NOT NULL DEFAULT 0,
    "production" INTEGER NOT NULL DEFAULT 0,
    "available" INTEGER NOT NULL DEFAULT 0,
    "dispatch" INTEGER NOT NULL DEFAULT 0,
    "closing" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionEntry" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "entryTime" TEXT NOT NULL,
    "fromNumber" INTEGER NOT NULL,
    "toNumber" INTEGER NOT NULL,
    "bags" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ProductionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalCount" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelSnapshot" TEXT NOT NULL,
    "bags" INTEGER NOT NULL,

    CONSTRAINT "OperationalCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisterReference" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelSnapshot" TEXT NOT NULL,
    "referenceDate" DATE,
    "numberValue" INTEGER,

    CONSTRAINT "RegisterReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "recordId" TEXT,
    "productionDate" DATE NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handover" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureData" TEXT,

    CONSTRAINT "Handover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "proposedValues" JSONB NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "recordId" TEXT,
    "previousValues" JSONB,
    "updatedValues" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_active_idx" ON "User"("role", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactorySetting_key_key" ON "FactorySetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftDefinition_label_key" ON "ShiftDefinition"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_code_key" ON "Grade"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRecord_registerNo_key" ON "ShiftRecord"("registerNo");

-- CreateIndex
CREATE INDEX "ShiftRecord_productionDate_status_idx" ON "ShiftRecord"("productionDate", "status");

-- CreateIndex
CREATE INDEX "ShiftRecord_clerkId_productionDate_idx" ON "ShiftRecord"("clerkId", "productionDate");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRecord_productionDate_shiftId_key" ON "ShiftRecord"("productionDate", "shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLine_recordId_gradeId_key" ON "StockLine"("recordId", "gradeId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalCount_recordId_code_key" ON "OperationalCount"("recordId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterReference_recordId_code_key" ON "RegisterReference"("recordId", "code");

-- CreateIndex
CREATE INDEX "InventoryMovement_gradeId_productionDate_idx" ON "InventoryMovement"("gradeId", "productionDate");

-- CreateIndex
CREATE UNIQUE INDEX "Handover_recordId_kind_key" ON "Handover"("recordId", "kind");

-- CreateIndex
CREATE INDEX "AuditLog_recordId_createdAt_idx" ON "AuditLog"("recordId", "createdAt");

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRecord" ADD CONSTRAINT "ShiftRecord_clerkId_fkey" FOREIGN KEY ("clerkId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRecord" ADD CONSTRAINT "ShiftRecord_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ShiftDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRecord" ADD CONSTRAINT "ShiftRecord_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLine" ADD CONSTRAINT "StockLine_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ShiftRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLine" ADD CONSTRAINT "StockLine_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionEntry" ADD CONSTRAINT "ProductionEntry_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ShiftRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalCount" ADD CONSTRAINT "OperationalCount_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ShiftRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterReference" ADD CONSTRAINT "RegisterReference_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ShiftRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handover" ADD CONSTRAINT "Handover_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ShiftRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handover" ADD CONSTRAINT "Handover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

