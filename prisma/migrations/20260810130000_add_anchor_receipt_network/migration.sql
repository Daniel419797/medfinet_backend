ALTER TABLE "anchor_receipts"
ADD COLUMN "network" TEXT;

ALTER TABLE "anchor_receipts"
ADD CONSTRAINT "anchor_receipts_network_check"
CHECK ("network" IS NULL OR "network" IN ('testnet', 'mainnet'));
