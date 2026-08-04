const test = require('node:test');
const assert = require('node:assert/strict');
const { boundedLimit, createOperationsQueryService } = require('../services/operationsQueryService');

function databaseWithTransaction(transaction) {
  return { async $transaction(operation) { return operation(transaction); } };
}

const context = { organizationId: 'org-1' };

test('bounds operations query pages', () => {
  assert.equal(boundedLimit(undefined), 50);
  assert.equal(boundedLimit('100'), 100);
  assert.throws(() => boundedLimit('101'), (error) => error.code === 'INVALID_PAGE_LIMIT');
  assert.throws(() => boundedLimit('all'), (error) => error.code === 'INVALID_PAGE_LIMIT');
});

test('lists caregivers only inside the tenant without secret USSD fields', async () => {
  let query;
  const service = createOperationsQueryService(databaseWithTransaction({
    async $executeRawUnsafe() {},
    caregiver: { async findMany(input) { query = input; return []; } },
  }));
  await service.listCaregivers(context, { search: 'Ada', limit: '20' });
  assert.equal(query.where.organizationId, 'org-1');
  assert.equal(query.take, 20);
  assert.equal(query.select.ussdPinHash, undefined);
  assert.equal(query.select.phoneVerifiedAt, true);
});

test('limits caregiver appointment listings to their linked children', async () => {
  let query;
  const service = createOperationsQueryService(databaseWithTransaction({
    async $executeRawUnsafe() {},
    appointment: { async findMany(input) { query = input; return []; } },
  }));

  await service.listAppointments({
    organizationId: 'org-1',
    actorSubjectId: 'caregiver-subject',
    role: 'CAREGIVER',
  });

  assert.deepEqual(query.where.child, {
    caregivers: { some: { caregiver: { subjectId: 'caregiver-subject' } } },
  });
});

test('serializes reward balances for JSON responses', async () => {
  const service = createOperationsQueryService(databaseWithTransaction({
    async $executeRawUnsafe() {},
    rewardAccount: {
      async findMany() {
        return [{ id: 'account-1', balance: 450n, reservedBalance: 25n }];
      },
    },
  }));
  const [account] = await service.listRewardAccounts(context);
  assert.equal(account.balance, '450');
  assert.equal(account.reservedBalance, '25');
});

test('returns a bounded worklist with tenant-owned entries', async () => {
  let query;
  const service = createOperationsQueryService(databaseWithTransaction({
    async $executeRawUnsafe() {},
    beneficiaryWorklist: {
      async findFirst(input) { query = input; return { id: 'worklist-1', entries: [] }; },
    },
  }));
  const result = await service.getWorklist(context, 'worklist-1');
  assert.equal(query.where.organizationId, 'org-1');
  assert.equal(query.include.entries.take, 100);
  assert.equal(result.id, 'worklist-1');
});
