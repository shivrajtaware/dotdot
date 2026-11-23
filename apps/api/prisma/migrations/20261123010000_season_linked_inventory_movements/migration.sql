ALTER TABLE "InventoryMovement" ADD COLUMN "seasonId" TEXT;

UPDATE "InventoryMovement" AS movement
SET "seasonId" = record."seasonId"
FROM "ShiftRecord" AS record
WHERE movement."recordId" = record."id";

UPDATE "InventoryMovement" AS movement
SET "seasonId" = season."id"
FROM "Season" AS season
WHERE movement."seasonId" IS NULL
  AND movement."productionDate" >= season."startDate"
  AND (season."endDate" IS NULL OR movement."productionDate" < season."endDate");

CREATE INDEX "InventoryMovement_seasonId_productionDate_idx"
ON "InventoryMovement"("seasonId", "productionDate");

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_seasonId_fkey"
FOREIGN KEY ("seasonId") REFERENCES "Season"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
