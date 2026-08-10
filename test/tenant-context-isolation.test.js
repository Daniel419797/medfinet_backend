const assert = require('node:assert/strict');
const test = require('node:test');
const { withTenantTransaction } = require('../services/tenantContext');

test('tenant transaction forwards an explicit isolation level to Prisma', async () => {
  let receivedOptions = null;
  const transaction = {
    async $executeRawUnsafe(statement, organizationId) {
      assert.match(statement, /app\.current_organization_id/);
      assert.equal(organizationId, 'org-1');
    },
  };
  const database = {
    async $transaction(operation, options) {
      receivedOptions = options;
      return operation(transaction);
    },
  };

  const result = await withTenantTransaction(
    database,
    'org-1',
    async (tx) => {
      assert.equal(tx, transaction);
      return 'ok';
    },
    { isolationLevel: 'RepeatableRead' }
  );

  assert.equal(result, 'ok');
  assert.deepEqual(receivedOptions, { isolationLevel: 'RepeatableRead' });
});

test('tenant transaction keeps existing behavior when no isolation level is requested', async () => {
  let argumentCount = 0;
  const transaction = {
    async $executeRawUnsafe() {},
  };
  const database = {
    async $transaction(...args) {
      argumentCount = args.length;
      return args[0](transaction);
    },
  };

  await withTenantTransaction(database, 'org-1', async () => 'ok');
  assert.equal(argumentCount, 1);
});
