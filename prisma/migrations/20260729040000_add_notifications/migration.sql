CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');
CREATE TYPE "NotificationTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "NotificationMessageStatus" AS ENUM (
    'QUEUED',
    'PROCESSING',
    'SENT',
    'DELIVERED',
    'FAILED',
    'SUPPRESSED'
);
CREATE TYPE "NotificationAttemptStatus" AS ENUM (
    'STARTED',
    'ACCEPTED',
    'DELIVERED',
    'FAILED'
);

CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_preferences_quiet_hours_check" CHECK (
        ("quietHoursStart" IS NULL AND "quietHoursEnd" IS NULL)
        OR (
            "quietHoursStart" BETWEEN 0 AND 23
            AND "quietHoursEnd" BETWEEN 0 AND 23
            AND "quietHoursStart" <> "quietHoursEnd"
        )
    )
);

CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "locale" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variableNames" JSONB NOT NULL,
    "createdBySubjectId" TEXT NOT NULL,
    "activatedBySubjectId" TEXT,
    "activatedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_templates_version_check" CHECK ("version" > 0),
    CONSTRAINT "notification_templates_lifecycle_check" CHECK (
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

CREATE TABLE "notification_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientSubjectId" TEXT NOT NULL,
    "recipientCaregiverId" TEXT,
    "templateId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "renderedSubject" TEXT,
    "renderedBody" TEXT NOT NULL,
    "status" "NotificationMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "suppressedReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "notification_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_messages_lifecycle_check" CHECK (
        ("status" = 'DELIVERED' AND "deliveredAt" IS NOT NULL)
        OR ("status" = 'SENT' AND "sentAt" IS NOT NULL)
        OR ("status" = 'FAILED' AND "failedAt" IS NOT NULL)
        OR ("status" = 'SUPPRESSED' AND "suppressedReason" IS NOT NULL)
        OR "status" IN ('QUEUED', 'PROCESSING')
    )
);

CREATE TABLE "notification_delivery_attempts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "notificationMessageId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "NotificationAttemptStatus" NOT NULL,
    "providerMessageId" TEXT,
    "responseCode" TEXT,
    "failureCode" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    CONSTRAINT "notification_delivery_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_delivery_attempts_number_check" CHECK ("attemptNumber" > 0),
    CONSTRAINT "notification_delivery_attempts_status_check" CHECK (
        ("status" = 'STARTED' AND "completedAt" IS NULL)
        OR ("status" <> 'STARTED' AND "completedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "notification_preferences_subject_key"
ON "notification_preferences"("organizationId", "subjectId", "category", "channel");
CREATE INDEX "notification_preferences_subject_enabled_idx"
ON "notification_preferences"("organizationId", "subjectId", "enabled");
CREATE UNIQUE INDEX "notification_templates_id_organizationId_key"
ON "notification_templates"("id", "organizationId");
CREATE UNIQUE INDEX "notification_templates_version_key"
ON "notification_templates"("organizationId", "key", "version", "locale", "channel");
CREATE UNIQUE INDEX "notification_templates_one_active_key"
ON "notification_templates"("organizationId", "key", "locale", "channel")
WHERE "status" = 'ACTIVE';
CREATE INDEX "notification_templates_lookup_idx"
ON "notification_templates"("organizationId", "key", "locale", "channel", "status");
CREATE UNIQUE INDEX "notification_messages_id_organizationId_key"
ON "notification_messages"("id", "organizationId");
CREATE UNIQUE INDEX "notification_messages_idempotency_key"
ON "notification_messages"("organizationId", "idempotencyKey");
CREATE INDEX "notification_messages_inbox_idx"
ON "notification_messages"("organizationId", "recipientSubjectId", "status", "createdAt");
CREATE INDEX "notification_messages_dispatch_idx"
ON "notification_messages"("organizationId", "status", "scheduledAt");
CREATE UNIQUE INDEX "notification_delivery_attempts_id_organizationId_key"
ON "notification_delivery_attempts"("id", "organizationId");
CREATE UNIQUE INDEX "notification_delivery_attempts_number_key"
ON "notification_delivery_attempts"("notificationMessageId", "attemptNumber");
CREATE INDEX "notification_delivery_attempts_status_idx"
ON "notification_delivery_attempts"("organizationId", "status", "startedAt");
CREATE INDEX "notification_delivery_attempts_provider_idx"
ON "notification_delivery_attempts"("organizationId", "provider", "providerMessageId");

ALTER TABLE "notification_preferences"
ADD CONSTRAINT "notification_preferences_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_templates"
ADD CONSTRAINT "notification_templates_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_messages"
ADD CONSTRAINT "notification_messages_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_messages"
ADD CONSTRAINT "notification_messages_recipientCaregiverId_organizationId_fkey"
FOREIGN KEY ("recipientCaregiverId", "organizationId")
REFERENCES "caregivers"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_messages"
ADD CONSTRAINT "notification_messages_templateId_organizationId_fkey"
FOREIGN KEY ("templateId", "organizationId")
REFERENCES "notification_templates"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_delivery_attempts"
ADD CONSTRAINT "notification_delivery_attempts_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_delivery_attempts"
ADD CONSTRAINT "notification_delivery_attempts_message_tenant_fkey"
FOREIGN KEY ("notificationMessageId", "organizationId")
REFERENCES "notification_messages"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'notification_preferences',
        'notification_templates',
        'notification_messages',
        'notification_delivery_attempts'
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
