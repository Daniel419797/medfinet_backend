CREATE TYPE "RetentionRecordCategory" AS ENUM (
  'AUDIT_EVIDENCE',
  'CLINICAL_RECORD',
  'IDENTITY_RECORD',
  'NOTIFICATION_ATTEMPT',
  'INTEGRATION_STAGING',
  'PUBLISHED_OUTBOX'
);
CREATE TYPE "RetentionDisposition" AS ENUM ('REVIEW_ONLY', 'DELETE');
CREATE TYPE "GovernancePolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "RetentionExecutionStatus" AS ENUM (
  'PREVIEWED',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'FAILED'
);
CREATE TYPE "LegalHoldTargetType" AS ENUM ('CHILD', 'CAREGIVER', 'ORGANIZATION');
CREATE TYPE "LegalHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');
CREATE TYPE "DataSubjectRequestType" AS ENUM (
  'ACCESS',
  'RECTIFICATION',
  'ERASURE',
  'RESTRICTION',
  'PORTABILITY',
  'OBJECTION'
);
CREATE TYPE "DataSubjectRequestStatus" AS ENUM (
  'RECEIVED',
  'IDENTITY_VERIFIED',
  'IN_REVIEW',
  'APPROVED',
  'DENIED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TABLE "data_retention_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "recordCategory" "RetentionRecordCategory" NOT NULL,
  "retentionDays" INTEGER NOT NULL,
  "disposition" "RetentionDisposition" NOT NULL,
  "legalBasis" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "GovernancePolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedBySubjectId" TEXT,
  "approvedAt" TIMESTAMPTZ(3),
  "effectiveAt" TIMESTAMPTZ(3),
  "createdBySubjectId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "data_retention_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_retention_policies_retention_days_check"
    CHECK ("retentionDays" BETWEEN 1 AND 36500),
  CONSTRAINT "data_retention_policies_version_check" CHECK ("version" > 0),
  CONSTRAINT "data_retention_policies_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "approvedBySubjectId" IS NULL AND "approvedAt" IS NULL)
    OR (
      "status" IN ('ACTIVE', 'RETIRED')
      AND "approvedBySubjectId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "effectiveAt" IS NOT NULL
    )
  ),
  CONSTRAINT "data_retention_policies_safe_disposition_check" CHECK (
    "recordCategory" IN ('NOTIFICATION_ATTEMPT', 'INTEGRATION_STAGING', 'PUBLISHED_OUTBOX')
    OR "disposition" = 'REVIEW_ONLY'
  )
);

CREATE TABLE "retention_execution_runs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "status" "RetentionExecutionStatus" NOT NULL DEFAULT 'PREVIEWED',
  "cutoffAt" TIMESTAMPTZ(3) NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "excludedByHoldCount" INTEGER NOT NULL DEFAULT 0,
  "affectedCount" INTEGER NOT NULL DEFAULT 0,
  "previewedBySubjectId" TEXT NOT NULL,
  "approvedBySubjectId" TEXT,
  "approvedAt" TIMESTAMPTZ(3),
  "executedBySubjectId" TEXT,
  "executedAt" TIMESTAMPTZ(3),
  "failureCode" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "retention_execution_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retention_execution_runs_counts_check" CHECK (
    "candidateCount" >= 0
    AND "excludedByHoldCount" >= 0
    AND "affectedCount" >= 0
    AND "affectedCount" <= "candidateCount"
  ),
  CONSTRAINT "retention_execution_runs_lifecycle_check" CHECK (
    (
      "status" = 'PREVIEWED'
      AND "approvedBySubjectId" IS NULL
      AND "approvedAt" IS NULL
      AND "executedAt" IS NULL
    )
    OR (
      "status" = 'APPROVED'
      AND "approvedBySubjectId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "executedAt" IS NULL
    )
    OR (
      "status" = 'EXECUTING'
      AND "approvedBySubjectId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "executedBySubjectId" IS NOT NULL
      AND "executedAt" IS NULL
    )
    OR (
      "status" IN ('COMPLETED', 'FAILED')
      AND "approvedBySubjectId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "executedBySubjectId" IS NOT NULL
      AND "executedAt" IS NOT NULL
    )
  ),
  CONSTRAINT "retention_execution_runs_maker_checker_check"
    CHECK ("approvedBySubjectId" IS NULL OR "approvedBySubjectId" <> "previewedBySubjectId")
);

CREATE TABLE "legal_holds" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "childId" TEXT,
  "targetType" "LegalHoldTargetType" NOT NULL,
  "targetReference" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "legalAuthority" TEXT NOT NULL,
  "status" "LegalHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "placedBySubjectId" TEXT NOT NULL,
  "placedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedBySubjectId" TEXT,
  "releasedAt" TIMESTAMPTZ(3),
  "releaseReason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legal_holds_child_target_check" CHECK (
    ("targetType" = 'CHILD' AND "childId" IS NOT NULL AND "targetReference" = "childId")
    OR ("targetType" <> 'CHILD' AND "childId" IS NULL)
  ),
  CONSTRAINT "legal_holds_lifecycle_check" CHECK (
    (
      "status" = 'ACTIVE'
      AND "releasedBySubjectId" IS NULL
      AND "releasedAt" IS NULL
      AND "releaseReason" IS NULL
    )
    OR (
      "status" = 'RELEASED'
      AND "releasedBySubjectId" IS NOT NULL
      AND "releasedAt" IS NOT NULL
      AND "releaseReason" IS NOT NULL
    )
  )
);

