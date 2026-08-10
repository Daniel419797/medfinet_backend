const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const {
  CERTIFICATE_TEMPLATE_PATH,
  buildTextOverlay,
  normalizeBitmapText,
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

test('normalizes certificate values for the embedded bitmap glyph set', () => {
  assert.equal(normalizeBitmapText('James New'), 'JAMES NEW');
  assert.equal(normalizeBitmapText('09 Aug 2025'), '09 AUG 2025');
  assert.equal(normalizeBitmapText('Lágos'), 'LAGOS');
  assert.equal(normalizeBitmapText(''), 'NOT RECORDED');
});

test('certificate overlay renders without any font-dependent SVG text elements', () => {
  const overlay = buildTextOverlay(sample);

  assert.doesNotMatch(overlay, /<text\b/i);
  assert.match(overlay, /<rect\b/i);
});

test('rendered certificate changes pixels in all core record rows', async () => {
  const rendered = await renderCertificate(sample);
  const rows = [514, 566, 618, 670, 826, 930];

  for (const top of rows) {
    const region = { left: 340, top, width: 440, height: 24 };
    const [templatePixels, renderedPixels] = await Promise.all([
      sharp(CERTIFICATE_TEMPLATE_PATH).extract(region).raw().toBuffer(),
      sharp(rendered).extract(region).raw().toBuffer(),
    ]);

    assert.notEqual(
      Buffer.compare(templatePixels, renderedPixels),
      0,
      `certificate row at y=${top} should contain rendered bitmap text`,
    );
  }
});
