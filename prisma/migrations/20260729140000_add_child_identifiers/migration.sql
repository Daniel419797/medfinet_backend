CREATE TYPE "ChildIdentifierStatus" AS ENUM ('PENDING', 'VERIFIED', 'REVOKED');

CREATE TABLE "child_identifiers" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "system" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "status" "ChildIdentifierStatus" NOT NULL DEFAULT 'PENDING',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "evidenceReference" TEXT,
  "createdBySubjectId" TEXT NOT NULL,
  "verifiedBySubjectId" TEXT,
  "verifiedAt" TIMESTAMPTZ(3),
  "revokedBySubjectId" TEXT,
  "revokedAt" TIMESTAMPTZ(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "child_identifiers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "child_identifiers_lifecycle_check" CHECK (
    ("status" = 'PENDING' AND "verifiedBySubjectId" IS NULL AND "verifiedAt" IS NULL
      AND "revokedBySubjectId" IS NULL AND "revokedAt" IS NULL AND "revocationReason" IS NULL)
    OR
    ("status" = 'VERIFIED' AND "verifiedBySubjectId" IS NOT NULL AND "verifiedAt" IS NOT NULL
      AND "revokedBySubjectId" IS NULL AND "revokedAt" IS NULL AND "revocationReason" IS NULL)
    OR
    ("status" = 'REVOKED' AND "revokedBySubjectId" IS NOT NULL
      AND "revokedAt" IS NOT NULL AND "revocationReason" IS NOT NULL)
  ),
  CONSTRAINT "child_identifiers_maker_checker_check" CHECK (
    "verifiedBySubjectId" IS NULL OR "verifiedBySubjectId" <> "createdBySubjectId"
  )
);

CREATE UNIQUE INDEX "child_identifiers_id_organizationId_key"
  ON "child_identifiers"("id", "organizationId");
CREATE UNIQUE INDEX "child_identifiers_organizationId_system_value_key"
  ON "child_identifiers"("organizationId", "system", "value");
CREATE INDEX "child_identifiers_organizationId_childId_status_idx"
  ON "child_identifiers"("organizationId", "childId", "status");
CREATE UNIQUE INDEX "child_identifiers_one_verified_primary_child"
  ON "child_identifiers"("organizationId", "childId")
  WHERE "status" = 'VERIFIED' AND "isPrimary" = true;

ALTER TABLE "child_identifiers"
  ADD CONSTRAINT "child_identifiers_childId_organizationId_fkey"
  FOREIGN KEY ("childId", "organizationId")
  REFERENCES "children"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "child_identifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "child_identifiers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "child_identifiers_tenant_isolation" ON "child_identifiers"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

CREATE OR REPLACE FUNCTION prevent_child_identifier_identity_change()
RETURNS trigger AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId"
    OR NEW."childId" <> OLD."childId"
    OR NEW."system" <> OLD."system"
    OR NEW."value" <> OLD."value"
    OR NEW."createdBySubjectId" <> OLD."createdBySubjectId"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'child identifier identity fields are immutable';
  END IF;
  IF OLD."status" = 'REVOKED' THEN
    RAISE EXCEPTION 'revoked child identifiers are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "child_identifiers_identity_immutable"
BEFORE UPDATE ON "child_identifiers"
FOR EACH ROW EXECUTE FUNCTION prevent_child_identifier_identity_change();
