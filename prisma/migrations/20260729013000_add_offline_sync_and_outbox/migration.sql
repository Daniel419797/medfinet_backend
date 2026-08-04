CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED', 'LOST');
CREATE TYPE "SyncBatchStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "SyncOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'APPLIED', 'CONFLICT', 'REJECTED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER');

CREATE TABLE "field_devices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "deviceIdentifierHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "publicKey" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "registeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedBySubjectId" TEXT,
    "revocationReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "field_devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "field_devices_revocation_check" CHECK (
        (
            "status" IN ('REVOKED', 'LOST')
            AND "revokedAt" IS NOT NULL
            AND "revokedBySubjectId" IS NOT NULL
            AND "revocationReason" IS NOT NULL
        )
        OR "status" = 'ACTIVE'
    )
);

CREATE TABLE "sync_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "clientBatchId" TEXT NOT NULL,
    "status" "SyncBatchStatus" NOT NULL DEFAULT 'PENDING',
    "operationCount" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "sync_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sync_batches_operation_count_check" CHECK (
        "operationCount" BETWEEN 1 AND 100
    ),
    CONSTRAINT "sync_batches_processing_check" CHECK (
        ("status" = 'PENDING' AND "processingAt" IS NULL)
        OR ("status" <> 'PENDING' AND "processingAt" IS NOT NULL)
    ),
    CONSTRAINT "sync_batches_completion_check" CHECK (
        (
            "status" IN ('COMPLETED', 'PARTIAL', 'FAILED')
            AND "completedAt" IS NOT NULL
        )
        OR "status" IN ('PENDING', 'PROCESSING')
    )
);

CREATE TABLE "sync_operations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "syncBatchId" TEXT NOT NULL,
    "clientOperationId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "entityId" TEXT,
    "baseVersion" INTEGER,
    "payload" JSONB NOT NULL,
    "status" "SyncOperationStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sync_operations_base_version_check" CHECK (
        "baseVersion" IS NULL OR "baseVersion" >= 0
    ),
    CONSTRAINT "sync_operations_result_check" CHECK (
        (
            "status" = 'APPLIED'
            AND "result" IS NOT NULL
            AND "errorCode" IS NULL
            AND "errorMessage" IS NULL
            AND "processedAt" IS NOT NULL
        )
        OR (
            "status" IN ('CONFLICT', 'REJECTED')
            AND "errorCode" IS NOT NULL
            AND "errorMessage" IS NOT NULL
            AND "processedAt" IS NOT NULL
        )
        OR "status" IN ('PENDING', 'PROCESSING')
    )
);

CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "outbox_events_lock_check" CHECK (
        (
            "status" = 'PROCESSING'
            AND "lockedAt" IS NOT NULL
            AND "lockedBy" IS NOT NULL
        )
        OR "status" <> 'PROCESSING'
    ),
    CONSTRAINT "outbox_events_publication_check" CHECK (
        ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL)
        OR "status" <> 'PUBLISHED'
    )
);

CREATE UNIQUE INDEX "field_devices_id_organizationId_key"
    ON "field_devices"("id", "organizationId");
CREATE UNIQUE INDEX "field_devices_organizationId_deviceIdentifierHash_key"
    ON "field_devices"("organizationId", "deviceIdentifierHash");
CREATE INDEX "field_devices_subject_status_idx"
    ON "field_devices"("organizationId", "subjectId", "status");
CREATE UNIQUE INDEX "sync_batches_id_organizationId_key"
    ON "sync_batches"("id", "organizationId");
CREATE UNIQUE INDEX "sync_batches_deviceId_clientBatchId_key"
    ON "sync_batches"("deviceId", "clientBatchId");
CREATE INDEX "sync_batches_status_acceptedAt_idx"
    ON "sync_batches"("organizationId", "status", "acceptedAt");
CREATE UNIQUE INDEX "sync_operations_id_organizationId_key"
    ON "sync_operations"("id", "organizationId");
CREATE UNIQUE INDEX "sync_operations_deviceId_clientOperationId_key"
    ON "sync_operations"("deviceId", "clientOperationId");
CREATE INDEX "sync_operations_batch_status_idx"
    ON "sync_operations"("organizationId", "syncBatchId", "status");
CREATE INDEX "sync_operations_status_createdAt_idx"
    ON "sync_operations"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "outbox_events_idempotency_key"
    ON "outbox_events"("organizationId", "idempotencyKey");
CREATE INDEX "outbox_events_status_nextAttemptAt_idx"
    ON "outbox_events"("status", "nextAttemptAt");
CREATE INDEX "outbox_events_aggregate_idx"
    ON "outbox_events"("organizationId", "aggregateType", "aggregateId");

ALTER TABLE "field_devices" ADD CONSTRAINT "field_devices_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_deviceId_organizationId_fkey"
    FOREIGN KEY ("deviceId", "organizationId") REFERENCES "field_devices"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_deviceId_organizationId_fkey"
    FOREIGN KEY ("deviceId", "organizationId") REFERENCES "field_devices"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_syncBatchId_organizationId_fkey"
    FOREIGN KEY ("syncBatchId", "organizationId") REFERENCES "sync_batches"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'field_devices',
        'sync_batches',
        'sync_operations',
        'outbox_events'
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
