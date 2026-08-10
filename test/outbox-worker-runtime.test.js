const assert = require('node:assert/strict');
const test = require('node:test');
const {
  embeddedOutboxWorkerEnabled,
} = require('../scripts/process-outbox');

test('embedded outbox worker is disabled when RUN_OUTBOX_WORKER is absent or false', () => {
  assert.equal(embeddedOutboxWorkerEnabled({}), false);
  assert.equal(embeddedOutboxWorkerEnabled({ RUN_OUTBOX_WORKER: 'false' }), false);
  assert.equal(embeddedOutboxWorkerEnabled({ RUN_OUTBOX_WORKER: ' FALSE ' }), false);
});

test('embedded outbox worker is enabled only by RUN_OUTBOX_WORKER=true', () => {
  assert.equal(embeddedOutboxWorkerEnabled({ RUN_OUTBOX_WORKER: 'true' }), true);
  assert.equal(embeddedOutboxWorkerEnabled({ RUN_OUTBOX_WORKER: ' TRUE ' }), true);
});

test('embedded outbox worker rejects ambiguous RUN_OUTBOX_WORKER values', () => {
  assert.throws(
    () => embeddedOutboxWorkerEnabled({ RUN_OUTBOX_WORKER: 'yes' }),
    /RUN_OUTBOX_WORKER must be true or false/,
  );
});
