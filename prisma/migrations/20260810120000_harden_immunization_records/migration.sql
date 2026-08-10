-- Existing records remain nullable so deployment does not guess which historical
-- duplicate is authoritative. The service checks all active historical rows,
-- while this key closes concurrent duplicate creation for new and amended rows.
ALTER TABLE "immunization_records"
  ADD COLUMN "deduplicationKey" TEXT;

CREATE UNIQUE INDEX "immunization_records_organizationId_deduplicationKey_key"
  ON "immunization_records"("organizationId", "deduplicationKey");
