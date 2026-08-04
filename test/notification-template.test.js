const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertTemplateContract,
  variableNames,
} = require('../services/notificationTemplateService');
const {
  renderTemplate,
  scheduleOutsideQuietHours,
  isQuiet,
} = require('../services/notificationQueueService');

test('requires declared variables to exactly match template placeholders', () => {
  assert.doesNotThrow(() => assertTemplateContract(
    'Reward from {{campaignName}}',
    'You received {{credits}} credits.',
    ['campaignName', 'credits']
  ));
  assert.throws(
    () => assertTemplateContract(null, 'Hello {{name}}', ['name', 'extra']),
    /placeholders must exactly match/
  );
  assert.throws(() => variableNames(['valid', 'valid']), /must be unique/);
});

test('renders only contract variables and escapes untrusted content', () => {
  const rendered = renderTemplate(
    {
      variableNames: ['name', 'credits'],
      subject: 'Hello {{name}}',
      body: '{{name}} received {{credits}} credits',
    },
    { name: '<script>alert(1)</script>', credits: 20n }
  );

  assert.equal(rendered.subject.includes('<script>'), false);
  assert.match(rendered.subject, /&lt;script&gt;/);
  assert.equal(rendered.body.endsWith('20 credits'), true);
  assert.throws(
    () => renderTemplate(
      { variableNames: ['name'], body: '{{name}}' },
      { name: 'Amina', extra: 'unsafe' }
    ),
    /do not match/
  );
});

test('defers delivery until the recipient leaves quiet hours', () => {
  assert.equal(isQuiet(23, 22, 7), true);
  assert.equal(isQuiet(8, 22, 7), false);
  const now = new Date('2026-07-29T22:15:00.000Z');
  const scheduled = scheduleOutsideQuietHours(now, {
    timezone: 'UTC',
    quietHoursStart: 22,
    quietHoursEnd: 7,
  });
  assert.equal(scheduled > now, true);
  assert.equal(isQuiet(scheduled.getUTCHours(), 22, 7), false);
});
