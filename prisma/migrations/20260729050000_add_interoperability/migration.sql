CREATE TYPE "IntegrationType" AS ENUM ('FHIR_R4', 'DHIS2');
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "IntegrationAuthType" AS ENUM ('BEARER', 'BASIC', 'OAUTH2_CLIENT_CREDENTIALS');
CREATE TYPE "IntegrationHealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'UNREACHABLE');
CREATE TYPE "IntegrationDirection" AS ENUM ('IMPORT', 'EXPORT');
CREATE TYPE "IntegrationMappingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "IntegrationJobStatus" AS ENUM (
    'QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'
);
CREATE TYPE "IntegrationRecordStatus" AS ENUM ('SUCCEEDED', 'STAGED', 'FAILED', 'SKIPPED', 'CONFLICT');
CREATE TYPE "IntegrationReconciliationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "IntegrationImportReviewStatus" AS ENUM (
    'PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'CONFLICT'
);

CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partnerIdentifier" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'DRAFT',
    "baseUrl" TEXT NOT NULL,
    "authType" "IntegrationAuthType" NOT NULL,
    "credentialSecretName" TEXT NOT NULL,
    "fhirVersion" TEXT,
    "dhis2ApiVersion" TEXT,
    "allowedDataCategories" JSONB NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "lastHealthStatus" "IntegrationHealthStatus",
    "lastHealthCheckedAt" TIMESTAMPTZ(3),
    "lastHealthErrorCode" TEXT,
    "createdBySubjectId" TEXT NOT NULL,
    "activatedBySubjectId" TEXT,
    "activatedAt" TIMESTAMPTZ(3),
    "suspendedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_connections_timeout_check" CHECK (
        "timeoutMs" BETWEEN 1000 AND 60000
    ),
    CONSTRAINT "integration_connections_version_check" CHECK (
        ("type" = 'FHIR_R4' AND "fhirVersion" = '4.0.1' AND "dhis2ApiVersion" IS NULL)
        OR (
            "type" = 'DHIS2'
            AND "dhis2ApiVersion" IS NOT NULL
            AND "fhirVersion" IS NULL
        )
    ),
    CONSTRAINT "integration_connections_lifecycle_check" CHECK (
        (
            "status" = 'ACTIVE'
            AND "activatedBySubjectId" IS NOT NULL
            AND "activatedAt" IS NOT NULL
            AND "suspendedAt" IS NULL
        )
        OR (
            "status" = 'SUSPENDED'
            AND "activatedBySubjectId" IS NOT NULL
            AND "activatedAt" IS NOT NULL
            AND "suspendedAt" IS NOT NULL
        )
        OR "status" IN ('DRAFT', 'CLOSED')
    )
);

CREATE TABLE "integration_mappings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "direction" "IntegrationDirection" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "IntegrationMappingStatus" NOT NULL DEFAULT 'DRAFT',
    "mappingDefinition" JSONB NOT NULL,
    "createdBySubjectId" TEXT NOT NULL,
    "activatedBySubjectId" TEXT,
    "activatedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_mappings_version_check" CHECK ("version" > 0),
    CONSTRAINT "integration_mappings_lifecycle_check" CHECK (
        (
            "status" = 'ACTIVE'
            AND "activatedBySubjectId" IS NOT NULL
            AND "activatedAt" IS NOT NULL
            AND "retiredAt" IS NULL
        )
        OR (
            "status" = 'RETIRED'
            AND "activatedBySubjectId" IS NOT NULL
            AND "activatedAt" IS NOT NULL
            AND "retiredAt" IS NOT NULL
        )
        OR (
            "status" = 'DRAFT'
            AND "activatedBySubjectId" IS NULL
            AND "activatedAt" IS NULL
            AND "retiredAt" IS NULL
        )
    )
);

