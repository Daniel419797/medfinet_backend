const assert = require('node:assert/strict');
const test = require('node:test');
const {
  trackedEntityPayload,
  eventPayload,
  dhisUid,
} = require('../services/dhis2Adapter');

const mapping = {
  trackedEntityTypeId: 'Abcdefghijk',
  orgUnitId: 'Orgunit0001',
  programId: 'Program0001',
  attributeMap: {
    medfinetId: 'Attrib00001',
    firstName: 'Attrib00002',
  },
  dataElementMap: {
    vaccineCode: 'DataElem001',
    doseNumber: 'DataElem002',
  },
};

test('maps child identity and immunization into DHIS2 tracker contracts', () => {
  const child = {
    medfinetId: 'MED-1',
    firstName: 'Amina',
    lastName: 'Musa',
    dateOfBirth: new Date('2024-01-01T00:00:00.000Z'),
    sex: 'FEMALE',
  };
  const entity = trackedEntityPayload(child, mapping);
  const event = eventPayload(
    {
      vaccineCode: 'BCG',
      doseNumber: 1,
      administeredAt: new Date('2026-07-01T10:00:00.000Z'),
    },
    child,
    mapping
  );

  assert.equal(entity.trackedEntityType, 'Abcdefghijk');
  assert.equal(entity.attributes.length, 2);
  assert.equal(event.program, 'Program0001');
  assert.equal(event.dataValues.length, 2);
});

test('rejects malformed DHIS2 UIDs before making a partner request', () => {
  assert.equal(dhisUid('Abcdefghijk', 'uid'), 'Abcdefghijk');
  assert.throws(() => dhisUid('short', 'uid'), /DHIS2 UID/);
});
