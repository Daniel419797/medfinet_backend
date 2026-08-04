const assert = require('node:assert/strict');
const test = require('node:test');
const { createCredentialService } = require('../services/credentialService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

function context() {
  return {
    organizationId: 'org-1',
    actorSubjectId: 'worker-1',
    purpose: 'care-continuity',
  };
}

test('does not expose credential token hashes in inventory queries', async () => {
  let query;
  const tx = {
    async $executeRawUnsafe() {},
    childCredential: {
      async findMany(input) {
        query = input;
        return [];
      },
    },
  };
  const service = createCredentialService(databaseWithTransaction(tx));

  await service.list(context(), 'child-1', { status: 'ACTIVE', limit: 250 });

  assert.equal(query.where.organizationId, 'org-1');
  assert.equal(query.where.childId, 'child-1');
  assert.equal(query.take, 100);
  assert.equal(query.select.tokenHash, undefined);
});

test('requires an active worker-owned device when a scan supplies deviceId', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    fieldDevice: {
      async findFirst() {
        return null;
      },
    },
  };
  const service = createCredentialService(databaseWithTransaction(tx));

  await assert.rejects(
    service.resolve(context(), 'a-secure-token', { deviceId: 'device-1' }),
    (error) => error.code === 'DEVICE_ACCESS_DENIED'
  );
});

test('requires a registered device identifier for every credential scan', async () => {
  const service = createCredentialService({});

  await assert.rejects(
    service.resolve(context(), 'a-secure-token', {}),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});

test('rejects duplicate children in a bulk credential batch', async () => {
  const service = createCredentialService({});

  await assert.rejects(
    service.issueBulk(context(), {
      credentials: [
        { childId: 'child-1', kind: 'QR' },
        { childId: 'child-1', kind: 'NFC' },
      ],
    }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});
