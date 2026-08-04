const { prisma } = require('../utils/prisma');
const { createNfcLifecycleService } = require('../services/nfcLifecycleService');
const { logger } = require('../utils/logger');

async function main() {
  const results = await createNfcLifecycleService(prisma).cleanupAll();
  const totals = results.reduce(
    (sum, item) => ({
      organizations: sum.organizations + 1,
      expiredBindings: sum.expiredBindings + item.expiredBindings,
      revokedCredentials: sum.revokedCredentials + item.revokedCredentials,
      removedRoutes: sum.removedRoutes + item.removedRoutes,
      expiredChallenges: sum.expiredChallenges + item.expiredChallenges,
    }),
    {
      organizations: 0,
      expiredBindings: 0,
      revokedCredentials: 0,
      removedRoutes: 0,
      expiredChallenges: 0,
    }
  );
  logger.info('NFC lifecycle cleanup completed', totals);
}

main()
  .catch((error) => {
    logger.error('NFC lifecycle cleanup failed', {
      name: error.name,
      message: error.message,
    });
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
