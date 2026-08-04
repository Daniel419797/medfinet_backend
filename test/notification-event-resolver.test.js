const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createNotificationEventResolver,
  caregiverRecipient,
} = require('../services/notificationEventResolver');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

const context = {
  organizationId: 'org-1',
  actorSubjectId: 'system:worker',
  purpose: 'background-processing',
};

test('does not address caregivers without an authenticated subject', () => {
  assert.deepEqual(caregiverRecipient({ id: 'caregiver-1', subjectId: null }), []);
  assert.deepEqual(
    caregiverRecipient({ id: 'caregiver-1', subjectId: 'subject-1' }),
    [{ caregiverId: 'caregiver-1', subjectId: 'subject-1' }]
  );
});

test('resolves appointment notifications without child identity or clinical notes', async () => {
  const transaction = {
    async $executeRawUnsafe() {},
    appointment: {
      async findFirst() {
        return {
          kind: 'Routine follow-up',
          status: 'SCHEDULED',
          scheduledFor: new Date('2026-08-01T10:00:00.000Z'),
          facility: { name: 'Central Clinic' },
          child: {
            caregivers: [{
              caregiver: { id: 'caregiver-1', subjectId: 'subject-1' },
            }],
          },
        };
      },
    },
  };
  const resolver = createNotificationEventResolver(
    databaseWithTransaction(transaction)
  );
  const specification = await resolver.resolve(context, {
    eventType: 'APPOINTMENT_SCHEDULED',
    payload: { appointmentId: 'appointment-1' },
  });

  assert.equal(specification.templateKey, 'APPOINTMENT_SCHEDULED');
  assert.equal(specification.variables.facilityName, 'Central Clinic');
  assert.equal(JSON.stringify(specification).includes('child'), false);
  assert.equal(JSON.stringify(specification).includes('notes'), false);
});

test('notifies only the primary consent-authority caregiver for emergency access', async () => {
  let caregiverWhere;
  const transaction = {
    async $executeRawUnsafe() {},
    emergencyAccess: {
      async findFirst({ include }) {
        caregiverWhere = include.child.include.caregivers.where;
        return {
          reasonCode: 'FLOOD_DISPLACEMENT',
          expiresAt: new Date('2026-07-29T12:15:00.000Z'),
          child: {
            caregivers: [{
              caregiver: { id: 'caregiver-1', subjectId: 'subject-1' },
            }],
          },
        };
      },
    },
  };
  const resolver = createNotificationEventResolver(
    databaseWithTransaction(transaction)
  );
  const specification = await resolver.resolve(context, {
    eventType: 'EMERGENCY_ACCESS_ACTIVATED',
    payload: { emergencyAccessId: 'access-1' },
  });

  assert.deepEqual(caregiverWhere, {
    isPrimary: true,
    hasConsentAuthority: true,
  });
  assert.equal(specification.category, 'SECURITY');
  assert.equal(specification.recipients.length, 1);
});
