const assert = require('node:assert/strict');
const test = require('node:test');
const {
  loadNfcClinicalSummary,
  consentSummary,
} = require('../services/nfcClinicalSummaryService');

test('builds an NFC clinical summary from active records only', async () => {
  const currentTime = new Date('2026-07-29T12:00:00Z');
  let immunizationQuery;
  const transaction = {
    allergyRecord: {
      async findMany() {
        return [{ id: 'a1', substanceDisplay: 'Amoxicillin', severity: 'HIGH' }];
      },
    },
    immunizationRecord: {
      async findMany(query) {
        immunizationQuery = query;
        return [{ vaccineCode: 'BCG', doseNumber: 1, administeredAt: new Date('2025-01-02') }];
      },
    },
    vaccineScheduleRule: {
      async findMany() {
        return [
          {
            id: 'r1',
            vaccineCode: 'BCG',
            doseNumber: 1,
            minimumAgeDays: 0,
            recommendedAgeDays: 0,
            maximumAgeDays: 365,
            minimumIntervalDays: null,
            version: 1,
          },
          {
            id: 'r2',
            vaccineCode: 'MEASLES',
            doseNumber: 1,
            minimumAgeDays: 270,
            recommendedAgeDays: 270,
            maximumAgeDays: 500,
            minimumIntervalDays: null,
            version: 1,
          },
        ];
      },
    },
    consentGrant: {
      async findMany() {
        return [{
          id: 'consent-1',
          status: 'ACTIVE',
          startsAt: new Date('2025-01-01'),
          expiresAt: null,
          recipientType: 'ORGANIZATION',
          recipientId: 'org-1',
          purpose: 'nfc-card-resolution',
          scopes: ['IDENTITY', 'DEMOGRAPHICS', 'IMMUNIZATION', 'CLINICAL_ALERTS']
            .map((category) => ({ category, access: 'READ' })),
        }];
      },
    },
    disclosureEvent: { async create() {} },
  };

  const result = await loadNfcClinicalSummary(
    transaction,
    'org-1',
    { id: 'child-1', dateOfBirth: new Date('2025-01-01') },
    currentTime
  );

  assert.equal(result.allergies[0].substanceDisplay, 'Amoxicillin');
  assert.equal(result.vaccination.recordedDoses, 1);
  assert.equal(result.vaccination.recommendations[0].status, 'COMPLETED');
  assert.equal(result.consent.status, 'GRANTED');
  assert.deepEqual(immunizationQuery.where, {
    organizationId: 'org-1',
    childId: 'child-1',
    status: { in: ['ACTIVE', 'AMENDED'] },
  });
});

test('does not treat expired consent as granted', () => {
  const result = consentSummary([{
    id: 'consent-1',
    status: 'ACTIVE',
    startsAt: new Date('2025-01-01'),
    expiresAt: new Date('2025-02-01'),
    scopes: ['IDENTITY', 'DEMOGRAPHICS', 'IMMUNIZATION', 'CLINICAL_ALERTS']
      .map((category) => ({ category, access: 'READ' })),
  }], new Date('2026-01-01'));
  assert.equal(result.status, 'NOT_RECORDED');
});
