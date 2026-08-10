const { DomainError } = require('../utils/domainError');

async function withTenantTransaction(
  prismaClient,
  organizationId,
  operation,
  options = {}
) {
  if (!organizationId || typeof organizationId !== 'string') {
    throw new DomainError(400, 'ORGANIZATION_REQUIRED', 'An organization context is required');
  }

  const run = async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT set_config('app.current_organization_id', $1, true)",
      organizationId
    );
    return operation(transaction);
  };

  if (options.isolationLevel) {
    return prismaClient.$transaction(run, {
      isolationLevel: options.isolationLevel,
    });
  }
  return prismaClient.$transaction(run);
}

module.exports = { withTenantTransaction };
