CREATE TYPE "VulnerabilityLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "ClimateEventStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED');
CREATE TYPE "WorklistStatus" AS ENUM ('DRAFT', 'AUTHORIZED', 'ACTIVE', 'CLOSED', 'CANCELLED');
CREATE TYPE "EligibilityStatus" AS ENUM ('ELIGIBLE', 'INELIGIBLE', 'REVIEW_REQUIRED');
CREATE TYPE "WorklistEntryStatus" AS ENUM ('PENDING', 'CONTACTED', 'SERVED', 'REFERRED', 'UNREACHABLE');
CREATE TYPE "ReferralStatus" AS ENUM ('OPEN', 'ACCEPTED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "climate_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "administrativeAreaCode" TEXT NOT NULL,
    "vulnerability" "VulnerabilityLevel" NOT NULL,
    "displaced" BOOLEAN NOT NULL DEFAULT false,
    "shelterCode" TEXT,
    "hazardExposure" JSONB,
    "assessedAt" TIMESTAMPTZ(3) NOT NULL,
    "assessedBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "climate_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "climate_profiles_shelter_check" CHECK (
        "displaced" OR "shelterCode" IS NULL
    )
);

CREATE TABLE "climate_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "ClimateEventStatus" NOT NULL DEFAULT 'DRAFT',
    "severity" "VulnerabilityLevel" NOT NULL,
    "source" TEXT NOT NULL,
    "externalReference" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3),
    "createdBySubjectId" TEXT NOT NULL,
    "activatedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "climate_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "climate_events_time_check" CHECK (
        "endsAt" IS NULL OR "endsAt" >= "startsAt"
    ),
    CONSTRAINT "climate_events_activation_check" CHECK (
        ("status" IN ('ACTIVE', 'CLOSED') AND "activatedAt" IS NOT NULL)
        OR "status" NOT IN ('ACTIVE', 'CLOSED')
    ),
    CONSTRAINT "climate_events_closed_check" CHECK (
        ("status" = 'CLOSED' AND "closedAt" IS NOT NULL)
        OR "status" <> 'CLOSED'
    )
);

CREATE TABLE "affected_areas" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "climateEventId" TEXT NOT NULL,
    "administrativeAreaCode" TEXT NOT NULL,
    "administrativeAreaName" TEXT NOT NULL,
    "severity" "VulnerabilityLevel" NOT NULL,
    "affectedFrom" TIMESTAMPTZ(3) NOT NULL,
    "affectedUntil" TIMESTAMPTZ(3),
    "sourceEvidence" JSONB,
    "createdBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "affected_areas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "affected_areas_time_check" CHECK (
        "affectedUntil" IS NULL OR "affectedUntil" >= "affectedFrom"
    )
);

CREATE TABLE "beneficiary_worklists" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "climateEventId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "WorklistStatus" NOT NULL DEFAULT 'DRAFT',
    "authorizationBasis" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "generationComplete" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMPTZ(3),
    "createdBySubjectId" TEXT NOT NULL,
    "authorizedBySubjectId" TEXT,
    "authorizedAt" TIMESTAMPTZ(3),
    "closedBySubjectId" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "beneficiary_worklists_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "beneficiary_worklists_generation_check" CHECK (
        NOT "generationComplete" OR "generatedAt" IS NOT NULL
    ),
    CONSTRAINT "beneficiary_worklists_authorization_check" CHECK (
        (
            "status" IN ('AUTHORIZED', 'ACTIVE', 'CLOSED')
            AND "generationComplete"
            AND "authorizedBySubjectId" IS NOT NULL
            AND "authorizedAt" IS NOT NULL
        )
        OR "status" NOT IN ('AUTHORIZED', 'ACTIVE', 'CLOSED')
    ),
    CONSTRAINT "beneficiary_worklists_closed_check" CHECK (
        (
            "status" = 'CLOSED'
            AND "closedBySubjectId" IS NOT NULL
            AND "closedAt" IS NOT NULL
        )
        OR "status" <> 'CLOSED'
    )
);

CREATE TABLE "worklist_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "worklistId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "eligibility" "EligibilityStatus" NOT NULL,
    "eligibilityReason" TEXT NOT NULL,
    "priority" "VulnerabilityLevel" NOT NULL,
    "status" "WorklistEntryStatus" NOT NULL DEFAULT 'PENDING',
    "assignedSubjectId" TEXT,
    "contactedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "worklist_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "worklist_entries_completion_check" CHECK (
        (
            "status" IN ('SERVED', 'REFERRED', 'UNREACHABLE')
            AND "completedAt" IS NOT NULL
        )
        OR "status" NOT IN ('SERVED', 'REFERRED', 'UNREACHABLE')
    )
);

CREATE TABLE "service_deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "worklistEntryId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "deliveredAt" TIMESTAMPTZ(3) NOT NULL,
    "deliveredBySubjectId" TEXT NOT NULL,
    "notes" TEXT,
    "sourceOperationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_deliveries_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "worklistEntryId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "referralType" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "priority" "VulnerabilityLevel" NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "openedBySubjectId" TEXT NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedBySubjectId" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "closureNotes" TEXT,
    "sourceOperationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "referrals_closure_check" CHECK (
        (
            "status" IN ('COMPLETED', 'CANCELLED')
            AND "closedBySubjectId" IS NOT NULL
            AND "closedAt" IS NOT NULL
            AND "closureNotes" IS NOT NULL
        )
        OR "status" NOT IN ('COMPLETED', 'CANCELLED')
    )
);

