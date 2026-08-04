require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('hospitals','health_workers','telemedicine_doctors','insurance_policies','invoices','design_templates','certificates','health_packages') ORDER BY table_name")
  .then(async (r) => {
    console.log('Tables found:', r.map((x) => x.table_name).join(', ') || '(none)');
    await p.$disconnect();
  })
  .catch(async (e) => { console.error('ERR', e.message); await p.$disconnect(); process.exit(1); });
