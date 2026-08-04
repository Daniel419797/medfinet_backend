const test = require('node:test');
const assert = require('node:assert/strict');
const { createUssdSessionService } = require('../services/ussdSessionService');

const config = {
  sessionTtlSeconds: 180,
  stateEncryptionKey: () => Buffer.alloc(32, 7),
};

function request(digest = 'request-1') {
  return {
    provider: 'africas_talking',
    providerSessionId: 'provider-session',
    phoneNumber: '+2348012345678',
    requestDigest: digest,
  };
}

test('encrypts authenticated session state, menu, and cached response at rest', async () => {
  let persisted;
  const database = {
    ussdSession: {
      update: async ({ data }) => { persisted = data; return data; },
    },
  };
  const service = createUssdSessionService(database, { config });
  await service.save({
    id: 'session-1', organizationId: 'org-1', caregiverId: 'caregiver-1',
    currentMenu: 'ROOT', state: {}, locale: 'en',
  }, request(), {
    menu: 'APPOINTMENT',
    state: { inputCount: 1, appointmentId: 'sensitive-appointment-id' },
    formatted: 'CON Community Health Centre appointment',
    continueSession: true,
  });

  const serialized = JSON.stringify(persisted);
  assert.equal(persisted.currentMenu, 'SECURE');
  assert.equal(persisted.state.v, 1);
  assert.match(persisted.lastResponse, /^enc:v1:/);
  assert.doesNotMatch(serialized, /sensitive-appointment-id|Community Health Centre|APPOINTMENT/);
});

test('decrypts state and returns byte-identical cached replay', async () => {
  let stored;
  const writeDatabase = { ussdSession: { update: async ({ data }) => { stored = data; } } };
  const writer = createUssdSessionService(writeDatabase, { config });
  const formatted = 'CON Next vaccination: 12 Aug 2026';
  await writer.save({
    id: 'session-2', organizationId: 'org-1', caregiverId: 'caregiver-1',
    currentMenu: 'ROOT', state: {}, locale: 'en',
  }, request('same-digest'), {
    menu: 'VACCINATION', state: { inputCount: 2, itemId: 'appointment-2' },
    formatted, continueSession: true,
  });

  const reader = createUssdSessionService({ ussdSession: {
    findUnique: async () => ({
      id: 'session-2', organizationId: 'org-1', caregiverId: 'caregiver-1',
      currentMenu: stored.currentMenu, state: stored.state, status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000), lastRequestDigest: 'same-digest',
      lastResponse: stored.lastResponse,
    }),
  } }, { config });
  const opened = await reader.open(request('same-digest'), {});
  assert.equal(opened.replay, formatted);
  assert.equal(opened.session.currentMenu, 'VACCINATION');
  assert.equal(opened.session.state.itemId, 'appointment-2');
});

test('rejects modified encrypted session state', async () => {
  const database = { ussdSession: { findUnique: async () => ({
    id: 'session-3', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000),
    state: { v: 1, iv: Buffer.alloc(12).toString('base64'), tag: Buffer.alloc(16).toString('base64'), data: 'AAAA' },
  }) } };
  const service = createUssdSessionService(database, { config });
  await assert.rejects(
    service.open(request(), {}),
    (error) => error.code === 'USSD_STATE_INVALID'
  );
});
