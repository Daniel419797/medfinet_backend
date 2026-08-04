const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const schema = fs.readFileSync(
  path.join(__dirname, '..', 'prisma', 'schema.prisma'),
  'utf8'
);
const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260729030000_add_rewards_and_merchants',
    'migration.sql'
  ),
  'utf8'
);

test('defines the production reward ledger and merchant settlement models', () => {
  for (const model of [
    'RewardCampaign',
    'RewardAccount',
    'RewardTransaction',
    'RewardLedgerEntry',
    'RewardGrant',
    'Merchant',
    'MerchantMembership',
    'RewardReservation',
    'RewardRedemption',
    'SettlementBatch',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  assert.match(schema, /settlementBatchId\s+String\?/);
  assert.match(schema, /CAREGIVER/);
});

test('enforces immutable ledger, tenant isolation, and accounting checks in SQL', () => {
  assert.match(migration, /reward_transactions_immutable/);
  assert.match(migration, /reward_grants_immutable/);
  assert.match(migration, /reward_ledger_entries_immutable/);
  assert.match(migration, /reward_transaction_must_balance/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /reward_accounts_balances_check/);
  assert.match(migration, /settlement_batches_totals_check/);
  assert.match(migration, /reward_redemptions_settlementBatchId_organizationId_fkey/);
});
