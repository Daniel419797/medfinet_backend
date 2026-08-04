const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');

const UPSERT_BUCKET_SQL = `
  INSERT INTO "security_rate_limit_buckets"
    ("scope", "keyHash", "windowStart", "requestCount", "expiresAt")
  VALUES ($1, $2, $3, 1, $4)
  ON CONFLICT ("scope", "keyHash", "windowStart")
  DO UPDATE SET "requestCount" =
    "security_rate_limit_buckets"."requestCount" + 1
  RETURNING "requestCount"
`;

function hashRateLimitKey(pepper, value) {
  return crypto.createHmac('sha256', pepper).update(value).digest('hex');
}

function createRateLimitMiddleware(
  {
    scope,
    limit,
    windowMs,
    key = (req) => req.ip,
  },
  {
    prismaClient,
    pepper,
    now = () => new Date(),
  } = {}
) {
  if (
    !/^[a-z][a-z0-9:-]{1,79}$/.test(scope)
    || !Number.isInteger(limit)
    || limit < 1
    || !Number.isInteger(windowMs)
    || windowMs < 1000
  ) {
    throw new Error('Rate limit configuration is invalid');
  }
  const database = prismaClient || require('../utils/prisma').prisma;
  const secret = pepper || require('../config').security.rateLimitKeyPepper;

  return async function rateLimit(req, res, next) {
    try {
      const currentTime = now();
      const startMs = Math.floor(currentTime.getTime() / windowMs) * windowMs;
      const windowStart = new Date(startMs);
      const expiresAt = new Date(startMs + windowMs);
      const rawKey = String(key(req) || 'unknown');
      const keyHash = hashRateLimitKey(secret, `${scope}:${rawKey}`);
      const rows = await database.$queryRawUnsafe(
        UPSERT_BUCKET_SQL,
        scope,
        keyHash,
        windowStart,
        expiresAt
      );
      const requestCount = Number(rows[0].requestCount);
      const remaining = Math.max(0, limit - requestCount);
      res.set('RateLimit-Limit', String(limit));
      res.set('RateLimit-Remaining', String(remaining));
      res.set('RateLimit-Reset', String(Math.ceil(expiresAt.getTime() / 1000)));
      if (requestCount > limit) {
        res.set(
          'Retry-After',
          String(Math.ceil((expiresAt.getTime() - currentTime.getTime()) / 1000))
        );
        return next(new DomainError(
          429,
          'RATE_LIMIT_EXCEEDED',
          'Too many requests; retry after the current limit window'
        ));
      }
      return next();
    } catch (error) {
      if (error instanceof DomainError) return next(error);
      return next(new DomainError(
        503,
        'RATE_LIMIT_SERVICE_UNAVAILABLE',
        'Request protection is temporarily unavailable'
      ));
    }
  };
}

module.exports = {
  createRateLimitMiddleware,
  hashRateLimitKey,
  UPSERT_BUCKET_SQL,
};
