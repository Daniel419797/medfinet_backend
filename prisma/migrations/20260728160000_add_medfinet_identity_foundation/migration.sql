CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'HEALTH_WORKER', 'NUTRITION_WORKER', 'EMERGENCY_COORDINATOR', 'AUDITOR');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "ChildSex" AS ENUM ('FEMALE', 'MALE', 'INTERSEX', 'UNKNOWN');
CREATE TYPE "ChildStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DECEASED', 'DUPLICATE');
CREATE TYPE "CaregiverRelationship" AS ENUM ('MOTHER', 'FATHER', 'GUARDIAN', 'RELATIVE', 'OTHER');

CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_memberships" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "facilities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "administrativeArea" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "programmes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "programmes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "programmes_date_order_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" >= "startsAt")
);

CREATE TABLE "caregivers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "preferredLanguage" TEXT,
    "createdBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "caregivers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "children" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "medfinetId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "sex" "ChildSex" NOT NULL,
    "status" "ChildStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "children_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "child_caregivers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "relationship" "CaregiverRelationship" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "hasConsentAuthority" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "child_caregivers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorSubjectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX "organization_memberships_organizationId_subjectId_key" ON "organization_memberships"("organizationId", "subjectId");
CREATE INDEX "organization_memberships_subjectId_status_idx" ON "organization_memberships"("subjectId", "status");
CREATE UNIQUE INDEX "facilities_organizationId_code_key" ON "facilities"("organizationId", "code");
CREATE INDEX "facilities_organizationId_isActive_idx" ON "facilities"("organizationId", "isActive");
CREATE UNIQUE INDEX "programmes_organizationId_code_key" ON "programmes"("organizationId", "code");
CREATE INDEX "programmes_organizationId_isActive_idx" ON "programmes"("organizationId", "isActive");
CREATE INDEX "caregivers_organizationId_lastName_firstName_idx" ON "caregivers"("organizationId", "lastName", "firstName");
CREATE UNIQUE INDEX "caregivers_id_organizationId_key" ON "caregivers"("id", "organizationId");
CREATE UNIQUE INDEX "children_medfinetId_key" ON "children"("medfinetId");
CREATE INDEX "children_organizationId_lastName_firstName_idx" ON "children"("organizationId", "lastName", "firstName");
CREATE INDEX "children_organizationId_dateOfBirth_idx" ON "children"("organizationId", "dateOfBirth");
CREATE UNIQUE INDEX "children_id_organizationId_key" ON "children"("id", "organizationId");
CREATE UNIQUE INDEX "child_caregivers_childId_caregiverId_key" ON "child_caregivers"("childId", "caregiverId");
CREATE INDEX "child_caregivers_organizationId_childId_idx" ON "child_caregivers"("organizationId", "childId");
CREATE INDEX "child_caregivers_organizationId_caregiverId_idx" ON "child_caregivers"("organizationId", "caregiverId");
CREATE INDEX "audit_events_organizationId_createdAt_idx" ON "audit_events"("organizationId", "createdAt");
CREATE INDEX "audit_events_organizationId_entityType_entityId_idx" ON "audit_events"("organizationId", "entityType", "entityId");
CREATE INDEX "audit_events_actorSubjectId_createdAt_idx" ON "audit_events"("actorSubjectId", "createdAt");

ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "caregivers" ADD CONSTRAINT "caregivers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "children" ADD CONSTRAINT "children_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "child_caregivers" ADD CONSTRAINT "child_caregivers_childId_organizationId_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "child_caregivers" ADD CONSTRAINT "child_caregivers_caregiverId_organizationId_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION medfinet_current_organization_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')
$$;

ALTER TABLE "facilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "facilities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "facilities_tenant_isolation" ON "facilities" FOR ALL USING ("organizationId" = public.medfinet_current_organization_id()) WITH CHECK ("organizationId" = public.medfinet_current_organization_id());

ALTER TABLE "programmes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programmes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "programmes_tenant_isolation" ON "programmes" FOR ALL USING ("organizationId" = public.medfinet_current_organization_id()) WITH CHECK ("organizationId" = public.medfinet_current_organization_id());

ALTER TABLE "caregivers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "caregivers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "caregivers_tenant_isolation" ON "caregivers" FOR ALL USING ("organizationId" = public.medfinet_current_organization_id()) WITH CHECK ("organizationId" = public.medfinet_current_organization_id());

ALTER TABLE "children" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "children" FORCE ROW LEVEL SECURITY;
CREATE POLICY "children_tenant_isolation" ON "children" FOR ALL USING ("organizationId" = public.medfinet_current_organization_id()) WITH CHECK ("organizationId" = public.medfinet_current_organization_id());

ALTER TABLE "child_caregivers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "child_caregivers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "child_caregivers_tenant_isolation" ON "child_caregivers" FOR ALL USING ("organizationId" = public.medfinet_current_organization_id()) WITH CHECK ("organizationId" = public.medfinet_current_organization_id());

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_events_tenant_isolation" ON "audit_events" FOR ALL USING ("organizationId" = public.medfinet_current_organization_id()) WITH CHECK ("organizationId" = public.medfinet_current_organization_id());
