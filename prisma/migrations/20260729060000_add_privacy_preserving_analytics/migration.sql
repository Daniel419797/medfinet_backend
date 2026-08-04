CREATE TYPE "AnalyticsGeographyLevel" AS ENUM ('NATIONAL', 'STATE', 'LGA');
CREATE TYPE "AnalyticsGenerationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "AnalyticsDimensionType" AS ENUM ('ORGANIZATION', 'PROGRAMME', 'FACILITY', 'ADMIN_AREA');
CREATE TYPE "AnalyticsMetricUnit" AS ENUM ('COUNT', 'PERCENT');
CREATE TYPE "AnalyticsDisclosureStatus" AS ENUM ('INTERNAL', 'PUBLISHED', 'SUPPRESSED');

CREATE TABLE "analytics_publication_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "isPublicEnabled" BOOLEAN NOT NULL DEFAULT false,
    "minimumCellSize" INTEGER NOT NULL DEFAULT 10,
    "maximumGeography" "AnalyticsGeographyLevel" NOT NULL DEFAULT 'STATE',
    "publicOrganizationName" TEXT,
    "approvedBySubjectId" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "analytics_publication_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analytics_publication_policies_minimum_cell_size_check"
      CHECK ("minimumCellSize" BETWEEN 10 AND 1000),
    CONSTRAINT "analytics_publication_policies_approval_check" CHECK (
      ("isPublicEnabled" = false)
      OR (
        "approvedBySubjectId" IS NOT NULL
        AND "approvedAt" IS NOT NULL
        AND "publicOrganizationName" IS NOT NULL
      )
    )
);

CREATE TABLE "analytics_generation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "AnalyticsGenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "requestedBySubjectId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "metricCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "analytics_generation_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "analytics_generation_runs_period_check" CHECK ("periodEnd" > "periodStart"),
    CONSTRAINT "analytics_generation_runs_metric_count_check" CHECK ("metricCount" >= 0),
    CONSTRAINT "analytics_generation_runs_lifecycle_check" CHECK (
      ("status" = 'QUEUED' AND "startedAt" IS NULL AND "completedAt" IS NULL)
      OR ("status" = 'PROCESSING' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL)
      OR ("status" IN ('COMPLETED', 'FAILED') AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL)
    )
);

CREATE TABLE "aggregate_metric_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "generationRunId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "dimensionType" "AnalyticsDimensionType" NOT NULL DEFAULT 'ORGANIZATION',
    "dimensionValue" TEXT NOT NULL,
    "numerator" INTEGER NOT NULL,
    "denominator" INTEGER,
    "valueBasisPoints" INTEGER,
    "unit" "AnalyticsMetricUnit" NOT NULL,
    "cohortSize" INTEGER NOT NULL,
    "disclosureStatus" "AnalyticsDisclosureStatus" NOT NULL DEFAULT 'INTERNAL',
    "suppressionReason" TEXT,
    "dataThrough" TIMESTAMPTZ(3) NOT NULL,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "aggregate_metric_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aggregate_metric_snapshots_period_check" CHECK ("periodEnd" > "periodStart"),
    CONSTRAINT "aggregate_metric_snapshots_counts_check" CHECK (
      "numerator" >= 0
      AND ("denominator" IS NULL OR "denominator" >= 0)
      AND "cohortSize" >= 0
    ),
    CONSTRAINT "aggregate_metric_snapshots_percentage_check" CHECK (
      ("unit" = 'COUNT' AND "denominator" IS NULL AND "valueBasisPoints" IS NULL)
      OR (
        "unit" = 'PERCENT'
        AND "denominator" IS NOT NULL
        AND "numerator" <= "denominator"
        AND "valueBasisPoints" BETWEEN 0 AND 10000
      )
    ),
    CONSTRAINT "aggregate_metric_snapshots_disclosure_check" CHECK (
      ("disclosureStatus" = 'SUPPRESSED' AND "suppressionReason" IS NOT NULL)
      OR ("disclosureStatus" <> 'SUPPRESSED' AND "suppressionReason" IS NULL)
    )
);

CREATE UNIQUE INDEX "analytics_publication_policies_organizationId_key"
  ON "analytics_publication_policies"("organizationId");
CREATE UNIQUE INDEX "analytics_generation_runs_organizationId_idempotencyKey_key"
  ON "analytics_generation_runs"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "analytics_generation_runs_id_organizationId_key"
  ON "analytics_generation_runs"("id", "organizationId");
CREATE INDEX "analytics_generation_runs_organizationId_status_createdAt_idx"
  ON "analytics_generation_runs"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "aggregate_metric_snapshots_generationRunId_metricKey_dimensionType_dimensionValue_key"
  ON "aggregate_metric_snapshots"("generationRunId", "metricKey", "dimensionType", "dimensionValue");
CREATE INDEX "aggregate_metric_snapshots_organizationId_disclosureStatus_periodEnd_metricKey_idx"
  ON "aggregate_metric_snapshots"("organizationId", "disclosureStatus", "periodEnd", "metricKey");
CREATE INDEX "aggregate_metric_snapshots_organizationId_dimensionType_dimensionValue_periodEnd_idx"
  ON "aggregate_metric_snapshots"("organizationId", "dimensionType", "dimensionValue", "periodEnd");

ALTER TABLE "analytics_publication_policies"
  ADD CONSTRAINT "analytics_publication_policies_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_generation_runs"
  ADD CONSTRAINT "analytics_generation_runs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aggregate_metric_snapshots"
  ADD CONSTRAINT "aggregate_metric_snapshots_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aggregate_metric_snapshots"
  ADD CONSTRAINT "aggregate_metric_snapshots_generationRunId_organizationId_fkey"
  FOREIGN KEY ("generationRunId", "organizationId")
  REFERENCES "analytics_generation_runs"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "analytics_publication_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_publication_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "analytics_publication_policies_tenant_isolation"
  ON "analytics_publication_policies"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "analytics_generation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_generation_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "analytics_generation_runs_tenant_isolation"
  ON "analytics_generation_runs"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "aggregate_metric_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "aggregate_metric_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY "aggregate_metric_snapshots_tenant_isolation"
  ON "aggregate_metric_snapshots"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

CREATE OR REPLACE FUNCTION prevent_aggregate_metric_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'aggregate metric snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aggregate_metric_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "aggregate_metric_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_aggregate_metric_mutation();
