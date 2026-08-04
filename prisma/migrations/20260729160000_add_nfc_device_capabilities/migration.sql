ALTER TABLE "field_devices"
  ADD COLUMN "nfcProvisioningEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nfcProvisioningApprovedAt" TIMESTAMPTZ(3),
  ADD COLUMN "nfcProvisioningApprovedBySubjectId" TEXT;

ALTER TABLE "field_devices"
  ADD CONSTRAINT "field_devices_nfc_provisioning_approval_check" CHECK (
    ("nfcProvisioningEnabled" = false)
    OR (
      "nfcProvisioningApprovedAt" IS NOT NULL
      AND "nfcProvisioningApprovedBySubjectId" IS NOT NULL
      AND "publicKey" IS NOT NULL
    )
  );
