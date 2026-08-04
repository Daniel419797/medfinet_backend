const assert = require('node:assert/strict');
const test = require('node:test');
const { createNfcLifecycleService } = require('../services/nfcLifecycleService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

const context = {
  organizationId: 'org-1',
  actorSubjectId: 'admin-1',
  purpose: 'secure-card-provisioning',
};

test('cancels a pending card and invalidates its credential and route', async () => {
  const calls = [];
  const transaction = {
    async $executeRawUnsafe() {},
    nfcCredentialBinding: {
      async findFirst() {
        return {
          id: 'binding-1',
          organizationId: 'org-1',
          credentialId: 'credential-1',
          publicId: 'public-1',
          status: 'PENDING',
          credential: { childId: 'child-1' },
        };
      },
      async update({ data }) {
        calls.push(['binding', data]);
        return { id: 'binding-1', ...data };
      },
    },
    childCredential: {
      async update({ data }) {
        calls.push(['credential', data]);
      },
    },
    nfcPublicRoute: {
      async deleteMany({ where }) {
        calls.push(['route', where]);
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  };
  const service = createNfcLifecycleService(databaseWithTransaction(transaction), {
    now: () => new Date('2026-07-29T12:00:00Z'),
  });

  const result = await service.cancel(context, 'binding-1', {
    reason: 'Card encoder disconnected before verification',
  });

  assert.equal(result.status, 'FAILED');
  assert.equal(calls.find(([kind]) => kind === 'credential')[1].status, 'REVOKED');
  assert.equal(calls.find(([kind]) => kind === 'audit')[1].action, 'nfc.provisioning-cancelled');
});

test('expires stale provisioning records and one-time scan challenges', async () => {
  const updates = [];
  const transaction = {
    async $executeRawUnsafe() {},
    nfcCredentialBinding: {
      async findMany() {
        return [{ id: 'binding-1', credentialId: 'credential-1', publicId: 'public-1' }];
      },
      async updateMany({ data }) {
        updates.push(['binding', data]);
        return { count: 1 };
      },
    },
    childCredential: {
      async updateMany({ data }) {
        updates.push(['credential', data]);
        return { count: 1 };
      },
    },
    nfcPublicRoute: {
      async deleteMany() {
        return { count: 1 };
      },
    },
    nfcScanChallenge: {
      async updateMany({ data }) {
        updates.push(['challenge', data]);
        return { count: 2 };
      },
    },
  };
  const service = createNfcLifecycleService(databaseWithTransaction(transaction));

  const result = await service.expireOrganization('org-1');

  assert.equal(result.expiredBindings, 1);
  assert.equal(result.expiredChallenges, 2);
  assert.equal(updates.find(([kind]) => kind === 'challenge')[1].status, 'EXPIRED');
});
