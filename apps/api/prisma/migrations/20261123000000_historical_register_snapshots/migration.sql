ALTER TABLE "ShiftRecord"
  ADD COLUMN "clerkNameSnapshot" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "assignedChemistNameSnapshot" TEXT,
  ADD COLUMN "shiftLabelSnapshot" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "shiftStartsAtSnapshot" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "shiftEndsAtSnapshot" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "shiftSortOrderSnapshot" INTEGER NOT NULL DEFAULT 0;

UPDATE "ShiftRecord" AS record
SET "clerkNameSnapshot" = clerk."name",
    "shiftLabelSnapshot" = shift."label",
    "shiftStartsAtSnapshot" = shift."startsAt",
    "shiftEndsAtSnapshot" = shift."endsAt",
    "shiftSortOrderSnapshot" = shift."sortOrder"
FROM "User" AS clerk, "ShiftDefinition" AS shift
WHERE record."clerkId" = clerk."id"
  AND record."shiftId" = shift."id";

UPDATE "ShiftRecord" AS record
SET "assignedChemistNameSnapshot" = chemist."name"
FROM "User" AS chemist
WHERE record."assignedChemistId" = chemist."id";

ALTER TABLE "ShiftRecord"
  ALTER COLUMN "clerkNameSnapshot" DROP DEFAULT,
  ALTER COLUMN "shiftLabelSnapshot" DROP DEFAULT,
  ALTER COLUMN "shiftStartsAtSnapshot" DROP DEFAULT,
  ALTER COLUMN "shiftEndsAtSnapshot" DROP DEFAULT,
  ALTER COLUMN "shiftSortOrderSnapshot" DROP DEFAULT;

ALTER TABLE "Handover"
  ADD COLUMN "employeeNameSnapshot" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "employeeRoleSnapshot" "Role" NOT NULL DEFAULT 'MANAGER';

UPDATE "Handover" AS handover
SET "employeeNameSnapshot" = employee."name",
    "employeeRoleSnapshot" = employee."role"
FROM "User" AS employee
WHERE handover."userId" = employee."id";

ALTER TABLE "Handover"
  ALTER COLUMN "employeeNameSnapshot" DROP DEFAULT,
  ALTER COLUMN "employeeRoleSnapshot" DROP DEFAULT;
