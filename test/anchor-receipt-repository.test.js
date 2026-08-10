const assert = require('node:assert/strict');
const test = require('node:test');
const AnchorReceiptRepository = require('../services/anchorReceiptRepository');

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
