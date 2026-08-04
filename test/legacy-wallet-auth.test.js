const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'healthWorkers.js'),
  'utf8'
);

test('legacy wallet authentication cannot issue application tokens', () => {
  assert.doesNotMatch(source, /jwt\.sign/);
  assert.doesNotMatch(source, /serviceRoleKey/);
});
