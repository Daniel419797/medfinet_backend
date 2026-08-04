const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const {
  createDeviceService,
  deviceIdentifierDigest,
  normalizeDevicePublicKey,
} = require('../services/deviceService');

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
    actorSubjectId: 'worker-1',
    role: 'HEALTH_WORKER',
    purpose: 'offline-device-management',
    ...overrides,
  };
}

function transaction(overrides = {}) {
  return { async $executeRawUnsafe() {}, ...overrides };
}

test('hashes device identifiers with a keyed digest', () => {
  const first = deviceIdentifierDigest('device-stable-id', 'pepper-one');
  const second = deviceIdentifierDigest('device-stable-id', 'pepper-two');
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /device-stable-id/);
});

test('accepts canonical Ed25519 scanner keys', () => {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  assert.match(normalizeDevicePublicKey(pem), /BEGIN PUBLIC KEY/);
  assert.throws(
    () => normalizeDevicePublicKey('not-a-key'),
    (error) => error.code === 'INVALID_DEVICE_PUBLIC_KEY'
  );
});

test('registers a device without persisting its raw identifier', async () => {
  let createData;
  const tx = transaction({
    fieldDevice: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        createData = data;
        return { id: 'device-1', status: 'ACTIVE', ...data };
      },
    },
    auditEvent: { async create() {} },
  });
  const service = createDeviceService(databaseWithTransaction(tx), {
    pepper: 'test-pepper',
  });

  const result = await service.register(context(), {
    deviceIdentifier: 'raw-device-id',
    displayName: 'Clinic tablet',
    platform: 'Android',
    appVersion: '1.0.0',
  });

  assert.equal(result.existing, false);
  assert.equal(createData.subjectId, 'worker-1');
  assert.equal(createData.deviceIdentifierHash.length, 64);
  assert.equal(JSON.stringify(createData).includes('raw-device-id'), false);
});

test('refuses silent scanner key replacement on an active device', async () => {
  const first = crypto.generateKeyPairSync('ed25519').publicKey
    .export({ type: 'spki', format: 'pem' }).toString();
  const second = crypto.generateKeyPairSync('ed25519').publicKey
    .export({ type: 'spki', format: 'pem' }).toString();
  const tx = transaction({
    fieldDevice: {
      async findUnique() {
        return {
          id: 'device-1',
          subjectId: 'worker-1',
          status: 'ACTIVE',
          publicKey: normalizeDevicePublicKey(first),
        };
      },
    },
  });
  const service = createDeviceService(databaseWithTransaction(tx), {
    pepper: 'test-pepper',
  });

  await assert.rejects(
    service.register(context(), {
      deviceIdentifier: 'raw-device-id',
      displayName: 'Clinic tablet',
      platform: 'Android',
      appVersion: '1.0.1',
      publicKey: second,
    }),
    (error) => error.code === 'DEVICE_KEY_ROTATION_REQUIRES_REVOCATION'
  );
});

test('allows an owner to revoke another subject device with evidence', async () => {
  const calls = [];
  const tx = transaction({
    fieldDevice: {
      async findFirst() {
        return {
          id: 'device-1',
          subjectId: 'worker-1',
          status: 'ACTIVE',
        };
      },
      async update({ data }) {
        calls.push(['update', data]);
        return { id: 'device-1', subjectId: 'worker-1', ...data };
      },
    },
    auditEvent: {
      async create({ data }) {
        calls.push(['audit', data]);
      },
    },
  });
  const service = createDeviceService(databaseWithTransaction(tx), {
    pepper: 'test-pepper',
  });

  const device = await service.revoke(
    context({ actorSubjectId: 'owner-1', role: 'OWNER' }),
    'device-1',
    { status: 'LOST', reason: 'Reported missing by facility' }
  );

  assert.equal(device.status, 'LOST');
  assert.equal(calls[0][1].revokedBySubjectId, 'owner-1');
  assert.equal(calls[1][1].action, 'device.reported-lost');
});

test('requires an administrator to explicitly approve a keyed provisioning station', async () => {
  const calls = [];
  const tx = transaction({
    fieldDevice: {
      async findFirst() {
        return { id: 'device-1', status: 'ACTIVE', publicKey: 'registered-key' };
      },
      async update({ data }) {
        calls.push(['device', data]);
        return { id: 'device-1', ...data };
      },
    },
    auditEvent: {
      async create({ data }) { calls.push(['audit', data]); },
    },
  });
  const service = createDeviceService(databaseWithTransaction(tx), {
    pepper: 'test-pepper',
  });

  const device = await service.setNfcProvisioningCapability(
    context({ role: 'ADMIN', actorSubjectId: 'admin-1' }),
    'device-1',
    true
  );

  assert.equal(device.nfcProvisioningEnabled, true);
  assert.equal(calls[1][1].action, 'device.nfc-provisioning-approved');
});
