const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const {
  CERTIFICATE_TEMPLATE_PATH,
  buildTextOverlay,
  renderCertificate,
} = require('../controllers/certificate/certificate');

const sample = {
  childName: 'James New',
  childDOB: '2025-08-09T00:00:00.000Z',
  sex: 'MALE',
  state: 'Lagos',
  location: 'Dennis Primary Health Centre',
  vaccineCode: '123',
  doseNumber: 1,
};

test('certificate overlay contains human-readable record values', () => {
  const overlay = buildTextOverlay(sample);

  assert.match(overlay, />James New<\/text>/);
  assert.match(overlay, />09 Aug 2025<\/text>/);
  assert.match(overlay, />Male<\/text>/);
  assert.match(overlay, />Lagos<\/text>/);
  assert.match(overlay, />Dennis Primary Health Centre<\/text>/);
  assert.match(overlay, />123 \(Dose 1\)<\/text>/);
  assert.match(overlay, />Not recorded<\/text>/);
  assert.doesNotMatch(overlay, /class="value"/);
});

test('rendered certificate changes pixels in the full-name field', async () => {
  const rendered = await renderCertificate(sample);
  const region = { left: 340, top: 500, width: 460, height: 55 };

  const [templatePixels, renderedPixels] = await Promise.all([
    sharp(CERTIFICATE_TEMPLATE_PATH).extract(region).raw().toBuffer(),
    sharp(rendered).extract(region).raw().toBuffer(),
  ]);

  assert.notEqual(
    Buffer.compare(templatePixels, renderedPixels),
    0,
    'the full-name row should contain rendered record text',
  );
});
