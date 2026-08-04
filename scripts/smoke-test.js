require('dotenv').config();
const app = require('../app');

async function getJson(url) {
  try {
    const r = await fetch(url);
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  } catch (e) {
    return { status: 'ERR', body: e.message };
  }
}

const srv = app.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}/api/v1`;
  console.log('LISTEN_OK');
  for (const [label, path] of [
    ['hospitals', '/hospitals'],
    ['healthWorkers', '/health-workers'],
    ['doctors', '/telemedicine/doctors'],
    ['insurance-policies', '/insurance/policies'],
    ['invoice-marketplace', '/invoices/marketplace'],
    ['design-templates', '/designs/templates'],
    ['design-categories', '/designs/categories'],
    ['health-packages', '/campaigns/health-packages'],
    ['campaigns', '/campaigns'],
  ]) {
    const { status, body } = await getJson(base + path);
    const count = Array.isArray(body.data) ? body.data.length
      : body.total != null ? body.total
      : Array.isArray(body) ? body.length
      : body.count != null ? body.count
      : body.error || body.message || '?';
    console.log(`${label}: ${status} ${JSON.stringify(count)}`);
  }
  srv.close();
  process.exit(0);
}).on('error', (e) => { console.error('BOOT_FAIL', e.message); process.exit(1); });
