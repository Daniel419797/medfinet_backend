const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const { audit } = require('./clinicalValidation');
const { requiredText } = require('./identityService');
const { safeBinding } = require('./nfcBindingView');

function createNfcLifecycleService(
  prismaClient,
  { now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;

  async function get(context, bindingId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const binding = await transaction.nfcCredentialBinding.findFirst({
        where: { id: bindingId, organizationId: context.organizationId },
        include: {
          credential: {
            select: {
              id: true,
              childId: true,
              kind: true,
              status: true,
              expiresAt: true,
              createdAt: true,
            },
          },
        },
      });
      if (!binding) {
        throw new DomainError(404, 'NFC_BINDING_NOT_FOUND', 'NFC binding not found');
      }
      return safeBinding(binding);
    });
  }

  async function cancel(context, bindingId, input = {}) {
    const reason = requiredText(input.reason, 'reason', 500);
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const binding = await transaction.nfcCredentialBinding.findFirst({
        where: {
          id: bindingId,
          organizationId: context.organizationId,
          status: 'PENDING',
        },
        include: { credential: true },
      });
      if (!binding) {
        throw new DomainError(
          404,
          'PENDING_NFC_BINDING_NOT_FOUND',
          'Pending NFC provisioning record not found'
        );
      }
      const failedAt = now();
      const [cancelled] = await Promise.all([
        transaction.nfcCredentialBinding.update({
          where: { id: binding.id },
          data: { status: 'FAILED', failedAt, failureReason: reason },
        }),
        transaction.childCredential.update({
          where: { id: binding.credentialId },
          data: { status: 'REVOKED', revokedAt: failedAt, revokedReason: reason },
        }),
        transaction.nfcPublicRoute.deleteMany({
          where: { publicId: binding.publicId, bindingId: binding.id },
        }),
        transaction.auditEvent.create({
          data: audit(context, 'nfc.provisioning-cancelled', 'nfc-binding', binding.id, {
            childId: binding.credential.childId,
            credentialId: binding.credentialId,
            reason,
          }),
        }),
      ]);
      return safeBinding(cancelled);
    });
  }

  async function listForChild(context, childId) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const bindings = await transaction.nfcCredentialBinding.findMany({
        where: {
          organizationId: context.organizationId,
          credential: { childId },
        },
        include: {
          credential: {
            select: {
              id: true,
              childId: true,
              status: true,
              expiresAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return bindings.map(safeBinding);
    });
  }

  async function operationsSummary(context) {
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      const since = new Date(now().getTime() - 24 * 60 * 60 * 1000);
      const [bindings, pendingChallenges, scanOutcomes] = await Promise.all([
        transaction.nfcCredentialBinding.groupBy({
          by: ['status'],
          where: { organizationId: context.organizationId },
          _count: { _all: true },
        }),
        transaction.nfcScanChallenge.count({
          where: {
            organizationId: context.organizationId,
            status: 'PENDING',
            expiresAt: { gt: now() },
          },
        }),
        transaction.credentialScan.groupBy({
          by: ['outcome'],
          where: {
            organizationId: context.organizationId,
            scannedAt: { gte: since },
            outcome: { startsWith: 'NTAG215_' },
          },
          _count: { _all: true },
        }),
      ]);
      return {
        generatedAt: now(),
        bindings: Object.fromEntries(
          bindings.map(({ status, _count }) => [status, _count._all])
        ),
        pendingChallenges,
        scansLast24Hours: Object.fromEntries(
          scanOutcomes.map(({ outcome, _count }) => [outcome, _count._all])
        ),
      };
    });
  }

  async function expireOrganization(organizationId) {
    const currentTime = now();
    return withTenantTransaction(database, organizationId, async (transaction) => {
      const expiredBindings = await transaction.nfcCredentialBinding.findMany({
        where: {
          organizationId,
          status: 'PENDING',
          provisioningExpiresAt: { lte: currentTime },
        },
        select: { id: true, credentialId: true, publicId: true },
        take: 500,
      });
      const bindingIds = expiredBindings.map(({ id }) => id);
      const credentialIds = expiredBindings.map(({ credentialId }) => credentialId);
      const publicIds = expiredBindings.map(({ publicId }) => publicId);
      const [bindings, credentials, routes, challenges] = await Promise.all([
        bindingIds.length
          ? transaction.nfcCredentialBinding.updateMany({
            where: { id: { in: bindingIds }, organizationId, status: 'PENDING' },
            data: {
              status: 'FAILED',
              failedAt: currentTime,
              failureReason: 'Provisioning authorization expired',
            },
          })
          : { count: 0 },
        credentialIds.length
          ? transaction.childCredential.updateMany({
            where: { id: { in: credentialIds }, organizationId, status: 'ACTIVE' },
            data: {
              status: 'REVOKED',
              revokedAt: currentTime,
              revokedReason: 'NFC provisioning expired',
            },
          })
          : { count: 0 },
        publicIds.length
          ? transaction.nfcPublicRoute.deleteMany({
            where: { publicId: { in: publicIds }, organizationId },
          })
          : { count: 0 },
        transaction.nfcScanChallenge.updateMany({
          where: {
            organizationId,
            status: 'PENDING',
            expiresAt: { lte: currentTime },
          },
          data: { status: 'EXPIRED' },
        }),
      ]);
      return {
        organizationId,
        expiredBindings: bindings.count,
        revokedCredentials: credentials.count,
        removedRoutes: routes.count,
        expiredChallenges: challenges.count,
      };
    });
  }

  async function cleanupAll() {
    const routes = await database.nfcPublicRoute.findMany({
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    const results = [];
    for (const { organizationId } of routes) {
      results.push(await expireOrganization(organizationId));
    }
    return results;
  }

  return {
    get,
    cancel,
    listForChild,
    operationsSummary,
    expireOrganization,
    cleanupAll,
  };
}

module.exports = { createNfcLifecycleService, safeBinding };
