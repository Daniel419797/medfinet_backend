const { createClient } = require('@supabase/supabase-js');
const { DomainError } = require('../utils/domainError');

function normalizedEmail(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'email is required');
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'email must be a valid email address');
  }
  return email;
}

function createIdentityProviderAdminService({ supabaseClient, configuration } = {}) {
  const activeConfiguration = configuration || require('../config');
  const identityProvider = supabaseClient || createClient(
    activeConfiguration.supabase.url,
    activeConfiguration.supabase.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  async function verifiedAccountBySubjectId(subjectId) {
    const normalizedSubjectId = String(subjectId || '').trim();
    if (!normalizedSubjectId || normalizedSubjectId.length > 160) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'accountId is required');
    }
    let response;
    try {
      response = await identityProvider.auth.admin.getUserById(normalizedSubjectId);
    } catch {
      throw new DomainError(503, 'IDENTITY_PROVIDER_UNAVAILABLE', 'Unable to verify the Medfinet account right now');
    }
    const user = response?.data?.user;
    if (response?.error || !user?.id) {
      throw new DomainError(404, 'ACCOUNT_NOT_FOUND', 'No verified Medfinet account matches that account ID');
    }
    return assertVerified(user);
  }

  async function verifiedAccountByEmail(email) {
    const target = normalizedEmail(email);
    const perPage = 200;
    for (let page = 1; page <= 50; page += 1) {
      let response;
      try {
        response = await identityProvider.auth.admin.listUsers({ page, perPage });
      } catch {
        throw new DomainError(503, 'IDENTITY_PROVIDER_UNAVAILABLE', 'Unable to verify the Medfinet account right now');
      }
      if (response?.error) {
        throw new DomainError(503, 'IDENTITY_PROVIDER_UNAVAILABLE', 'Unable to verify the Medfinet account right now');
      }
      const users = response?.data?.users || [];
      const user = users.find((entry) => String(entry.email || '').trim().toLowerCase() === target);
      if (user) return assertVerified(user);
      if (users.length < perPage) break;
    }
    throw new DomainError(404, 'ACCOUNT_NOT_FOUND', 'No Medfinet account matches that email. Ask the parent to register and verify their email first.');
  }

  function assertVerified(user) {
    if (!user.email_confirmed_at && !user.confirmed_at) {
      throw new DomainError(409, 'ACCOUNT_NOT_VERIFIED', 'The Medfinet account exists but its email has not been verified yet');
    }
    return {
      subjectId: user.id,
      email: user.email || null,
    };
  }

  async function resolveVerifiedAccount(input = {}) {
    const accountId = String(input.accountId || '').trim();
    const email = String(input.email || '').trim();
    if (Boolean(accountId) === Boolean(email)) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'Provide exactly one of accountId or email');
    }
    return accountId
      ? verifiedAccountBySubjectId(accountId)
      : verifiedAccountByEmail(email);
  }

  return { resolveVerifiedAccount };
}

module.exports = { createIdentityProviderAdminService, normalizedEmail };
