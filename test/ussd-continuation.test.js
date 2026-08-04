const test = require('node:test');
const assert = require('node:assert/strict');
const { createUssdContinuationService } = require('../services/ussdContinuationService');

test('queues one idempotent SMS and outbox event without storing a destination', async () => {
  const writes = { messages: [], outbox: [], audits: [] };
  const transaction = {
    $executeRawUnsafe: async () => 1,
    caregiver: { findFirst: async () => ({
      id: 'caregiver-1', subjectId: null, phoneNormalized: '+2348012345678',
    }) },
    notificationMessage: {
      findUnique: async () => null,
      create: async ({ data }) => {
        writes.messages.push(data);
        return { id: 'message-1', ...data };
      },
    },
    notificationTemplate: { findFirst: async () => ({
      id: 'template-1', locale: 'ha', subject: null,
      body: '{{facilityName}} {{address}} {{phone}} {{openingHours}} {{programmes}}',
      variableNames: ['facilityName', 'address', 'phone', 'openingHours', 'programmes'],
    }) },
    outboxEvent: { create: async ({ data }) => { writes.outbox.push(data); } },
    auditEvent: { create: async ({ data }) => { writes.audits.push(data); } },
  };
  const database = { $transaction: async (callback) => callback(transaction) };
  const service = createUssdContinuationService(database);
  const result = await service.queueFacilityDetails({
    organizationId: 'org-1', caregiverId: 'caregiver-1', sessionId: 'session-1',
  }, {
    facilityName: 'Central Clinic', address: 'Main Road', phone: '0700',
    openingHours: { weekdays: '8-5' }, programmeCategories: ['VACCINATION'],
  }, 'ha');
  assert.equal(result.id, 'message-1');
  assert.equal(writes.messages[0].channel, 'SMS');
  assert.equal(writes.messages[0].recipientCaregiverId, 'caregiver-1');
  assert.equal('destination' in writes.messages[0], false);
  assert.equal('phone' in writes.messages[0], false);
  assert.equal(writes.outbox[0].eventType, 'NOTIFICATION_DISPATCH_REQUESTED');
  assert.equal(writes.audits[0].action, 'ussd.facility-details-sms-queued');
});
