ALTER TABLE "ShiftRecord" ADD COLUMN "offlineId" TEXT;

CREATE UNIQUE INDEX "ShiftRecord_offlineId_key"
ON "ShiftRecord"("offlineId");
