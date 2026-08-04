const { DomainError } = require('../utils/domainError');

async function withTenantTransaction(prismaClient, organizationId, operation) {
  if (!organizationId || typeof organizationId !== 'string') {
    throw new DomainError(400, 'ORGANIZATION_REQUIRED', 'An organization context is required');
  }

  return prismaClient.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT set_config('app.current_organization_id', $1, true)",
      organizationId
    );
    return operation(transaction);
  });
}

module.exports = { withTenantTransaction };
