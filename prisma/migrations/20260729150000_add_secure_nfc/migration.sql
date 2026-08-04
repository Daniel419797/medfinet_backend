CREATE TYPE "NfcBindingStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'REVOKED');
CREATE TYPE "NfcChallengeStatus" AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED');

CREATE TABLE "nfc_credential_bindings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "hardwareFamily" TEXT NOT NULL DEFAULT 'NTAG_215',
  "status" "NfcBindingStatus" NOT NULL DEFAULT 'PENDING',
  "uidHash" TEXT,
  "personalizationNonceHash" TEXT NOT NULL,
  "provisioningExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "lastCounter" INTEGER NOT NULL DEFAULT -1,
  "originalitySignatureHash" TEXT,
  "originalityVerifiedAt" TIMESTAMPTZ(3),
  "preparedAt" TIMESTAMPTZ(3),
  "preparedBySubjectId" TEXT,
  "writeProtectedAt" TIMESTAMPTZ(3),
  "configurationLockedAt" TIMESTAMPTZ(3),
  "activatedAt" TIMESTAMPTZ(3),
  "activatedBySubjectId" TEXT,
  "failedAt" TIMESTAMPTZ(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "nfc_credential_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nfc_bindings_counter_check" CHECK ("lastCounter" BETWEEN -1 AND 16777215),
  CONSTRAINT "nfc_bindings_hardware_check" CHECK ("hardwareFamily" = 'NTAG_215'),
  CONSTRAINT "nfc_bindings_lifecycle_check" CHECK (
    ("status" = 'PENDING' AND "activatedAt" IS NULL)
    OR
    ("status" = 'ACTIVE' AND "uidHash" IS NOT NULL AND "activatedAt" IS NOT NULL
      AND "activatedBySubjectId" IS NOT NULL AND "writeProtectedAt" IS NOT NULL
      AND "configurationLockedAt" IS NOT NULL)
    OR
    ("status" = 'FAILED' AND "failedAt" IS NOT NULL AND "failureReason" IS NOT NULL)
    OR
    ("status" = 'REVOKED' AND "uidHash" IS NOT NULL)
  )
);

CREATE TABLE "nfc_public_routes" (
  "publicId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nfc_public_routes_pkey" PRIMARY KEY ("publicId")
);

CREATE TABLE "nfc_scan_challenges" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "actorSubjectId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "NfcChallengeStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "nfc_scan_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nfc_scan_challenges_lifecycle_check" CHECK (
    ("status" = 'PENDING' AND "consumedAt" IS NULL)
    OR ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "consumedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "nfc_bindings_id_organizationId_key"
  ON "nfc_credential_bindings"("id", "organizationId");
CREATE UNIQUE INDEX "nfc_bindings_credentialId_organizationId_key"
  ON "nfc_credential_bindings"("credentialId", "organizationId");
CREATE UNIQUE INDEX "nfc_bindings_publicId_key"
  ON "nfc_credential_bindings"("publicId");
CREATE UNIQUE INDEX "nfc_bindings_organizationId_uidHash_key"
  ON "nfc_credential_bindings"("organizationId", "uidHash");
CREATE INDEX "nfc_bindings_organizationId_status_createdAt_idx"
  ON "nfc_credential_bindings"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "nfc_public_routes_bindingId_key"
  ON "nfc_public_routes"("bindingId");
CREATE UNIQUE INDEX "nfc_scan_challenges_id_organizationId_key"
  ON "nfc_scan_challenges"("id", "organizationId");
CREATE UNIQUE INDEX "nfc_scan_challenges_tokenHash_key"
  ON "nfc_scan_challenges"("tokenHash");
CREATE INDEX "nfc_scan_challenges_organizationId_status_expiresAt_idx"
  ON "nfc_scan_challenges"("organizationId", "status", "expiresAt");

ALTER TABLE "nfc_credential_bindings"
  ADD CONSTRAINT "nfc_bindings_credentialId_organizationId_fkey"
  FOREIGN KEY ("credentialId", "organizationId")
  REFERENCES "child_credentials"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nfc_scan_challenges"
  ADD CONSTRAINT "nfc_scan_challenges_bindingId_organizationId_fkey"
  FOREIGN KEY ("bindingId", "organizationId")
  REFERENCES "nfc_credential_bindings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "nfc_credential_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nfc_credential_bindings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "nfc_bindings_tenant_isolation" ON "nfc_credential_bindings"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "nfc_scan_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nfc_scan_challenges" FORCE ROW LEVEL SECURITY;
CREATE POLICY "nfc_scan_challenges_tenant_isolation" ON "nfc_scan_challenges"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

REVOKE ALL ON TABLE "nfc_public_routes" FROM PUBLIC;

CREATE OR REPLACE FUNCTION prevent_nfc_binding_identity_change()
RETURNS trigger AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId"
    OR NEW."credentialId" <> OLD."credentialId"
    OR NEW."publicId" <> OLD."publicId"
    OR NEW."hardwareFamily" <> OLD."hardwareFamily"
    OR NEW."personalizationNonceHash" <> OLD."personalizationNonceHash"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'NFC binding identity fields are immutable';
  END IF;
  IF OLD."status" = 'REVOKED' THEN
    RAISE EXCEPTION 'revoked NFC bindings are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "nfc_bindings_identity_immutable"
BEFORE UPDATE ON "nfc_credential_bindings"
FOR EACH ROW EXECUTE FUNCTION prevent_nfc_binding_identity_change();
