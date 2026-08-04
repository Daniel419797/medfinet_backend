const { createIntegrationHttpClient } = require('./integrationHttpClient');
const { createFhirR4Adapter } = require('./fhirR4Adapter');
const { createDhis2Adapter } = require('./dhis2Adapter');

function createIntegrationAdapters(options = {}) {
  const config = require('../config').integrations;
  const httpClient = createIntegrationHttpClient({
    resolveCredential: options.resolveCredential || config.resolveCredential,
    allowedHosts: options.allowedHosts || config.allowedHosts,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });
  return {
    FHIR_R4: createFhirR4Adapter(httpClient),
    DHIS2: createDhis2Adapter(httpClient),
  };
}

function createIntegrationHealthChecker(adapters) {
  return async function healthChecker(connection) {
    const adapter = adapters[connection.type];
    if (!adapter) {
      return { status: 'UNREACHABLE', errorCode: 'INTEGRATION_ADAPTER_UNAVAILABLE' };
    }
    return adapter.health(connection);
  };
}

module.exports = {
  createIntegrationAdapters,
  createIntegrationHealthChecker,
};