CREATE UNIQUE INDEX "climate_profiles_childId_organizationId_key"
    ON "climate_profiles"("childId", "organizationId");
CREATE INDEX "climate_profiles_area_vulnerability_idx"
    ON "climate_profiles"("organizationId", "administrativeAreaCode", "vulnerability");
CREATE INDEX "climate_profiles_displaced_updatedAt_idx"
    ON "climate_profiles"("organizationId", "displaced", "updatedAt");
CREATE UNIQUE INDEX "climate_events_id_organizationId_key"
    ON "climate_events"("id", "organizationId");
CREATE UNIQUE INDEX "climate_events_source_externalReference_key"
    ON "climate_events"("organizationId", "source", "externalReference");
CREATE INDEX "climate_events_status_startsAt_idx"
    ON "climate_events"("organizationId", "status", "startsAt");
CREATE UNIQUE INDEX "affected_areas_event_area_key"
    ON "affected_areas"("climateEventId", "administrativeAreaCode");
CREATE INDEX "affected_areas_area_affectedFrom_idx"
    ON "affected_areas"("organizationId", "administrativeAreaCode", "affectedFrom");
CREATE UNIQUE INDEX "beneficiary_worklists_id_organizationId_key"
    ON "beneficiary_worklists"("id", "organizationId");
CREATE INDEX "beneficiary_worklists_event_status_idx"
    ON "beneficiary_worklists"("organizationId", "climateEventId", "status");
CREATE INDEX "beneficiary_worklists_programme_status_idx"
    ON "beneficiary_worklists"("organizationId", "programmeId", "status");
CREATE UNIQUE INDEX "worklist_entries_id_organizationId_key"
    ON "worklist_entries"("id", "organizationId");
CREATE UNIQUE INDEX "worklist_entries_worklistId_childId_key"
    ON "worklist_entries"("worklistId", "childId");
CREATE INDEX "worklist_entries_worklist_status_priority_idx"
    ON "worklist_entries"("organizationId", "worklistId", "status", "priority");
CREATE INDEX "worklist_entries_child_createdAt_idx"
    ON "worklist_entries"("organizationId", "childId", "createdAt");
CREATE UNIQUE INDEX "service_deliveries_source_operation_key"
    ON "service_deliveries"("organizationId", "sourceOperationId");
CREATE INDEX "service_deliveries_child_deliveredAt_idx"
    ON "service_deliveries"("organizationId", "childId", "deliveredAt");
CREATE INDEX "service_deliveries_category_deliveredAt_idx"
    ON "service_deliveries"("organizationId", "category", "deliveredAt");
CREATE UNIQUE INDEX "referrals_id_organizationId_key"
    ON "referrals"("id", "organizationId");
CREATE UNIQUE INDEX "referrals_source_operation_key"
    ON "referrals"("organizationId", "sourceOperationId");
CREATE INDEX "referrals_child_status_idx"
    ON "referrals"("organizationId", "childId", "status");
CREATE INDEX "referrals_destination_status_idx"
    ON "referrals"("organizationId", "destination", "status");

ALTER TABLE "climate_profiles" ADD CONSTRAINT "climate_profiles_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "climate_profiles" ADD CONSTRAINT "climate_profiles_childId_organizationId_fkey"
    FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "climate_events" ADD CONSTRAINT "climate_events_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "affected_areas" ADD CONSTRAINT "affected_areas_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "affected_areas" ADD CONSTRAINT "affected_areas_climateEventId_organizationId_fkey"
    FOREIGN KEY ("climateEventId", "organizationId") REFERENCES "climate_events"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "beneficiary_worklists" ADD CONSTRAINT "beneficiary_worklists_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "beneficiary_worklists" ADD CONSTRAINT "beneficiary_worklists_climateEventId_organizationId_fkey"
    FOREIGN KEY ("climateEventId", "organizationId") REFERENCES "climate_events"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "beneficiary_worklists" ADD CONSTRAINT "beneficiary_worklists_programmeId_organizationId_fkey"
    FOREIGN KEY ("programmeId", "organizationId") REFERENCES "programmes"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worklist_entries" ADD CONSTRAINT "worklist_entries_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worklist_entries" ADD CONSTRAINT "worklist_entries_worklistId_organizationId_fkey"
    FOREIGN KEY ("worklistId", "organizationId") REFERENCES "beneficiary_worklists"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worklist_entries" ADD CONSTRAINT "worklist_entries_childId_organizationId_fkey"
    FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_deliveries" ADD CONSTRAINT "service_deliveries_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_deliveries" ADD CONSTRAINT "service_deliveries_worklistEntryId_organizationId_fkey"
    FOREIGN KEY ("worklistEntryId", "organizationId") REFERENCES "worklist_entries"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_deliveries" ADD CONSTRAINT "service_deliveries_childId_organizationId_fkey"
    FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_worklistEntryId_organizationId_fkey"
    FOREIGN KEY ("worklistEntryId", "organizationId") REFERENCES "worklist_entries"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_childId_organizationId_fkey"
    FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'climate_profiles',
        'climate_events',
        'affected_areas',
        'beneficiary_worklists',
        'worklist_entries',
        'service_deliveries',
        'referrals'
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
