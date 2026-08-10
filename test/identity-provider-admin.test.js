const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createIdentityProviderAdminService,
} = require('../services/identityProviderAdminService');

function serviceWith(admin) {
  return createIdentityProviderAdminService({
    supabaseClient: { auth: { admin } },
    configuration: {
      supabase: {
        url: 'https://example.supabase.co',
        serviceRoleKey: 'service-role-test-key',
      },
    },
  });
}

test('resolves a verified account by subject ID', async () => {
  const service = serviceWith({
    async getUserById(id) {
      return {
        data: {
          user: {
            id,
            email: 'parent@example.com',
            email_confirmed_at: '2026-08-10T00:00:00.000Z',
          },
        },
        error: null,
      };
    },
  });

  const account = await service.resolveVerifiedAccount({ accountId: 'subject-1' });
  assert.deepEqual(account, {
    subjectId: 'subject-1',
    email: 'parent@example.com',
  });
});

test('resolves email case-insensitively and requires verification', async () => {
  const service = serviceWith({
    async listUsers() {
      return {
        data: {
          users: [
            {
              id: 'subject-2',
              email: 'Parent@Example.com',
              email_confirmed_at: '2026-08-10T00:00:00.000Z',
            },
          ],
        },
        error: null,
      };
    },
  });

  const account = await service.resolveVerifiedAccount({ email: 'parent@example.com' });
  assert.equal(account.subjectId, 'subject-2');
});

test('rejects unverified accounts and ambiguous identifiers', async () => {
  const service = serviceWith({
    async getUserById(id) {
      return {
        data: { user: { id, email: 'parent@example.com' } },
        error: null,
      };
    },
  });

  await assert.rejects(
    () => service.resolveVerifiedAccount({ accountId: 'subject-3' }),
    (error) => error.code === 'ACCOUNT_NOT_VERIFIED'
  );
  await assert.rejects(
    () => service.resolveVerifiedAccount({ accountId: 'subject-3', email: 'parent@example.com' }),
    (error) => error.code === 'VALIDATION_ERROR'
  );
});
