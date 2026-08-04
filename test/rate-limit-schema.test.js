const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260729090000_add_distributed_rate_limits',
    'migration.sql'
  ),
  'utf8'
);

test('uses atomic distributed rate-limit buckets without raw addresses', () => {
  assert.match(migration, /security_rate_limit_buckets/);
  assert.match(migration, /keyHash/);
  assert.match(migration, /requestCount/);
  assert.match(migration, /expiresAt/);
  assert.doesNotMatch(migration, /ipAddress/);
});
