CREATE TYPE "ConsentRecipientType" AS ENUM ('ORGANIZATION', 'PROGRAMME', 'PARTNER', 'RESEARCH');
CREATE TYPE "ConsentStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'EXPIRED', 'REVOKED');
CREATE TYPE "ConsentDataCategory" AS ENUM (
    'IDENTITY',
    'DEMOGRAPHICS',
    'CAREGIVER',
    'IMMUNIZATION',
    'NUTRITION',
    'CLINICAL_ALERTS',
    'APPOINTMENTS',
    'EMERGENCY_PROFILE',
    'CLIMATE',
    'SERVICE_DELIVERY',
    'REWARDS'
);
CREATE TYPE "ConsentAccess" AS ENUM ('READ', 'WRITE');
CREATE TYPE "DisclosureDecision" AS ENUM ('ALLOWED', 'DENIED');

ALTER TABLE "caregivers"
    ADD COLUMN "subjectId" TEXT,
    ADD COLUMN "phone" TEXT,
    ADD COLUMN "email" TEXT;

CREATE UNIQUE INDEX "caregivers_organizationId_subjectId_key"
    ON "caregivers"("organizationId", "subjectId");

CREATE TABLE "consent_grants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "grantedByCaregiverId" TEXT NOT NULL,
    "recipientType" "ConsentRecipientType" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "captureMethod" TEXT NOT NULL,
    "evidence" JSONB,
    "status" "ConsentStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),
    "withdrawnBySubjectId" TEXT,
    "withdrawalReason" TEXT,
    "createdBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "consent_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consent_grants_version_check" CHECK ("version" > 0),
    CONSTRAINT "consent_grants_time_check" CHECK (
        "expiresAt" IS NULL OR "expiresAt" > "startsAt"
    ),
    CONSTRAINT "consent_grants_withdrawal_check" CHECK (
        (
            "status" = 'WITHDRAWN'
            AND "withdrawnAt" IS NOT NULL
            AND "withdrawnBySubjectId" IS NOT NULL
            AND "withdrawalReason" IS NOT NULL
        )
        OR "status" <> 'WITHDRAWN'
    )
);

CREATE TABLE "consent_scopes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "consentGrantId" TEXT NOT NULL,
    "category" "ConsentDataCategory" NOT NULL,
    "access" "ConsentAccess" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consent_scopes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "disclosure_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "actorSubjectId" TEXT NOT NULL,
    "recipientType" "ConsentRecipientType" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "requestedScopes" JSONB NOT NULL,
    "decision" "DisclosureDecision" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "consentGrantId" TEXT,
    "emergencyAccessId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "disclosure_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "consent_grants_id_organizationId_key"
    ON "consent_grants"("id", "organizationId");
CREATE INDEX "consent_grants_organizationId_childId_status_idx"
    ON "consent_grants"("organizationId", "childId", "status");
CREATE INDEX "consent_grants_recipient_lookup_idx"
    ON "consent_grants"(
        "organizationId",
        "recipientType",
        "recipientId",
        "purpose",
        "status"
    );
CREATE UNIQUE INDEX "consent_scopes_consentGrantId_category_key"
    ON "consent_scopes"("consentGrantId", "category");
CREATE INDEX "consent_scopes_organizationId_category_access_idx"
    ON "consent_scopes"("organizationId", "category", "access");
CREATE INDEX "disclosure_events_organizationId_childId_createdAt_idx"
    ON "disclosure_events"("organizationId", "childId", "createdAt");
CREATE INDEX "disclosure_events_actor_lookup_idx"
    ON "disclosure_events"("organizationId", "actorSubjectId", "createdAt");
CREATE INDEX "disclosure_events_decision_lookup_idx"
    ON "disclosure_events"("organizationId", "decision", "createdAt");

ALTER TABLE "consent_grants"
    ADD CONSTRAINT "consent_grants_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "consent_grants"
    ADD CONSTRAINT "consent_grants_childId_organizationId_fkey"
    FOREIGN KEY ("childId", "organizationId")
    REFERENCES "children"("id", "organizationId")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "consent_grants"
    ADD CONSTRAINT "consent_grants_grantedByCaregiverId_organizationId_fkey"
    FOREIGN KEY ("grantedByCaregiverId", "organizationId")
    REFERENCES "caregivers"("id", "organizationId")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "consent_scopes"
    ADD CONSTRAINT "consent_scopes_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "consent_scopes"
    ADD CONSTRAINT "consent_scopes_consentGrantId_organizationId_fkey"
    FOREIGN KEY ("consentGrantId", "organizationId")
    REFERENCES "consent_grants"("id", "organizationId")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
ALTER TABLE "disclosure_events"
    ADD CONSTRAINT "disclosure_events_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "disclosure_events"
    ADD CONSTRAINT "disclosure_events_childId_organizationId_fkey"
    FOREIGN KEY ("childId", "organizationId")
    REFERENCES "children"("id", "organizationId")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'consent_grants',
        'consent_scopes',
        'disclosure_events'
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
