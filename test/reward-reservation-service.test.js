const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRewardReservationService,
  reservationToken,
  tokenHash,
  reservationMinutes,
} = require('../services/rewardReservationService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

function context(overrides = {}) {
  return {
    organizationId: 'org-1',
    actorSubjectId: 'caregiver-subject',
    role: 'CAREGIVER',
    purpose: 'household-benefit-redemption',
    ...overrides,
  };
}

test('derives replay-stable opaque tokens without exposing account identifiers', () => {
  const first = reservationToken('secret', 'org-1', 'account-1', 'request-1');
  const second = reservationToken('secret', 'org-1', 'account-1', 'request-1');
  assert.equal(first, second);
  assert.equal(tokenHash(first).length, 64);
  assert.doesNotMatch(first, /account-1|org-1|request-1/);
  assert.equal(reservationMinutes(undefined), 15);
  assert.throws(() => reservationMinutes(31), /expiresInMinutes/);
});

test('atomically moves available credits into a merchant-bound reservation', async () => {
  const calls = [];
  const tx = {
    async $executeRawUnsafe() {},
    async $queryRawUnsafe() {},
    rewardTransaction: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        calls.push(['ledger', data]);
        return { id: 'transaction-1', ...data };
      },
    },
    rewardAccount: {
      async findFirst() {
        return {
          id: 'account-1',
          status: 'ACTIVE',
          caregiver: { subjectId: 'caregiver-subject' },
        };
      },
      async updateMany({ data }) {
        calls.push(['account-update', data]);
        return { count: 1 };
      },
      async findUnique() {
        return { id: 'account-1', balance: 60n, reservedBalance: 40n };
      },
    },
    merchant: {
      async findFirst() {
        return {
          id: 'merchant-1',
          status: 'ACTIVE',
          eligibleCategories: ['NUTRITION'],
        };
      },
    },
    rewardReservation: {
      async create({ data }) {
        calls.push(['reservation', data]);
        return { id: 'reservation-1', ...data };
      },
    },
    auditEvent: { async create() {} },
  };
  const service = createRewardReservationService(databaseWithTransaction(tx), {
    now: () => new Date('2026-07-29T10:00:00.000Z'),
    tokenSecret: 'test-secret',
  });

  const result = await service.createReservation(
    context(),
    'account-1',
    'merchant-1',
    {
      category: 'nutrition',
      amount: '40',
      idempotencyKey: 'request-1',
      expiresInMinutes: 10,
    }
  );

  assert.equal(result.reservation.id, 'reservation-1');
  assert.equal(result.reservation.expiresAt.toISOString(), '2026-07-29T10:10:00.000Z');
  assert.equal(calls[0][1].balance.decrement, 40n);
  assert.equal(calls[0][1].reservedBalance.increment, 40n);
  assert.equal(calls[2][1].type, 'RESERVE');
  assert.equal(calls[2][1].amount, -40n);
  assert.equal(typeof result.redemptionToken, 'string');
});
