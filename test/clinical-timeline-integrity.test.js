const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createClinicalTimelineService,
} = require('../services/clinicalTimelineService');

test('does not expose the internal immunization deduplication key', async () => {
  const emptyRecords = { async findMany() { return []; } };
  const transaction = {
    async $executeRawUnsafe() {},
    child: { async findFirst() { return { id: 'child-1' }; } },
    immunizationRecord: {
      async findMany() {
        return [{
          id: 'immunization-1',
          vaccineCode: 'BCG',
          deduplicationKey: 'internal-integrity-key',
        }];
      },
    },
    growthMeasurement: emptyRecords,
    clinicalAlert: emptyRecords,
    allergyRecord: emptyRecords,
    appointment: emptyRecords,
    auditEvent: { async create() {} },
  };
  const database = {
    async $transaction(operation) {
      return operation(transaction);
    },
  };

  const timeline = await createClinicalTimelineService(database).get(
    {
      organizationId: 'org-1',
      actorSubjectId: 'worker-1',
      purpose: 'clinical-care',
    },
    'child-1'
  );

  assert.equal(timeline.immunizations[0].id, 'immunization-1');
  assert.equal(timeline.immunizations[0].deduplicationKey, undefined);
});
