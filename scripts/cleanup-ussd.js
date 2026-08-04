const { prisma } = require('../utils/prisma');
const { logger } = require('../utils/logger');

async function cleanup(currentTime = new Date()) {
  const [sessions, otp, consent, reservations] = await prisma.$transaction([
    prisma.ussdSession.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lte: currentTime } },
      data: { status: 'EXPIRED', completedAt: currentTime },
    }),
    prisma.ussdOtpChallenge.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: currentTime } },
      data: { status: 'EXPIRED' },
    }),
    prisma.ussdConsentRequest.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: currentTime } },
      data: { status: 'EXPIRED' },
    }),
    prisma.rewardReservation.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lte: currentTime } },
      data: { status: 'EXPIRED' },
    }),
  ]);
  return {
    sessions: sessions.count,
    otpChallenges: otp.count,
    consentRequests: consent.count,
    rewardReservations: reservations.count,
  };
}

if (require.main === module) {
  cleanup()
    .then((counts) => logger.info('ussd.cleanup.completed', counts))
    .catch((error) => {
      logger.error('ussd.cleanup.failed', { errorName: error.name });
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { cleanup };
