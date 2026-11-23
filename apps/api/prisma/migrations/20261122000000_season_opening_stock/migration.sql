ALTER TABLE "Season"
ADD COLUMN "openingStock" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX "Season_name_key" ON "Season"("name");
