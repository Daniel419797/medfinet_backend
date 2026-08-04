const assert = require('node:assert/strict');
const test = require('node:test');
const { createRewardRedemptionService } = require('../services/rewardRedemptionService');
const { tokenHash } = require('../services/rewardReservationService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('consumes a valid reservation exactly once and conserves account balances', async () => {
  const calls = [];
  let reservationReads = 0;
  const tx = {
    async $executeRawUnsafe() {},
    async $queryRawUnsafe() {},
    rewardRedemption: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        calls.push(['redemption', data]);
        return { id: 'redemption-1', ...data };
      },
    },
    rewardReservation: {
      async findFirst({ where }) {
        reservationReads += 1;
        if (reservationReads === 1) assert.equal(where.tokenHash, tokenHash('opaque-token'));
        return {
          id: 'reservation-1',
          rewardAccountId: 'account-1',
          merchantId: 'merchant-1',
          category: 'NUTRITION',
          amount: 25n,
        };
      },
      async update({ data }) {
        calls.push(['reservation-update', data]);
      },
    },
    rewardAccount: {
      async updateMany({ data }) {
        calls.push(['account-update', data]);
        return { count: 1 };
      },
      async findUnique() {
        return { id: 'account-1', balance: 75n, reservedBalance: 0n };
      },
    },
    rewardTransaction: {
      async create({ data }) {
        calls.push(['ledger', data]);
        return { id: 'transaction-1', ...data };
      },
    },
    outboxEvent: { async create() {} },
    auditEvent: { async create() {} },
  };
  const service = createRewardRedemptionService(databaseWithTransaction(tx), {
    now: () => new Date('2026-07-29T10:00:00.000Z'),
  });

  const result = await service.redeem(
    {
      organizationId: 'org-1',
      actorSubjectId: 'cashier-1',
      purpose: 'merchant-redemption',
    },
    'merchant-1',
    { token: 'opaque-token', merchantReference: 'sale-100' }
  );

  assert.equal(result.redemption.id, 'redemption-1');
  assert.equal(calls[0][1].reservedBalance.decrement, 25n);
  assert.equal(calls[1][1].type, 'REDEEM');
  assert.equal(calls[1][1].balanceAfter, 75n);
  assert.equal(calls.find(([name]) => name === 'reservation-update')[1].status, 'CONSUMED');
});
