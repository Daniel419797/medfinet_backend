const assert = require('node:assert/strict');
const test = require('node:test');
const { createMerchantAccessMiddleware } = require('../middleware/merchantAccess');

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function request() {
  return {
    organization: { id: 'org-1' },
    params: { merchantId: 'merchant-1' },
    user: { id: 'cashier-1' },
  };
}

test('requires an active role-bound membership at an active merchant', async () => {
  let where;
  const middleware = createMerchantAccessMiddleware({
    prismaClient: {
      merchantMembership: {
        async findFirst(input) {
          where = input.where;
          return { id: 'membership-1', role: 'CASHIER' };
        },
      },
    },
    allowedRoles: ['OWNER', 'CASHIER'],
  });
  const req = request();
  let continued = false;

  await middleware(req, response(), () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.deepEqual(where.role.in, ['OWNER', 'CASHIER']);
  assert.equal(where.merchant.status, 'ACTIVE');
  assert.equal(req.merchant.membership.id, 'membership-1');
});

test('fails closed when merchant membership is absent', async () => {
  const middleware = createMerchantAccessMiddleware({
    prismaClient: {
      merchantMembership: { async findFirst() { return null; } },
    },
  });
  const res = response();

  await middleware(request(), res, () => {});

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.code, 'MERCHANT_ACCESS_DENIED');
});
