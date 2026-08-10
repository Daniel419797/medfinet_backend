const { DomainError } = require('../utils/domainError');
const CertificateNftRepository = require('./certificateNftRepository');
const { withTenantTransaction } = require('./tenantContext');

class DurableCertificateNftRepository {
  constructor(database, organizationId) {
    if (!database || typeof database.$transaction !== 'function') {
      throw new Error('DurableCertificateNftRepository requires a Prisma database client');
    }
    if (!organizationId) {
      throw new Error('DurableCertificateNftRepository requires an organization ID');
    }
    this._database = database;
    this._organizationId = organizationId;
  }

  _assertOrganization(organizationId) {
    if (organizationId !== this._organizationId) {
      throw new DomainError(
        409,
        'CERTIFICATE_NFT_TENANT_MISMATCH',
        'Certificate NFT receipt access crossed an organization boundary',
      );
    }
  }

  async _run(operation) {
    return withTenantTransaction(
      this._database,
      this._organizationId,
      async (transaction) => operation(new CertificateNftRepository(transaction)),
    );
  }

  async findByProofId(organizationId, proofId) {
    this._assertOrganization(organizationId);
    return this._run((repository) =>
      repository.findByProofId(organizationId, proofId));
  }

  async createPending(intent) {
    this._assertOrganization(intent?.organizationId);
    return this._run((repository) => repository.createPending(intent));
  }

  async confirm(organizationId, proofId, txId, confirmation) {
    this._assertOrganization(organizationId);
    return this._run((repository) =>
      repository.confirm(organizationId, proofId, txId, confirmation));
  }
}

module.exports = DurableCertificateNftRepository;
