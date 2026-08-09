ALTER TABLE "nfc_credential_bindings"
  DROP CONSTRAINT "nfc_bindings_hardware_check";

ALTER TABLE "nfc_credential_bindings"
  ADD CONSTRAINT "nfc_bindings_hardware_check" CHECK (
    "hardwareFamily" IN ('NTAG_215', 'NTAG_215_TAGWRITER_DEMO')
  );

ALTER TABLE "nfc_credential_bindings"
  DROP CONSTRAINT "nfc_bindings_lifecycle_check";

ALTER TABLE "nfc_credential_bindings"
  ADD CONSTRAINT "nfc_bindings_lifecycle_check" CHECK (
    (
      "status" = 'PENDING'
      AND "hardwareFamily" = 'NTAG_215'
      AND "activatedAt" IS NULL
    )
    OR
    (
      "status" IN ('ACTIVE', 'SUSPENDED')
      AND "activatedAt" IS NOT NULL
      AND "activatedBySubjectId" IS NOT NULL
      AND (
        (
          "hardwareFamily" = 'NTAG_215'
          AND "uidHash" IS NOT NULL
          AND "writeProtectedAt" IS NOT NULL
          AND "configurationLockedAt" IS NOT NULL
        )
        OR
        (
          "hardwareFamily" = 'NTAG_215_TAGWRITER_DEMO'
          AND "uidHash" IS NULL
          AND "lastCounter" = -1
          AND "originalitySignatureHash" IS NULL
          AND "originalityVerifiedAt" IS NULL
          AND "preparedAt" IS NULL
          AND "preparedBySubjectId" IS NULL
          AND "writeProtectedAt" IS NULL
          AND "configurationLockedAt" IS NULL
        )
      )
    )
    OR
    (
      "status" = 'FAILED'
      AND "failedAt" IS NOT NULL
      AND "failureReason" IS NOT NULL
    )
    OR
    (
      "status" = 'REVOKED'
      AND (
        ("hardwareFamily" = 'NTAG_215' AND "uidHash" IS NOT NULL)
        OR
        ("hardwareFamily" = 'NTAG_215_TAGWRITER_DEMO' AND "uidHash" IS NULL)
      )
    )
  );