CREATE TABLE "integration_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "direction" "IntegrationDirection" NOT NULL,
    "resourceType" TEXT NOT NULL,
    "status" "IntegrationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "criteria" JSONB NOT NULL,
    "cursor" TEXT,
    "recordsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "recordsSucceeded" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "requestedBySubjectId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "lastErrorCode" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_jobs_counts_check" CHECK (
        "recordsDiscovered" >= 0
        AND "recordsSucceeded" >= 0
        AND "recordsFailed" >= 0
        AND "recordsSucceeded" + "recordsFailed" <= "recordsDiscovered"
    ),
    CONSTRAINT "integration_jobs_lock_check" CHECK (
        ("lockedAt" IS NULL AND "lockedBy" IS NULL)
        OR ("lockedAt" IS NOT NULL AND "lockedBy" IS NOT NULL)
    ),
    CONSTRAINT "integration_jobs_lifecycle_check" CHECK (
        ("status" = 'QUEUED' AND "startedAt" IS NULL)
        OR ("status" = 'PROCESSING' AND "startedAt" IS NOT NULL)
        OR (
            "status" IN ('COMPLETED', 'PARTIAL', 'CANCELLED')
            AND "startedAt" IS NOT NULL
            AND "completedAt" IS NOT NULL
        )
        OR (
            "status" = 'FAILED'
            AND "startedAt" IS NOT NULL
            AND "failedAt" IS NOT NULL
            AND "lastErrorCode" IS NOT NULL
        )
    )
);

CREATE TABLE "integration_exchange_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "recordKey" TEXT NOT NULL,
    "localResourceType" TEXT NOT NULL,
    "localResourceId" TEXT,
    "externalResourceId" TEXT,
    "externalVersion" TEXT,
    "payloadHash" TEXT NOT NULL,
    "status" "IntegrationRecordStatus" NOT NULL,
    "errorCode" TEXT,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_exchange_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_exchange_records_hash_check" CHECK (
        "payloadHash" ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT "integration_exchange_records_status_check" CHECK (
        ("status" IN ('FAILED', 'CONFLICT') AND "errorCode" IS NOT NULL)
        OR ("status" IN ('SUCCEEDED', 'STAGED') AND "errorCode" IS NULL)
        OR "status" = 'SKIPPED'
    )
);

CREATE TABLE "integration_import_staging" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "recordKey" TEXT NOT NULL,
    "externalResourceType" TEXT NOT NULL,
    "externalResourceId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "payloadCiphertext" TEXT NOT NULL,
    "payloadIv" TEXT NOT NULL,
    "payloadAuthTag" TEXT NOT NULL,
    "status" "IntegrationImportReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBySubjectId" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewReason" TEXT,
    "appliedResourceType" TEXT,
    "appliedResourceId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_import_staging_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_import_staging_hash_check" CHECK (
        "payloadHash" ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT "integration_import_staging_review_check" CHECK (
        (
            "status" = 'PENDING'
            AND "reviewedBySubjectId" IS NULL
            AND "reviewedAt" IS NULL
        )
        OR (
            "status" <> 'PENDING'
            AND "reviewedBySubjectId" IS NOT NULL
            AND "reviewedAt" IS NOT NULL
        )
    ),
    CONSTRAINT "integration_import_staging_apply_check" CHECK (
        (
            "status" = 'APPLIED'
            AND "appliedResourceType" IS NOT NULL
            AND "appliedResourceId" IS NOT NULL
        )
        OR "status" <> 'APPLIED'
    )
);

