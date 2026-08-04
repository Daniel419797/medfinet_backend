const assert = require('node:assert/strict');
const test = require('node:test');
const {
  page,
  paged,
  canUseAccount,
  serializeBigInts,
  createRewardQueryService,
} = require('../services/rewardQueryService');

function databaseWithTransaction(transaction) {
  return { async $transaction(operation) { return operation(transaction); } };
}

test('serializes nested reward credits for JSON transport', () => {
  assert.deepEqual(serializeBigInts({ balance: 450n, entries: [{ debit: 25n }] }), {
    balance: '450', entries: [{ debit: '25' }],
  });
});

test('uses bounded cursor pagination with an unambiguous next cursor', () => {
  assert.deepEqual(page({ limit: '2', cursor: 'item-0' }), {
    take: 3,
    cursor: { id: 'item-0' },
    skip: 1,
  });
  assert.deepEqual(
    paged([{ id: '1' }, { id: '2' }, { id: '3' }], 2),
    { items: [{ id: '1' }, { id: '2' }], nextCursor: '2' }
  );
  assert.throws(() => page({ limit: 101 }), /limit/);
});

test('limits household account access to its caregiver or administrators', () => {
  const account = { caregiver: { subjectId: 'caregiver-1' } };
  assert.equal(
    canUseAccount({ role: 'CAREGIVER', actorSubjectId: 'caregiver-1' }, account),
    true
  );
  assert.equal(
    canUseAccount({ role: 'CAREGIVER', actorSubjectId: 'caregiver-2' }, account),
    false
  );
  assert.equal(canUseAccount({ role: 'ADMIN', actorSubjectId: 'admin-1' }, account), true);
});

test('lists only active merchant memberships owned by the authenticated subject', async () => {
  let query;
  const service = createRewardQueryService(databaseWithTransaction({
    async $executeRawUnsafe() {},
    merchantMembership: {
      async findMany(input) { query = input; return []; },
    },
  }));

  await service.listMyMerchants({
    organizationId: 'org-1',
    actorSubjectId: 'cashier-subject',
  });

  assert.deepEqual(query.where, {
    organizationId: 'org-1',
    subjectId: 'cashier-subject',
    status: 'ACTIVE',
    merchant: { status: 'ACTIVE' },
  });
  assert.equal(query.select.merchant.select.settlementAccountRef, undefined);
});

test('finds a caregiver reward account only through the authenticated subject', async () => {
  let accountQuery;
  const service = createRewardQueryService(databaseWithTransaction({
    async $executeRawUnsafe() {},
    rewardAccount: {
      async findFirst(input) { accountQuery = input; return null; },
    },
  }));

  const result = await service.getMyAccount({
    organizationId: 'org-1',
    actorSubjectId: 'caregiver-subject',
    purpose: 'rewards-view',
  });

  assert.equal(result, null);
  assert.deepEqual(accountQuery.where, {
    organizationId: 'org-1',
    caregiver: { subjectId: 'caregiver-subject' },
  });
});
