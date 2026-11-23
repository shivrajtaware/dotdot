ALTER TABLE "CorrectionRequest"
ADD COLUMN "rejectedBy" TEXT,
ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "resolutionReason" TEXT;

CREATE INDEX "CorrectionRequest_rejectedAt_createdAt_idx"
ON "CorrectionRequest"("rejectedAt", "createdAt");
