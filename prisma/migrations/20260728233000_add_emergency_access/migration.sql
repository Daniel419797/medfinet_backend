CREATE TYPE "EmergencyAccessStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');
CREATE TYPE "EmergencyReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'FLAGGED');

CREATE TABLE "emergency_accesses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "actorSubjectId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "status" "EmergencyAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "reviewStatus" "EmergencyReviewStatus" NOT NULL DEFAULT 'PENDING',
    "stepUpAuthenticatedAt" TIMESTAMPTZ(3) NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedBySubjectId" TEXT,
    "reviewerSubjectId" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "emergency_accesses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "emergency_accesses_time_check" CHECK ("expiresAt" > "activatedAt"),
    CONSTRAINT "emergency_accesses_revocation_check" CHECK (
        (
            "status" = 'REVOKED'
            AND "revokedAt" IS NOT NULL
            AND "revokedBySubjectId" IS NOT NULL
        )
        OR "status" <> 'REVOKED'
    ),
    CONSTRAINT "emergency_accesses_review_check" CHECK (
        (
            "reviewStatus" <> 'PENDING'
            AND "reviewedAt" IS NOT NULL
            AND "reviewerSubjectId" IS NOT NULL
            AND "reviewNotes" IS NOT NULL
        )
        OR "reviewStatus" = 'PENDING'
    )
);

CREATE UNIQUE INDEX "emergency_accesses_id_organizationId_key"
    ON "emergency_accesses"("id", "organizationId");
CREATE UNIQUE INDEX "emergency_accesses_one_active_actor_child_key"
    ON "emergency_accesses"("organizationId", "childId", "actorSubjectId")
    WHERE "status" = 'ACTIVE';
CREATE INDEX "emergency_accesses_child_lookup_idx"
    ON "emergency_accesses"("organizationId", "childId", "status", "expiresAt");
CREATE INDEX "emergency_accesses_actor_lookup_idx"
    ON "emergency_accesses"("organizationId", "actorSubjectId", "status", "expiresAt");
CREATE INDEX "emergency_accesses_review_lookup_idx"
    ON "emergency_accesses"("organizationId", "reviewStatus", "createdAt");

ALTER TABLE "emergency_accesses"
    ADD CONSTRAINT "emergency_accesses_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "emergency_accesses"
    ADD CONSTRAINT "emergency_accesses_childId_organizationId_fkey"
    FOREIGN KEY ("childId", "organizationId")
    REFERENCES "children"("id", "organizationId")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "emergency_accesses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "emergency_accesses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "emergency_accesses_tenant_isolation"
    ON "emergency_accesses"
    FOR ALL
    USING ("organizationId" = public.medfinet_current_organization_id())
    WITH CHECK ("organizationId" = public.medfinet_current_organization_id());
