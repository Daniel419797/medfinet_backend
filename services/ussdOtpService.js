const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const { withTenantTransaction } = require('./tenantContext');
const {
  actionDigest,
  generateOtp,
  otpDigest,
  secureEquals,
} = require('./ussdSecurity');

function createUssdOtpService(
  prismaClient,
  { config: configOverride, deliver, now = () => new Date() } = {}
) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const settings = configOverride || require('../config').ussd;
  const deliverOtp = deliver || (async () => {
    throw new DomainError(503, 'USSD_OTP_DELIVERY_UNAVAILABLE', 'OTP delivery is unavailable');
  });

  async function issue(context, purpose, action) {
    const challengeId = crypto.randomUUID();
    const code = generateOtp();
    const digest = actionDigest(action, settings.otpPepper);
    const currentTime = now();
    const expiresAt = new Date(currentTime.getTime() + settings.otpTtlSeconds * 1000);
    const challenge = await withTenantTransaction(
      database,
      context.organizationId,
      async (transaction) => {
        const replay = await transaction.ussdOtpChallenge.findUnique({
          where: { sourceSessionId: context.sessionId },
        });
        if (replay) {
          if (replay.organizationId !== context.organizationId
            || replay.caregiverId !== context.caregiverId
            || replay.purpose !== purpose || replay.actionDigest !== digest) {
            throw new DomainError(409, 'USSD_IDEMPOTENCY_CONFLICT', 'Session OTP does not match its recorded action');
          }
          return { ...replay, replay: true, phone: null };
        }
        const caregiver = await transaction.caregiver.findFirst({
          where: {
            id: context.caregiverId,
            organizationId: context.organizationId,
            phoneVerifiedAt: { not: null },
          },
          select: { id: true, phoneNormalized: true },
        });
        if (!caregiver?.phoneNormalized) {
          throw new DomainError(403, 'VERIFIED_PHONE_REQUIRED', 'A verified phone is required');
        }
        await transaction.ussdOtpChallenge.updateMany({
          where: {
            organizationId: context.organizationId,
            caregiverId: context.caregiverId,
            purpose,
            status: 'PENDING',
          },
          data: { status: 'EXPIRED' },
        });
        const created = await transaction.ussdOtpChallenge.create({
          data: {
            id: challengeId,
            organizationId: context.organizationId,
            caregiverId: context.caregiverId,
            purpose,
            codeHash: otpDigest(challengeId, purpose, code, settings.otpPepper),
            actionDigest: digest,
            sourceSessionId: context.sessionId,
            expiresAt,
          },
        });
        return { ...created, phone: caregiver.phoneNormalized };
      }
    );
    if (challenge.replay) {
      return {
        challengeId: challenge.id,
        expiresAt: challenge.expiresAt,
        idempotentReplay: true,
      };
    }
    try {
      await deliverOtp({
        phone: challenge.phone,
        code,
        purpose,
        expiresAt,
        idempotencyKey: `ussd-otp:${challenge.id}`,
      });
    } catch (error) {
      await withTenantTransaction(database, context.organizationId, (transaction) => (
        transaction.ussdOtpChallenge.update({
          where: { id: challenge.id },
          data: { status: 'BLOCKED' },
        })
      ));
      if (error instanceof DomainError) throw error;
      throw new DomainError(503, 'USSD_OTP_DELIVERY_FAILED', 'OTP could not be delivered');
    }
    return { challengeId: challenge.id, expiresAt };
  }

  async function verify(context, challengeId, purpose, action, code) {
    const currentTime = now();
    return withTenantTransaction(database, context.organizationId, async (transaction) => {
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "ussd_otp_challenges" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
        challengeId,
        context.organizationId
      );
      const challenge = await transaction.ussdOtpChallenge.findFirst({
        where: {
          id: challengeId,
          organizationId: context.organizationId,
          caregiverId: context.caregiverId,
          purpose,
          status: { in: ['PENDING', 'CONSUMED'] },
        },
      });
      if (!challenge || (challenge.status === 'PENDING' && challenge.expiresAt <= currentTime)) {
        throw new DomainError(401, 'USSD_OTP_EXPIRED', 'Verification code is invalid or expired');
      }
      const expectedAction = actionDigest(action, settings.otpPepper);
      let candidate;
      try {
        candidate = otpDigest(challenge.id, purpose, code, settings.otpPepper);
      } catch {
        candidate = '';
      }
      if (
        !secureEquals(challenge.actionDigest, expectedAction)
        || !secureEquals(challenge.codeHash, candidate)
      ) {
        if (challenge.status === 'CONSUMED') {
          throw new DomainError(401, 'USSD_OTP_INCORRECT', 'Verification code is incorrect');
        }
        const attempts = challenge.attempts + 1;
        await transaction.ussdOtpChallenge.update({
          where: { id: challenge.id },
          data: {
            attempts: Math.min(attempts, challenge.maxAttempts),
            ...(attempts >= challenge.maxAttempts ? { status: 'BLOCKED' } : {}),
          },
        });
        throw new DomainError(401, 'USSD_OTP_INCORRECT', 'Verification code is incorrect');
      }
      if (challenge.status === 'CONSUMED') {
        return { assurance: 'OTP', verifiedAt: challenge.consumedAt, idempotentReplay: true };
      }
      await transaction.ussdOtpChallenge.update({
        where: { id: challenge.id },
        data: { status: 'CONSUMED', consumedAt: currentTime },
      });
      return { assurance: 'OTP', verifiedAt: currentTime };
    });
  }

  return { issue, verify };
}

module.exports = { createUssdOtpService };
