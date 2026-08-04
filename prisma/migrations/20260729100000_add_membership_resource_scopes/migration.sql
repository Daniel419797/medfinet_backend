CREATE TYPE "MembershipScopeMode" AS ENUM ('GLOBAL', 'SCOPED');

ALTER TABLE "organization_memberships"
  ADD COLUMN "scopeMode" "MembershipScopeMode" NOT NULL DEFAULT 'GLOBAL';

CREATE UNIQUE INDEX "organization_memberships_id_organizationId_key"
  ON "organization_memberships"("id", "organizationId");

CREATE TABLE "membership_facility_scopes" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "assignedBySubjectId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "membership_facility_scopes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "membership_programme_scopes" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "assignedBySubjectId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "membership_programme_scopes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "membership_facility_scopes_membershipId_facilityId_key"
  ON "membership_facility_scopes"("membershipId", "facilityId");
CREATE INDEX "membership_facility_scopes_organizationId_facilityId_idx"
  ON "membership_facility_scopes"("organizationId", "facilityId");
CREATE UNIQUE INDEX "membership_programme_scopes_membershipId_programmeId_key"
  ON "membership_programme_scopes"("membershipId", "programmeId");
CREATE INDEX "membership_programme_scopes_organizationId_programmeId_idx"
  ON "membership_programme_scopes"("organizationId", "programmeId");

ALTER TABLE "membership_facility_scopes"
  ADD CONSTRAINT "membership_facility_scopes_membershipId_organizationId_fkey"
  FOREIGN KEY ("membershipId", "organizationId")
  REFERENCES "organization_memberships"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_facility_scopes"
  ADD CONSTRAINT "membership_facility_scopes_facilityId_organizationId_fkey"
  FOREIGN KEY ("facilityId", "organizationId")
  REFERENCES "facilities"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_programme_scopes"
  ADD CONSTRAINT "membership_programme_scopes_membershipId_organizationId_fkey"
  FOREIGN KEY ("membershipId", "organizationId")
  REFERENCES "organization_memberships"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_programme_scopes"
  ADD CONSTRAINT "membership_programme_scopes_programmeId_organizationId_fkey"
  FOREIGN KEY ("programmeId", "organizationId")
  REFERENCES "programmes"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "membership_facility_scopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_facility_scopes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "membership_facility_scopes_tenant_isolation"
  ON "membership_facility_scopes"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "membership_programme_scopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_programme_scopes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "membership_programme_scopes_tenant_isolation"
  ON "membership_programme_scopes"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
