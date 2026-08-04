const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAuditQueryService,
  normalizeAuditQuery,
} = require('../services/auditQueryService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('searches audit evidence only inside the verified tenant and bounded range', async () => {
  let query;
  const tx = {
    async $executeRawUnsafe() {},
    auditEvent: {
      async findMany(input) {
        query = input;
        return [{ id: 'audit-1' }];
      },
    },
  };
  const now = new Date('2026-07-29T12:00:00.000Z');
  const result = await createAuditQueryService(
    databaseWithTransaction(tx),
    { now: () => now }
  ).list({
    organizationId: 'org-1',
  }, {
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-29T00:00:00.000Z',
    action: 'legal-hold.placed',
  });

  assert.equal(query.where.organizationId, 'org-1');
  assert.equal(query.where.action, 'legal-hold.placed');
  assert.equal(query.take, 51);
  assert.equal(result.items.length, 1);
});

test('rejects unsafe filters and multi-year audit extraction', () => {
  const now = new Date('2026-07-29T12:00:00.000Z');
  assert.throws(
    () => normalizeAuditQuery({
      from: '2024-01-01T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    }, now),
    (error) => error.code === 'VALIDATION_ERROR'
  );
  assert.throws(
    () => normalizeAuditQuery({ action: 'x OR 1=1' }, now),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});
