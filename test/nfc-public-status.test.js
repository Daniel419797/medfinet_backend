const assert = require('node:assert/strict');
const test = require('node:test');
const { createNfcPublicTapService } = require('../services/nfcPublicTapService');
const { uidDigest } = require('../services/nfcIdentity');

const uidPepper = 'a-test-nfc-uid-pepper-that-is-long-enough';

function serviceFor(binding) {
  const transaction = {
    async $executeRawUnsafe() {},
    nfcCredentialBinding: {
      async findFirst() {
        return binding && {
          hardwareFamily: 'NTAG_215',
          uidHash: uidDigest('04DE5F1EACC040', uidPepper),
          ...binding,
        };
      },
    },
  };
  const database = {
    nfcPublicRoute: {
      async findUnique() {
        return { publicId: 'abcdefghijklmnopqrstuvwx', organizationId: 'org-1', bindingId: 'binding-1' };
      },
    },
    async $transaction(operation) { return operation(transaction); },
  };
  return createNfcPublicTapService(database, {
    config: { uidPepper },
    now: () => new Date('2026-07-29T12:00:00Z'),
  });
}

test('public taps distinguish a replaced card without exposing child data', async () => {
  const result = await serviceFor({
    id: 'binding-1',
    status: 'REVOKED',
    originalityVerifiedAt: new Date(),
    credential: { status: 'ROTATED', expiresAt: null },
  }).verifyPublicTap(
    'abcdefghijklmnopqrstuvwx',
    { uc: '04DE5F1EACC040x00003D', t: 'A'.repeat(43) }
  );
  assert.equal(result.status, 'REPLACED');
  assert.equal(result.scannerRequired, false);
  assert.equal('child' in result, false);
});

test('public taps distinguish an expired active card', async () => {
  const result = await serviceFor({
    id: 'binding-1',
    status: 'ACTIVE',
    originalityVerifiedAt: new Date(),
    credential: { status: 'ACTIVE', expiresAt: new Date('2026-07-28') },
  }).verifyPublicTap(
    'abcdefghijklmnopqrstuvwx',
    { uc: '04DE5F1EACC040x00003D', t: 'A'.repeat(43) }
  );
  assert.equal(result.status, 'EXPIRED');
  assert.equal(result.scannerRequired, false);
});

test('public taps reject malformed card tokens before database resolution', async () => {
  await assert.rejects(
    serviceFor(null).verifyPublicTap(
      'abcdefghijklmnopqrstuvwx',
      { uc: '04DE5F1EACC040x00003D', t: 'copied-or-truncated' }
    ),
    (error) => error.code === 'INVALID_NFC_CARD_TOKEN'
  );
});
