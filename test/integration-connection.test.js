const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createIntegrationConnectionService,
} = require('../services/integrationConnectionService');

function databaseWithTransaction(transaction) {
  return {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
}

const context = {
  organizationId: 'org-1',
  actorSubjectId: 'admin-1',
  purpose: 'integration-administration',
};

test('creates a connection with only a managed-secret reference', async () => {
  let createData;
  const tx = {
    async $executeRawUnsafe() {},
    integrationConnection: {
      async create({ data }) {
        createData = data;
        return { id: 'connection-1', status: 'DRAFT', ...data };
      },
    },
    auditEvent: { async create() {} },
  };
  const service = createIntegrationConnectionService(
    databaseWithTransaction(tx),
    {
      allowedHosts: ['fhir.example.com'],
      allowInsecureLocalhost: false,
    }
  );

  const connection = await service.createConnection(context, {
    name: 'National FHIR Gateway',
    partnerIdentifier: 'national-fhir',
    type: 'FHIR_R4',
    baseUrl: 'https://fhir.example.com/r4',
    authType: 'BEARER',
    credentialSecretName: 'NATIONAL_FHIR_TOKEN',
    fhirVersion: '4.0.1',
    allowedDataCategories: ['IDENTITY', 'DEMOGRAPHICS'],
  });

  assert.equal(connection.id, 'connection-1');
  assert.equal(createData.credentialSecretName, 'NATIONAL_FHIR_TOKEN');
  assert.equal(JSON.stringify(createData).includes('secret-token'), false);
});

test('requires a recent healthy check before activating a connection', async () => {
  const tx = {
    async $executeRawUnsafe() {},
    integrationConnection: {
      async findFirst() {
        return null;
      },
    },
  };
  const service = createIntegrationConnectionService(
    databaseWithTransaction(tx),
    {
      now: () => new Date('2026-07-29T12:00:00.000Z'),
      allowedHosts: ['fhir.example.com'],
      allowInsecureLocalhost: false,
    }
  );

  await assert.rejects(
    service.activate(context, 'connection-1'),
    (error) => error.code === 'HEALTHY_INTEGRATION_CONNECTION_REQUIRED'
  );
});
