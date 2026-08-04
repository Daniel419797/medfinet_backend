CREATE TYPE "ClinicalRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE "vaccine_schedule_rules" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programmeId" TEXT,
  "vaccineCode" TEXT NOT NULL,
  "doseNumber" INTEGER NOT NULL,
  "minimumAgeDays" INTEGER NOT NULL,
  "recommendedAgeDays" INTEGER NOT NULL,
  "maximumAgeDays" INTEGER,
  "minimumIntervalDays" INTEGER,
  "version" INTEGER NOT NULL,
  "status" "ClinicalRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "createdBySubjectId" TEXT NOT NULL,
  "approvedBySubjectId" TEXT,
  "approvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "vaccine_schedule_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vaccine_schedule_rules_code_check"
    CHECK ("vaccineCode" ~ '^[A-Z0-9]+([-_][A-Z0-9]+)*$'),
  CONSTRAINT "vaccine_schedule_rules_numbers_check" CHECK (
    "doseNumber" BETWEEN 1 AND 20
    AND "minimumAgeDays" >= 0
    AND "recommendedAgeDays" >= "minimumAgeDays"
    AND ("maximumAgeDays" IS NULL OR "maximumAgeDays" >= "recommendedAgeDays")
    AND ("minimumIntervalDays" IS NULL OR "minimumIntervalDays" >= 0)
    AND "version" > 0
  ),
  CONSTRAINT "vaccine_schedule_rules_first_dose_interval_check"
    CHECK ("doseNumber" > 1 OR "minimumIntervalDays" IS NULL),
  CONSTRAINT "vaccine_schedule_rules_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "approvedBySubjectId" IS NULL AND "approvedAt" IS NULL)
    OR (
      "status" IN ('ACTIVE', 'RETIRED')
      AND "approvedBySubjectId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "vaccine_schedule_rules_organizationId_programmeId_vaccineCode_doseNumber_version_key"
  ON "vaccine_schedule_rules"(
    "organizationId",
    "programmeId",
    "vaccineCode",
    "doseNumber",
    "version"
  );
CREATE UNIQUE INDEX "vaccine_schedule_rules_global_version_key"
  ON "vaccine_schedule_rules"(
    "organizationId",
    "vaccineCode",
    "doseNumber",
    "version"
  )
  WHERE "programmeId" IS NULL;
CREATE UNIQUE INDEX "vaccine_schedule_rules_one_active_rule"
  ON "vaccine_schedule_rules"(
    "organizationId",
    COALESCE("programmeId", ''),
    "vaccineCode",
    "doseNumber"
  )
  WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "vaccine_schedule_rules_id_organizationId_key"
  ON "vaccine_schedule_rules"("id", "organizationId");
CREATE INDEX "vaccine_schedule_rules_organizationId_programmeId_status_vaccineCode_doseNumber_idx"
  ON "vaccine_schedule_rules"(
    "organizationId",
    "programmeId",
    "status",
    "vaccineCode",
    "doseNumber"
  );

ALTER TABLE "vaccine_schedule_rules"
  ADD CONSTRAINT "vaccine_schedule_rules_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vaccine_schedule_rules"
  ADD CONSTRAINT "vaccine_schedule_rules_programmeId_organizationId_fkey"
  FOREIGN KEY ("programmeId", "organizationId")
  REFERENCES "programmes"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vaccine_schedule_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaccine_schedule_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "vaccine_schedule_rules_tenant_isolation"
  ON "vaccine_schedule_rules"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