CREATE TABLE "data_subject_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caregiverId" TEXT,
  "childId" TEXT,
  "requestType" "DataSubjectRequestType" NOT NULL,
  "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "requestDetails" TEXT NOT NULL,
  "submittedBySubjectId" TEXT NOT NULL,
  "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "identityVerifiedBySubjectId" TEXT,
  "identityVerifiedAt" TIMESTAMPTZ(3),
  "assignedToSubjectId" TEXT,
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "decision" TEXT,
  "decisionReason" TEXT,
  "decidedBySubjectId" TEXT,
  "decidedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_subject_requests_subject_check"
    CHECK ("caregiverId" IS NOT NULL OR "childId" IS NOT NULL),
  CONSTRAINT "data_subject_requests_verification_check" CHECK (
    ("identityVerifiedBySubjectId" IS NULL AND "identityVerifiedAt" IS NULL)
    OR ("identityVerifiedBySubjectId" IS NOT NULL AND "identityVerifiedAt" IS NOT NULL)
  ),
  CONSTRAINT "data_subject_requests_decision_check" CHECK (
    (
      "status" IN ('RECEIVED', 'IDENTITY_VERIFIED', 'IN_REVIEW', 'CANCELLED')
      AND "decision" IS NULL
      AND "decidedBySubjectId" IS NULL
      AND "decidedAt" IS NULL
    )
    OR (
      "status" IN ('APPROVED', 'DENIED', 'COMPLETED')
      AND "decision" IS NOT NULL
      AND "decidedBySubjectId" IS NOT NULL
      AND "decidedAt" IS NOT NULL
    )
  ),
  CONSTRAINT "data_subject_requests_completion_check" CHECK (
    ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "data_retention_policies_organizationId_recordCategory_version_key"
  ON "data_retention_policies"("organizationId", "recordCategory", "version");
CREATE UNIQUE INDEX "data_retention_policies_id_organizationId_key"
  ON "data_retention_policies"("id", "organizationId");
CREATE INDEX "data_retention_policies_organizationId_recordCategory_status_idx"
  ON "data_retention_policies"("organizationId", "recordCategory", "status");
CREATE UNIQUE INDEX "data_retention_policies_one_active_category"
  ON "data_retention_policies"("organizationId", "recordCategory")
  WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "retention_execution_runs_organizationId_idempotencyKey_key"
  ON "retention_execution_runs"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "retention_execution_runs_id_organizationId_key"
  ON "retention_execution_runs"("id", "organizationId");
CREATE INDEX "retention_execution_runs_organizationId_status_createdAt_idx"
  ON "retention_execution_runs"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "legal_holds_id_organizationId_key"
  ON "legal_holds"("id", "organizationId");
CREATE INDEX "legal_holds_organizationId_status_targetType_targetReference_idx"
  ON "legal_holds"("organizationId", "status", "targetType", "targetReference");
CREATE INDEX "legal_holds_organizationId_childId_status_idx"
  ON "legal_holds"("organizationId", "childId", "status");
CREATE UNIQUE INDEX "legal_holds_one_active_target"
  ON "legal_holds"("organizationId", "targetType", "targetReference")
  WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "data_subject_requests_id_organizationId_key"
  ON "data_subject_requests"("id", "organizationId");
CREATE INDEX "data_subject_requests_organizationId_status_dueAt_idx"
  ON "data_subject_requests"("organizationId", "status", "dueAt");
CREATE INDEX "data_subject_requests_organizationId_caregiverId_submittedAt_idx"
  ON "data_subject_requests"("organizationId", "caregiverId", "submittedAt");
CREATE INDEX "data_subject_requests_organizationId_childId_submittedAt_idx"
  ON "data_subject_requests"("organizationId", "childId", "submittedAt");

ALTER TABLE "data_retention_policies"
  ADD CONSTRAINT "data_retention_policies_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_execution_runs"
  ADD CONSTRAINT "retention_execution_runs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_execution_runs"
  ADD CONSTRAINT "retention_execution_runs_policyId_organizationId_fkey"
  FOREIGN KEY ("policyId", "organizationId")
  REFERENCES "data_retention_policies"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_holds"
  ADD CONSTRAINT "legal_holds_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_holds"
  ADD CONSTRAINT "legal_holds_childId_organizationId_fkey"
  FOREIGN KEY ("childId", "organizationId")
  REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_subject_requests"
  ADD CONSTRAINT "data_subject_requests_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_subject_requests"
  ADD CONSTRAINT "data_subject_requests_caregiverId_organizationId_fkey"
  FOREIGN KEY ("caregiverId", "organizationId")
  REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_subject_requests"
  ADD CONSTRAINT "data_subject_requests_childId_organizationId_fkey"
  FOREIGN KEY ("childId", "organizationId")
  REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'data_retention_policies',
    'retention_execution_runs',
    'legal_holds',
    'data_subject_requests'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organizationId" = current_setting(''app.current_organization_id'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_organization_id'', true))',
      table_name || '_tenant_isolation',
      table_name
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_immutable"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
