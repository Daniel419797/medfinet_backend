const assert = require('node:assert/strict');
const test = require('node:test');
const AnchorReceiptRepository = require('../services/anchorReceiptRepository');
const AnchorReceipt = require('../services/blockchain/AnchorReceipt');

test('looks up anchor details through the authenticated tenant boundary', async () => {
  let query;
  const repository = new AnchorReceiptRepository({
    anchorReceipt: {
      async findFirst(input) {
        query = input;
        return null;
      },
    },
  });

  const receipt = await repository.findByAnchorIdForTenant('anchor-1', 'org-1');

  assert.equal(receipt, null);
  assert.deepEqual(query, {
    where: { anchorId: 'anchor-1', tenantId: 'org-1' },
  });
});

test('persists the Algorand network with a new anchor receipt', () => {
  const receipt = AnchorReceipt.fromAnchorResult(
    'anchor-1',
    0x09,
    'clinical',
    'org-1',
    {
      network: 'testnet',
      txId: 'TX-1',
      blockHeight: 42n,
      timestamp: '2026-08-10T12:00:00.000Z',
      nonce: '0011223344556677',
      hash: 'a'.repeat(64),
      confirmations: 4,
    },
  );

  assert.equal(receipt.network, 'testnet');
  assert.equal(receipt.toDatabase().network, 'testnet');
  assert.equal(receipt.toJSON().network, 'testnet');
});
