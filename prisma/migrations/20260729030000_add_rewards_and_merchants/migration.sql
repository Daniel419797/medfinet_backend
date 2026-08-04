CREATE TYPE "RewardCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'CANCELLED');
ALTER TYPE "OrganizationRole" ADD VALUE 'MERCHANT';
ALTER TYPE "OrganizationRole" ADD VALUE 'CAREGIVER';
CREATE TYPE "RewardAccountStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE "RewardTransactionType" AS ENUM ('EARN', 'RESERVE', 'RELEASE', 'REDEEM', 'REVERSAL', 'ADJUSTMENT');
CREATE TYPE "MerchantStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "RewardReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');
CREATE TYPE "RewardRedemptionStatus" AS ENUM ('COMPLETED', 'REVERSED');
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');
CREATE TYPE "MerchantMembershipRole" AS ENUM ('OWNER', 'CASHIER', 'SETTLEMENT');

CREATE TABLE "reward_campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programmeId" TEXT,
    "name" TEXT NOT NULL,
    "sponsorName" TEXT NOT NULL,
    "status" "RewardCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "creditBudget" BIGINT NOT NULL,
    "creditsIssued" BIGINT NOT NULL DEFAULT 0,
    "milestoneRules" JSONB NOT NULL,
    "createdBySubjectId" TEXT NOT NULL,
    "activatedBySubjectId" TEXT,
    "activatedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "reward_campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_campaigns_time_check" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "reward_campaigns_budget_check" CHECK (
        "creditBudget" > 0
        AND "creditsIssued" >= 0
        AND "creditsIssued" <= "creditBudget"
    ),
    CONSTRAINT "reward_campaigns_activation_check" CHECK (
        (
            "status" IN ('ACTIVE', 'PAUSED', 'CLOSED')
            AND "activatedAt" IS NOT NULL
            AND "activatedBySubjectId" IS NOT NULL
        )
        OR "status" IN ('DRAFT', 'CANCELLED')
    ),
    CONSTRAINT "reward_campaigns_closed_check" CHECK (
        ("status" = 'CLOSED' AND "closedAt" IS NOT NULL)
        OR "status" <> 'CLOSED'
    )
);

CREATE TABLE "reward_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "status" "RewardAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "balance" BIGINT NOT NULL DEFAULT 0,
    "reservedBalance" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "reward_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_accounts_balances_check" CHECK (
        "balance" >= 0 AND "reservedBalance" >= 0
    ),
    CONSTRAINT "reward_accounts_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'PENDING',
    "eligibleCategories" JSONB NOT NULL,
    "settlementAccountRef" TEXT,
    "approvedBySubjectId" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "suspendedAt" TIMESTAMPTZ(3),
    "suspensionReason" TEXT,
    "createdBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "merchants_approval_check" CHECK (
        (
            "status" = 'ACTIVE'
            AND "approvedBySubjectId" IS NOT NULL
            AND "approvedAt" IS NOT NULL
        )
        OR "status" <> 'ACTIVE'
    ),
    CONSTRAINT "merchants_suspension_check" CHECK (
        (
            "status" = 'SUSPENDED'
            AND "suspendedAt" IS NOT NULL
            AND "suspensionReason" IS NOT NULL
        )
        OR "status" <> 'SUSPENDED'
    )
);

CREATE TABLE "reward_transactions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rewardAccountId" TEXT NOT NULL,
    "rewardCampaignId" TEXT,
    "merchantId" TEXT,
    "type" "RewardTransactionType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "reservedBalanceAfter" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "reversalOfTransactionId" TEXT,
    "metadata" JSONB,
    "createdBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reward_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_transactions_amount_check" CHECK ("amount" <> 0),
    CONSTRAINT "reward_transactions_balances_check" CHECK (
        "balanceAfter" >= 0 AND "reservedBalanceAfter" >= 0
    ),
    CONSTRAINT "reward_transactions_reversal_check" CHECK (
        ("type" = 'REVERSAL' AND "reversalOfTransactionId" IS NOT NULL)
        OR ("type" <> 'REVERSAL' AND "reversalOfTransactionId" IS NULL)
    )
);

CREATE TABLE "reward_grants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rewardCampaignId" TEXT NOT NULL,
    "rewardAccountId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "milestoneCode" TEXT NOT NULL,
    "credits" BIGINT NOT NULL,
    "sourceRecordType" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "grantedBySubjectId" TEXT NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reward_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_grants_credits_check" CHECK ("credits" > 0)
);