CREATE TABLE "integration_reconciliation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" "IntegrationReconciliationStatus" NOT NULL DEFAULT 'RUNNING',
    "localCount" INTEGER NOT NULL DEFAULT 0,
    "externalCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "missingLocalCount" INTEGER NOT NULL DEFAULT 0,
    "missingExternalCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "startedBySubjectId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "cursor" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    CONSTRAINT "integration_reconciliation_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_reconciliation_counts_check" CHECK (
        "localCount" >= 0
        AND "externalCount" >= 0
        AND "matchedCount" >= 0
        AND "missingLocalCount" >= 0
        AND "missingExternalCount" >= 0
        AND "mismatchCount" >= 0
    ),
    CONSTRAINT "integration_reconciliation_lock_check" CHECK (
        ("lockedAt" IS NULL AND "lockedBy" IS NULL)
        OR ("lockedAt" IS NOT NULL AND "lockedBy" IS NOT NULL)
    ),
    CONSTRAINT "integration_reconciliation_lifecycle_check" CHECK (
        ("status" = 'RUNNING' AND "completedAt" IS NULL AND "failedAt" IS NULL)
        OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "failedAt" IS NULL)
        OR (
            "status" = 'FAILED'
            AND "failedAt" IS NOT NULL
            AND "errorCode" IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX "integration_connections_id_tenant_key"
ON "integration_connections"("id", "organizationId");
CREATE UNIQUE INDEX "integration_connections_partner_key"
ON "integration_connections"("organizationId", "partnerIdentifier");
CREATE INDEX "integration_connections_status_idx"
ON "integration_connections"("organizationId", "type", "status");
CREATE UNIQUE INDEX "integration_mappings_id_tenant_key"
ON "integration_mappings"("id", "organizationId");
CREATE UNIQUE INDEX "integration_mappings_version_key"
ON "integration_mappings"("connectionId", "resourceType", "direction", "version");
CREATE UNIQUE INDEX "integration_mappings_one_active_key"
ON "integration_mappings"("connectionId", "resourceType", "direction")
WHERE "status" = 'ACTIVE';
CREATE INDEX "integration_mappings_lookup_idx"
ON "integration_mappings"("organizationId", "connectionId", "resourceType", "direction", "status");
CREATE UNIQUE INDEX "integration_jobs_id_tenant_key"
ON "integration_jobs"("id", "organizationId");
CREATE UNIQUE INDEX "integration_jobs_idempotency_key"
ON "integration_jobs"("organizationId", "idempotencyKey");
CREATE INDEX "integration_jobs_status_idx"
ON "integration_jobs"("organizationId", "status", "createdAt");
CREATE INDEX "integration_jobs_connection_idx"
ON "integration_jobs"("organizationId", "connectionId", "direction", "resourceType");
CREATE UNIQUE INDEX "integration_exchange_records_id_tenant_key"
ON "integration_exchange_records"("id", "organizationId");
CREATE UNIQUE INDEX "integration_exchange_records_job_record_key"
ON "integration_exchange_records"("jobId", "recordKey");
CREATE INDEX "integration_exchange_records_job_status_idx"
ON "integration_exchange_records"("organizationId", "jobId", "status");
CREATE INDEX "integration_exchange_records_local_idx"
ON "integration_exchange_records"("organizationId", "localResourceType", "localResourceId");
CREATE UNIQUE INDEX "integration_reconciliation_runs_id_tenant_key"
ON "integration_reconciliation_runs"("id", "organizationId");
CREATE INDEX "integration_reconciliation_runs_status_idx"
ON "integration_reconciliation_runs"("organizationId", "connectionId", "status", "startedAt");
CREATE UNIQUE INDEX "integration_import_staging_id_tenant_key"
ON "integration_import_staging"("id", "organizationId");
CREATE UNIQUE INDEX "integration_import_staging_job_record_key"
ON "integration_import_staging"("jobId", "recordKey");
CREATE INDEX "integration_import_staging_review_idx"
ON "integration_import_staging"("organizationId", "status", "createdAt");

ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organization_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_organization_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_connection_fkey"
FOREIGN KEY ("connectionId", "organizationId") REFERENCES "integration_connections"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_organization_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_connection_fkey"
FOREIGN KEY ("connectionId", "organizationId") REFERENCES "integration_connections"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_mapping_fkey"
FOREIGN KEY ("mappingId", "organizationId") REFERENCES "integration_mappings"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_exchange_records" ADD CONSTRAINT "integration_exchange_records_organization_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_exchange_records" ADD CONSTRAINT "integration_exchange_records_job_fkey"
FOREIGN KEY ("jobId", "organizationId") REFERENCES "integration_jobs"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_reconciliation_runs" ADD CONSTRAINT "integration_reconciliation_runs_organization_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_reconciliation_runs" ADD CONSTRAINT "integration_reconciliation_runs_connection_fkey"
FOREIGN KEY ("connectionId", "organizationId") REFERENCES "integration_connections"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_reconciliation_runs" ADD CONSTRAINT "integration_reconciliation_runs_job_fkey"
FOREIGN KEY ("jobId", "organizationId") REFERENCES "integration_jobs"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_import_staging" ADD CONSTRAINT "integration_import_staging_organization_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_import_staging" ADD CONSTRAINT "integration_import_staging_job_fkey"
FOREIGN KEY ("jobId", "organizationId") REFERENCES "integration_jobs"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'integration_connections',
        'integration_mappings',
        'integration_jobs',
        'integration_exchange_records',
        'integration_reconciliation_runs'
        ,'integration_import_staging'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL USING ("organizationId" = public.medfinet_current_organization_id()) WITH CHECK ("organizationId" = public.medfinet_current_organization_id())',
            table_name || '_tenant_isolation',
            table_name
        );
    END LOOP;
END
$$;
