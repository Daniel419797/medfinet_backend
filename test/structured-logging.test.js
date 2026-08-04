const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { safeFields } = require('../utils/logger');
const { routePattern } = require('../middleware/httpLogger');

test('structured logging removes sensitive and complex values', () => {
  const fields = safeFields({
    requestId: 'request-1',
    statusCode: 200,
    email: 'caregiver@example.com',
    authorization: 'Bearer token',
    payload: { childId: 'child-1' },
    error: new Error('unsafe'),
  });

  assert.deepEqual(fields, {
    requestId: 'request-1',
    statusCode: 200,
  });
});

test('HTTP logging records route patterns rather than request URLs', () => {
  assert.equal(routePattern({
    baseUrl: '/api/v1',
    route: { path: '/children/:id' },
  }), '/api/v1/children/:id');
  assert.equal(routePattern({
    originalUrl: '/api/v1/children/private-child-id?token=secret',
  }), 'unmatched');
});

test('runtime code does not use ad-hoc console logging', () => {
  const roots = ['app.js', 'controllers', 'middleware', 'routes', 'services', 'utils'];
  const files = [];
  function visit(target) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target)) {
        visit(path.join(target, entry));
      }
    } else if (target.endsWith('.js')) {
      files.push(target);
    }
  }
  for (const root of roots) visit(path.join(__dirname, '..', root));
  const offenders = files.filter((file) => (
    /\bconsole\.(?:log|error|warn|info)\b/.test(fs.readFileSync(file, 'utf8'))
  ));
  assert.deepEqual(offenders, []);
});