CREATE TABLE "reward_ledger_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rewardTransactionId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "debit" BIGINT NOT NULL DEFAULT 0,
    "credit" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reward_ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_ledger_entries_side_check" CHECK (
        ("debit" > 0 AND "credit" = 0)
        OR ("credit" > 0 AND "debit" = 0)
    )
);

CREATE TABLE "reward_reservations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rewardAccountId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "RewardReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "releasedAt" TIMESTAMPTZ(3),
    "createdBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "reward_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_reservations_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "reward_reservations_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "reward_reservations_lifecycle_check" CHECK (
        ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "releasedAt" IS NULL)
        OR ("status" IN ('RELEASED', 'EXPIRED') AND "releasedAt" IS NOT NULL AND "consumedAt" IS NULL)
        OR ("status" = 'ACTIVE' AND "consumedAt" IS NULL AND "releasedAt" IS NULL)
    )
);

CREATE TABLE "reward_redemptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rewardReservationId" TEXT NOT NULL,
    "rewardTransactionId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "settlementBatchId" TEXT,
    "amount" BIGINT NOT NULL,
    "status" "RewardRedemptionStatus" NOT NULL DEFAULT 'COMPLETED',
    "merchantReference" TEXT NOT NULL,
    "redeemedBySubjectId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMPTZ(3),
    "reversedBySubjectId" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_redemptions_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "reward_redemptions_reversal_check" CHECK (
        (
            "status" = 'REVERSED'
            AND "reversedAt" IS NOT NULL
            AND "reversedBySubjectId" IS NOT NULL
            AND "reversalReason" IS NOT NULL
        )
        OR "status" = 'COMPLETED'
    )
);

CREATE TABLE "settlement_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "totalCredits" BIGINT NOT NULL,
    "redemptionCount" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBySubjectId" TEXT NOT NULL,
    "approvedBySubjectId" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "paidAt" TIMESTAMPTZ(3),
    "paymentReference" TEXT,
    "failedAt" TIMESTAMPTZ(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlement_batches_period_check" CHECK ("periodEnd" > "periodStart"),
    CONSTRAINT "settlement_batches_totals_check" CHECK (
        "totalCredits" > 0 AND "redemptionCount" > 0
    ),
    CONSTRAINT "settlement_batches_approval_check" CHECK (
        (
            "status" IN ('APPROVED', 'PROCESSING', 'PAID', 'FAILED')
            AND "approvedBySubjectId" IS NOT NULL
            AND "approvedAt" IS NOT NULL
        )
        OR "status" IN ('DRAFT', 'CANCELLED')
    ),
    CONSTRAINT "settlement_batches_paid_check" CHECK (
        (
            "status" = 'PAID'
            AND "paidAt" IS NOT NULL
            AND "paymentReference" IS NOT NULL
        )
        OR "status" <> 'PAID'
    ),
    CONSTRAINT "settlement_batches_failed_check" CHECK (
        (
            "status" = 'FAILED'
            AND "failedAt" IS NOT NULL
            AND "failureReason" IS NOT NULL
        )
        OR "status" <> 'FAILED'
    )
);

