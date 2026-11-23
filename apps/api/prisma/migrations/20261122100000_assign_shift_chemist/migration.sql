ALTER TABLE "ShiftDefinition" ADD COLUMN "chemistId" TEXT;

CREATE INDEX "ShiftDefinition_chemistId_idx" ON "ShiftDefinition"("chemistId");

ALTER TABLE "ShiftDefinition"
ADD CONSTRAINT "ShiftDefinition_chemistId_fkey"
FOREIGN KEY ("chemistId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShiftRecord" ADD COLUMN "assignedChemistId" TEXT;

CREATE INDEX "ShiftRecord_assignedChemistId_status_idx" ON "ShiftRecord"("assignedChemistId", "status");

UPDATE "ShiftRecord" AS record
SET "assignedChemistId" = shift."chemistId"
FROM "ShiftDefinition" AS shift
WHERE record."shiftId" = shift."id"
  AND record."status" IN ('SUBMITTED', 'APPROVED', 'LOCKED');

ALTER TABLE "ShiftRecord"
ADD CONSTRAINT "ShiftRecord_assignedChemistId_fkey"
FOREIGN KEY ("assignedChemistId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
