const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_IN_APP_TEMPLATES,
  DEFAULT_SMS_TEMPLATES,
  defaultNotificationTemplates,
} = require('../services/notificationDefaults');
const {
  assertTemplateContract,
} = require('../services/notificationTemplateService');

test('ships an active contract-valid in-app template for every produced event', () => {
  const expected = [
    'REWARD_GRANTED',
    'REWARD_REDEEMED',
    'SETTLEMENT_PAID',
    'APPOINTMENT_SCHEDULED',
    'APPOINTMENT_STATUS_CHANGED',
    'REFERRAL_OPENED',
    'REFERRAL_STATUS_CHANGED',
    'EMERGENCY_ACCESS_ACTIVATED',
    'VACCINE_DUE',
  ];
  assert.deepEqual(
    DEFAULT_IN_APP_TEMPLATES.map(({ key }) => key).sort(),
    expected.sort()
  );
  for (const template of DEFAULT_IN_APP_TEMPLATES) {
    assert.doesNotThrow(() => assertTemplateContract(
      null,
      template.body,
      template.variableNames
    ));
  }
});

test('ships contract-valid SMS templates for every notification event', () => {
  const expected = [
    'APPOINTMENT_SCHEDULED',
    'APPOINTMENT_STATUS_CHANGED',
    'REFERRAL_OPENED',
    'REFERRAL_STATUS_CHANGED',
    'EMERGENCY_ACCESS_ACTIVATED',
    'REWARD_GRANTED',
    'REWARD_REDEEMED',
    'SETTLEMENT_PAID',
    'VACCINE_DUE',
  ];
  assert.deepEqual(
    DEFAULT_SMS_TEMPLATES.map(({ key }) => key).sort(),
    expected.sort()
  );
  for (const template of DEFAULT_SMS_TEMPLATES) {
    assert.doesNotThrow(() => assertTemplateContract(
      null,
      template.body,
      template.variableNames
    ));
  }
});

test('provisions templates as versioned active organization records', () => {
  const activatedAt = new Date('2026-07-29T12:00:00.000Z');
  const templates = defaultNotificationTemplates(
    'org-1',
    'owner-1',
    activatedAt
  );
  assert.equal(templates.every(({ organizationId }) => organizationId === 'org-1'), true);
  assert.equal(templates.every(({ status }) => status === 'ACTIVE'), true);
  assert.equal(templates.every(({ version }) => version === 1), true);
  assert.equal(templates.every(({ activatedBySubjectId }) => (
    activatedBySubjectId === 'owner-1'
  )), true);
});