CREATE TABLE "merchant_memberships" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "role" "MerchantMembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBySubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "merchant_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reward_campaigns_id_organizationId_key" ON "reward_campaigns"("id", "organizationId");
CREATE INDEX "reward_campaigns_status_window_idx" ON "reward_campaigns"("organizationId", "status", "startsAt", "endsAt");
CREATE INDEX "reward_campaigns_programme_status_idx" ON "reward_campaigns"("organizationId", "programmeId", "status");
CREATE UNIQUE INDEX "reward_accounts_id_organizationId_key" ON "reward_accounts"("id", "organizationId");
CREATE UNIQUE INDEX "reward_accounts_caregiverId_organizationId_key" ON "reward_accounts"("caregiverId", "organizationId");
CREATE INDEX "reward_accounts_status_updatedAt_idx" ON "reward_accounts"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "merchants_id_organizationId_key" ON "merchants"("id", "organizationId");
CREATE UNIQUE INDEX "merchants_organizationId_code_key" ON "merchants"("organizationId", "code");
CREATE INDEX "merchants_status_name_idx" ON "merchants"("organizationId", "status", "name");
CREATE UNIQUE INDEX "reward_transactions_id_organizationId_key" ON "reward_transactions"("id", "organizationId");
CREATE UNIQUE INDEX "reward_transactions_idempotency_key" ON "reward_transactions"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "reward_transactions_reversal_key" ON "reward_transactions"("reversalOfTransactionId", "organizationId");
CREATE INDEX "reward_transactions_account_createdAt_idx" ON "reward_transactions"("organizationId", "rewardAccountId", "createdAt");
CREATE INDEX "reward_transactions_reference_idx" ON "reward_transactions"("organizationId", "referenceType", "referenceId");
CREATE UNIQUE INDEX "reward_grants_transactionId_key" ON "reward_grants"("transactionId");
CREATE UNIQUE INDEX "reward_grants_transaction_tenant_key" ON "reward_grants"("transactionId", "organizationId");
CREATE UNIQUE INDEX "reward_grants_campaign_child_milestone_key" ON "reward_grants"("rewardCampaignId", "childId", "milestoneCode");
CREATE INDEX "reward_grants_child_grantedAt_idx" ON "reward_grants"("organizationId", "childId", "grantedAt");
CREATE UNIQUE INDEX "reward_ledger_entries_id_organizationId_key" ON "reward_ledger_entries"("id", "organizationId");
CREATE INDEX "reward_ledger_entries_transaction_idx" ON "reward_ledger_entries"("organizationId", "rewardTransactionId");
CREATE INDEX "reward_ledger_entries_account_idx" ON "reward_ledger_entries"("organizationId", "accountCode", "createdAt");
CREATE UNIQUE INDEX "reward_reservations_tokenHash_key" ON "reward_reservations"("tokenHash");
CREATE UNIQUE INDEX "reward_reservations_id_organizationId_key" ON "reward_reservations"("id", "organizationId");
CREATE INDEX "reward_reservations_status_expiresAt_idx" ON "reward_reservations"("organizationId", "status", "expiresAt");
CREATE INDEX "reward_reservations_account_status_idx" ON "reward_reservations"("organizationId", "rewardAccountId", "status");
CREATE UNIQUE INDEX "reward_redemptions_rewardReservationId_key" ON "reward_redemptions"("rewardReservationId");
CREATE UNIQUE INDEX "reward_redemptions_rewardTransactionId_key" ON "reward_redemptions"("rewardTransactionId");
CREATE UNIQUE INDEX "reward_redemptions_id_organizationId_key" ON "reward_redemptions"("id", "organizationId");
CREATE UNIQUE INDEX "reward_redemptions_reservation_tenant_key" ON "reward_redemptions"("rewardReservationId", "organizationId");
CREATE UNIQUE INDEX "reward_redemptions_transaction_tenant_key" ON "reward_redemptions"("rewardTransactionId", "organizationId");
CREATE UNIQUE INDEX "reward_redemptions_merchant_reference_key" ON "reward_redemptions"("merchantId", "merchantReference");
CREATE INDEX "reward_redemptions_merchant_redeemedAt_idx" ON "reward_redemptions"("organizationId", "merchantId", "redeemedAt");
CREATE INDEX "reward_redemptions_status_redeemedAt_idx" ON "reward_redemptions"("organizationId", "status", "redeemedAt");
CREATE INDEX "reward_redemptions_settlement_idx" ON "reward_redemptions"("organizationId", "merchantId", "settlementBatchId", "redeemedAt");
CREATE UNIQUE INDEX "settlement_batches_id_organizationId_key" ON "settlement_batches"("id", "organizationId");
CREATE UNIQUE INDEX "settlement_batches_merchant_period_key" ON "settlement_batches"("merchantId", "periodStart", "periodEnd");
CREATE INDEX "settlement_batches_status_createdAt_idx" ON "settlement_batches"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "merchant_memberships_merchantId_subjectId_key" ON "merchant_memberships"("merchantId", "subjectId");
CREATE INDEX "merchant_memberships_subject_status_idx" ON "merchant_memberships"("organizationId", "subjectId", "status");

