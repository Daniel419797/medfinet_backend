CREATE TABLE "anchor_receipts" (
  "anchorId" TEXT NOT NULL,
  "eventCode" INTEGER NOT NULL,
  "eventCategory" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "txId" TEXT NOT NULL,
  "blockHeight" BIGINT NOT NULL,
  "isoTimestamp" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "hashHex" TEXT NOT NULL,
  "confirmations" INTEGER NOT NULL,
  "submittedAt" TIMESTAMPTZ(3) NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3),
  "status" TEXT NOT NULL DEFAULT 'pending',

  CONSTRAINT "anchor_receipts_pkey" PRIMARY KEY ("anchorId")
);

CREATE TABLE "blockchain_dead_letters" (
  "id" TEXT NOT NULL,
  "originalPayload" JSONB NOT NULL,
  "error" TEXT NOT NULL,
  "retryCount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  "resolvedBy" TEXT,

  CONSTRAINT "blockchain_dead_letters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "anchor_receipts_txId_key" ON "anchor_receipts"("txId");
CREATE INDEX "anchor_receipts_tenantId_status_idx" ON "anchor_receipts"("tenantId", "status");
CREATE INDEX "anchor_receipts_submittedAt_idx" ON "anchor_receipts"("submittedAt");
CREATE INDEX "blockchain_dead_letters_status_idx" ON "blockchain_dead_letters"("status");
