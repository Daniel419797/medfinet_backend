CREATE TABLE "certificate_nft_receipts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "immunizationId" TEXT NOT NULL,
  "proofId" TEXT NOT NULL,
  "fingerprintVersion" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "assetId" BIGINT,
  "txId" TEXT NOT NULL,
  "blockHeight" BIGINT,
  "creatorAddress" TEXT NOT NULL,
  "signedTransaction" TEXT,
  "confirmedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "certificate_nft_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "certificate_nft_receipts_network_check"
    CHECK ("network" IN ('testnet', 'mainnet')),
  CONSTRAINT "certificate_nft_receipts_status_check"
    CHECK ("status" IN ('PENDING', 'CONFIRMED')),
  CONSTRAINT "certificate_nft_receipts_fingerprint_check"
    CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "certificate_nft_receipts_asset_id_check"
    CHECK ("assetId" IS NULL OR "assetId" > 0),
  CONSTRAINT "certificate_nft_receipts_block_height_check"
    CHECK ("blockHeight" IS NULL OR "blockHeight" > 0),
  CONSTRAINT "certificate_nft_receipts_fingerprint_version_check"
    CHECK ("fingerprintVersion" > 0),
  CONSTRAINT "certificate_nft_receipts_confirmed_shape_check"
    CHECK (
      "status" <> 'CONFIRMED'
      OR (
        "assetId" IS NOT NULL
        AND "blockHeight" IS NOT NULL
        AND "confirmedAt" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "certificate_nft_receipts_organizationId_proofId_key"
  ON "certificate_nft_receipts"("organizationId", "proofId");
CREATE UNIQUE INDEX "certificate_nft_receipts_network_assetId_key"
  ON "certificate_nft_receipts"("network", "assetId")
  WHERE "assetId" IS NOT NULL;
CREATE UNIQUE INDEX "certificate_nft_receipts_txId_key"
  ON "certificate_nft_receipts"("txId");
CREATE INDEX "certificate_nft_receipts_organizationId_immunizationId_createdAt_idx"
  ON "certificate_nft_receipts"("organizationId", "immunizationId", "createdAt");

ALTER TABLE "certificate_nft_receipts"
  ADD CONSTRAINT "certificate_nft_receipts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "certificate_nft_receipts"
  ADD CONSTRAINT "certificate_nft_receipts_immunizationId_organizationId_fkey"
  FOREIGN KEY ("immunizationId", "organizationId")
  REFERENCES "immunization_records"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "certificate_nft_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certificate_nft_receipts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "certificate_nft_receipts_tenant_isolation"
  ON "certificate_nft_receipts"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
  );
