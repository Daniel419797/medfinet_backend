const assert = require('node:assert/strict');
const test = require('node:test');
const {
  hour,
  timezone,
  canManage,
} = require('../services/notificationPreferenceService');

test('validates quiet hours and IANA timezones', () => {
  assert.equal(hour('22', 'quietHoursStart'), 22);
  assert.equal(timezone('Africa/Lagos'), 'Africa/Lagos');
  assert.throws(() => hour(24, 'quietHoursStart'), /between 0 and 23/);
  assert.throws(() => timezone('Invalid/Timezone'), /timezone is invalid/);
});

test('limits preference management to the subject or administrators', () => {
  assert.equal(
    canManage({ actorSubjectId: 'subject-1', role: 'CAREGIVER' }, 'subject-1'),
    true
  );
  assert.equal(
    canManage({ actorSubjectId: 'subject-2', role: 'CAREGIVER' }, 'subject-1'),
    false
  );
  assert.equal(
    canManage({ actorSubjectId: 'admin-1', role: 'ADMIN' }, 'subject-1'),
    true
  );
});
