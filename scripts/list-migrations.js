require('dotenv').config();
const { prisma } = require('../utils/prisma');
async function main() {
  const applied = await prisma.$queryRawUnsafe(`SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at`);
  console.log('APPLIED MIGRATIONS:', applied.map((r) => r.migration_name).join('\n'));
  await prisma.$disconnect();
  process.exit(0);
}
main().catch(async (e) => { console.error('FAIL:', e.message); await prisma.$disconnect(); process.exit(1); });
