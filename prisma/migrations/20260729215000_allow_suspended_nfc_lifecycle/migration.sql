ALTER TABLE "nfc_credential_bindings"
  DROP CONSTRAINT "nfc_bindings_lifecycle_check";

ALTER TABLE "nfc_credential_bindings"
  ADD CONSTRAINT "nfc_bindings_lifecycle_check" CHECK (
    ("status" = 'PENDING' AND "activatedAt" IS NULL)
    OR
    ("status" IN ('ACTIVE', 'SUSPENDED') AND "uidHash" IS NOT NULL
      AND "activatedAt" IS NOT NULL AND "activatedBySubjectId" IS NOT NULL
      AND "writeProtectedAt" IS NOT NULL AND "configurationLockedAt" IS NOT NULL)
    OR
    ("status" = 'FAILED' AND "failedAt" IS NOT NULL AND "failureReason" IS NOT NULL)
    OR
    ("status" = 'REVOKED' AND "uidHash" IS NOT NULL)
  );