ALTER TABLE "reward_campaigns" ADD CONSTRAINT "reward_campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_campaigns" ADD CONSTRAINT "reward_campaigns_programmeId_organizationId_fkey" FOREIGN KEY ("programmeId", "organizationId") REFERENCES "programmes"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_accounts" ADD CONSTRAINT "reward_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_accounts" ADD CONSTRAINT "reward_accounts_caregiverId_organizationId_fkey" FOREIGN KEY ("caregiverId", "organizationId") REFERENCES "caregivers"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_rewardAccountId_organizationId_fkey" FOREIGN KEY ("rewardAccountId", "organizationId") REFERENCES "reward_accounts"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_rewardCampaignId_organizationId_fkey" FOREIGN KEY ("rewardCampaignId", "organizationId") REFERENCES "reward_campaigns"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_merchantId_organizationId_fkey" FOREIGN KEY ("merchantId", "organizationId") REFERENCES "merchants"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_transactions" ADD CONSTRAINT "reward_transactions_reversalOfTransactionId_organizationId_fkey" FOREIGN KEY ("reversalOfTransactionId", "organizationId") REFERENCES "reward_transactions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_rewardCampaignId_organizationId_fkey" FOREIGN KEY ("rewardCampaignId", "organizationId") REFERENCES "reward_campaigns"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_rewardAccountId_organizationId_fkey" FOREIGN KEY ("rewardAccountId", "organizationId") REFERENCES "reward_accounts"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_childId_organizationId_fkey" FOREIGN KEY ("childId", "organizationId") REFERENCES "children"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_transactionId_organizationId_fkey" FOREIGN KEY ("transactionId", "organizationId") REFERENCES "reward_transactions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_rewardTransactionId_organizationId_fkey" FOREIGN KEY ("rewardTransactionId", "organizationId") REFERENCES "reward_transactions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_reservations" ADD CONSTRAINT "reward_reservations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_reservations" ADD CONSTRAINT "reward_reservations_rewardAccountId_organizationId_fkey" FOREIGN KEY ("rewardAccountId", "organizationId") REFERENCES "reward_accounts"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_reservations" ADD CONSTRAINT "reward_reservations_merchantId_organizationId_fkey" FOREIGN KEY ("merchantId", "organizationId") REFERENCES "merchants"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_rewardReservationId_organizationId_fkey" FOREIGN KEY ("rewardReservationId", "organizationId") REFERENCES "reward_reservations"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_rewardTransactionId_organizationId_fkey" FOREIGN KEY ("rewardTransactionId", "organizationId") REFERENCES "reward_transactions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_merchantId_organizationId_fkey" FOREIGN KEY ("merchantId", "organizationId") REFERENCES "merchants"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_settlementBatchId_organizationId_fkey" FOREIGN KEY ("settlementBatchId", "organizationId") REFERENCES "settlement_batches"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_merchantId_organizationId_fkey" FOREIGN KEY ("merchantId", "organizationId") REFERENCES "merchants"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "merchant_memberships" ADD CONSTRAINT "merchant_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "merchant_memberships" ADD CONSTRAINT "merchant_memberships_merchantId_organizationId_fkey" FOREIGN KEY ("merchantId", "organizationId") REFERENCES "merchants"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION medfinet_prevent_reward_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'reward ledger rows are immutable';
END;
$$;

CREATE TRIGGER "reward_transactions_immutable"
BEFORE UPDATE OR DELETE ON "reward_transactions"
FOR EACH ROW EXECUTE FUNCTION medfinet_prevent_reward_ledger_mutation();

CREATE TRIGGER "reward_grants_immutable"
BEFORE UPDATE OR DELETE ON "reward_grants"
FOR EACH ROW EXECUTE FUNCTION medfinet_prevent_reward_ledger_mutation();

CREATE TRIGGER "reward_ledger_entries_immutable"
BEFORE UPDATE OR DELETE ON "reward_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION medfinet_prevent_reward_ledger_mutation();

CREATE OR REPLACE FUNCTION medfinet_enforce_balanced_reward_transaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    target_transaction_id TEXT;
    total_debit BIGINT;
    total_credit BIGINT;
    entry_count INTEGER;
BEGIN
    target_transaction_id := COALESCE(NEW."rewardTransactionId", OLD."rewardTransactionId");
    SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*)
      INTO total_debit, total_credit, entry_count
      FROM public."reward_ledger_entries"
     WHERE "rewardTransactionId" = target_transaction_id;
    IF entry_count < 2 OR total_debit <> total_credit THEN
        RAISE EXCEPTION 'Reward transaction % is not balanced', target_transaction_id
          USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "reward_transaction_must_balance"
AFTER INSERT ON "reward_ledger_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION medfinet_enforce_balanced_reward_transaction();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'reward_campaigns',
        'reward_accounts',
        'reward_transactions',
        'reward_grants',
        'reward_ledger_entries',
        'merchants',
        'reward_reservations',
        'reward_redemptions',
        'settlement_batches'
        ,'merchant_memberships'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL USING ("organizationId" = public.medfinet_current_organization_id()) WITH CHECK ("organizationId" = public.medfinet_current_organization_id())',
            table_name || '_tenant_isolation',
            table_name
        );
    END LOOP;
END
$$;
