const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createChildIdentifierService,
  normalizeSystem,
} = require('../services/childIdentifierService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

test('normalizes stable identifier namespaces', () => {
  assert.equal(normalizeSystem(' National_ID '), 'national_id');
  assert.throws(
    () => normalizeSystem('https://issuer.example/id'),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('requires a different worker to verify an identifier', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    childIdentifier: {
      async findFirst() {
        return {
          id: 'identifier-1',
          status: 'PENDING',
          createdBySubjectId: 'worker-1',
        };
      },
    },
  };
  const service = createChildIdentifierService(databaseWithTransaction(tx));

  await assert.rejects(
    service.verify({
      organizationId: 'org-1',
      actorSubjectId: 'worker-1',
      purpose: 'identity-verification',
    }, 'identifier-1'),
    (error) => error.code === 'CHILD_IDENTIFIER_MAKER_CHECKER_REQUIRED'
  );
});
