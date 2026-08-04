require('dotenv').config();
const { prisma } = require('../utils/prisma');
console.log('URL host:', process.env.DATABASE_URL.split('@')[1].split('/')[0]);

async function main() {
  const scope = 'test-scope';
  const keyHash = 'test-hash-123';
  const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000);
  const expiresAt = new Date(windowStart.getTime() + 60000);
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "security_rate_limit_buckets"
      ("scope", "keyHash", "windowStart", "requestCount", "expiresAt")
    VALUES ($1, $2, $3, 1, $4)
    ON CONFLICT ("scope", "keyHash", "windowStart")
    DO UPDATE SET "requestCount" = "security_rate_limit_buckets"."requestCount" + 1
    RETURNING "requestCount"`,
    scope, keyHash, windowStart, expiresAt
  );
  console.log('RATE_LIMIT_QUERY_OK count=', rows[0].requestCount);
  await prisma.$disconnect();
  process.exit(0);
}
main().catch(async (e) => {
  console.error('RATE_LIMIT_QUERY_FAIL:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
