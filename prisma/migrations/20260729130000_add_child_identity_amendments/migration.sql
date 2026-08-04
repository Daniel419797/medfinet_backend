CREATE TYPE "IdentityAmendmentStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

CREATE TABLE "child_identity_amendments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  "status" "IdentityAmendmentStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "proposedData" JSONB NOT NULL,
  "previousData" JSONB,
  "requestedBySubjectId" TEXT NOT NULL,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedBySubjectId" TEXT,
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewReason" TEXT,
  "appliedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "child_identity_amendments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "child_identity_amendments_lifecycle_check" CHECK (
    (
      "status" = 'PENDING'
      AND "previousData" IS NULL
      AND "reviewedBySubjectId" IS NULL
      AND "reviewedAt" IS NULL
      AND "reviewReason" IS NULL
      AND "appliedAt" IS NULL
    )
    OR (
      "status" = 'REJECTED'
      AND "previousData" IS NULL
      AND "reviewedBySubjectId" IS NOT NULL
      AND "reviewedAt" IS NOT NULL
      AND "reviewReason" IS NOT NULL
      AND "appliedAt" IS NULL
    )
    OR (
      "status" = 'APPLIED'
      AND "previousData" IS NOT NULL
      AND "reviewedBySubjectId" IS NOT NULL
      AND "reviewedAt" IS NOT NULL
      AND "reviewReason" IS NOT NULL
      AND "appliedAt" IS NOT NULL
    )
  ),
  CONSTRAINT "child_identity_amendments_maker_checker_check"
    CHECK ("reviewedBySubjectId" IS NULL OR "reviewedBySubjectId" <> "requestedBySubjectId")
);

CREATE UNIQUE INDEX "child_identity_amendments_id_organizationId_key"
  ON "child_identity_amendments"("id", "organizationId");
CREATE INDEX "child_identity_amendments_organizationId_childId_status_requestedAt_idx"
  ON "child_identity_amendments"("organizationId", "childId", "status", "requestedAt");
CREATE UNIQUE INDEX "child_identity_amendments_one_pending_child"
  ON "child_identity_amendments"("organizationId", "childId")
  WHERE "status" = 'PENDING';

ALTER TABLE "child_identity_amendments"
  ADD CONSTRAINT "child_identity_amendments_childId_organizationId_fkey"
  FOREIGN KEY ("childId", "organizationId")
  REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "child_identity_amendments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "child_identity_amendments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "child_identity_amendments_tenant_isolation"
  ON "child_identity_amendments"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

CREATE OR REPLACE FUNCTION prevent_terminal_identity_amendment_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" IN ('APPLIED', 'REJECTED') THEN
    RAISE EXCEPTION 'terminal identity amendments are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'identity amendments cannot be deleted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "child_identity_amendments_terminal_immutable"
BEFORE UPDATE OR DELETE ON "child_identity_amendments"
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_identity_amendment_mutation();
