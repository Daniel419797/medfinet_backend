CREATE TYPE "AllergyCriticality" AS ENUM ('LOW', 'HIGH', 'UNABLE_TO_ASSESS');
CREATE TYPE "AllergyStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR');

CREATE TABLE "allergy_records" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "substanceCode" TEXT,
  "substanceDisplay" TEXT NOT NULL,
  "reaction" TEXT,
  "severity" "AlertSeverity" NOT NULL,
  "criticality" "AllergyCriticality" NOT NULL,
  "status" "AllergyStatus" NOT NULL DEFAULT 'ACTIVE',
  "recordedBySubjectId" TEXT NOT NULL,
  "resolvedBySubjectId" TEXT,
  "resolvedAt" TIMESTAMPTZ(3),
  "resolutionReason" TEXT,
  "sourceOperationId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "allergy_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "allergy_records_substance_check"
    CHECK (char_length("substanceDisplay") BETWEEN 1 AND 200),
  CONSTRAINT "allergy_records_lifecycle_check" CHECK (
    (
      "status" = 'ACTIVE'
      AND "resolvedBySubjectId" IS NULL
      AND "resolvedAt" IS NULL
      AND "resolutionReason" IS NULL
    )
    OR (
      "status" IN ('RESOLVED', 'ENTERED_IN_ERROR')
      AND "resolvedBySubjectId" IS NOT NULL
      AND "resolvedAt" IS NOT NULL
      AND "resolutionReason" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "allergy_records_id_organizationId_key"
  ON "allergy_records"("id", "organizationId");
CREATE UNIQUE INDEX "allergy_records_organizationId_sourceOperationId_key"
  ON "allergy_records"("organizationId", "sourceOperationId");
CREATE INDEX "allergy_records_organizationId_childId_status_idx"
  ON "allergy_records"("organizationId", "childId", "status");

ALTER TABLE "allergy_records"
  ADD CONSTRAINT "allergy_records_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allergy_records"
  ADD CONSTRAINT "allergy_records_childId_organizationId_fkey"
  FOREIGN KEY ("childId", "organizationId")
  REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allergy_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allergy_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "allergy_records_tenant_isolation"
  ON "allergy_records"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

CREATE OR REPLACE FUNCTION prevent_clinical_amendment_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'clinical amendments are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "clinical_amendments_immutable"
BEFORE UPDATE OR DELETE ON "clinical_amendments"
FOR EACH ROW EXECUTE FUNCTION prevent_clinical_amendment_mutation();
