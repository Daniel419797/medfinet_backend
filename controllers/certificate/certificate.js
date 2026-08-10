const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const QRCode = require('qrcode');

const CERTIFICATE_TEMPLATE_PATH = path.join(
  __dirname,
  'assets',
  'official-vaccination-record.png',
);

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function shortValue(value, maximumLength = 38) {
  const text = String(value ?? '').trim();
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, maximumLength - 1)}…`;
}

function certificateDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return shortValue(value);
  return date.toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function humanize(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function visibleValue(value) {
  const text = shortValue(value);
  return text || 'Not recorded';
}

function fieldText(y, value) {
  return `
    <text x="350" y="${y}" fill="#10251c"
          font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
          font-size="18" font-weight="700">${escapeXml(visibleValue(value))}</text>`;
}

function buildTextOverlay(data) {
  const verificationValue = data.verificationValue || data.verificationUrl || '';
  const vaccineName = data.vaccineId || data.vaccineName || data.vaccineCode || '';
  const vaccine = data.doseNumber
    ? `${vaccineName} (Dose ${data.doseNumber})`
    : vaccineName;
  const fields = {
    fullName: data.childName || data.fullName,
    birthDate: certificateDate(data.childDOB || data.dateOfBirth),
    sex: humanize(data.sex || data.gender),
    state: data.state,
    lga: data.lga || data.localGovernmentArea,
    ward: data.ward,
    facility: data.location || data.facility || data.healthFacility,
    vaccinator: data.provider || data.vaccinator || data.healthWorker,
    vaccine,
  };

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="853" height="1280" viewBox="0 0 853 1280">
      ${fieldText(530, fields.fullName)}
      ${fieldText(582, fields.birthDate)}
      ${fieldText(634, fields.sex)}
      ${fieldText(686, fields.state)}
      ${fieldText(738, fields.lga)}
      ${fieldText(790, fields.ward)}
      ${fieldText(842, fields.facility)}
      ${fieldText(894, fields.vaccinator)}
      ${fieldText(946, fields.vaccine)}
      ${verificationValue ? '<rect x="344" y="984" width="164" height="154" fill="#ffffff" />' : ''}
      ${verificationValue ? `
        <rect x="180" y="1148" width="493" height="48" fill="#ffffff" opacity="0.96" />
        <text x="426" y="1168" fill="#064e3b" font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
              font-size="13" font-weight="800" text-anchor="middle" letter-spacing="1">
          SCAN TO CHECK CERTIFICATE EVIDENCE
        </text>
        <text x="426" y="1187" fill="#334155" font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
              font-size="11" text-anchor="middle">
          Evidence may be pending; no identity or medical data is made public.
        </text>
      ` : ''}
      <g transform="rotate(-18 426 760)" opacity="0.16">
        <text x="426" y="742" fill="#8b1a1a" font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
              font-size="92" font-weight="800" text-anchor="middle">DEMO</text>
        <text x="426" y="780" fill="#8b1a1a" font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
              font-size="20" font-weight="700" letter-spacing="2" text-anchor="middle">
          NOT AN OFFICIAL GOVERNMENT DOCUMENT
        </text>
      </g>
    </svg>`;
}

async function renderCertificate(data) {
  const verificationValue = data.verificationValue || data.verificationUrl || '';
  const textOverlay = buildTextOverlay(data);
  const composites = [{ input: Buffer.from(textOverlay), top: 0, left: 0 }];

  if (verificationValue) {
    const qrCodeBuffer = await QRCode.toBuffer(verificationValue, {
      width: 154,
      margin: 1,
      color: { dark: '#07120d', light: '#ffffff' },
    });
    composites.push({ input: qrCodeBuffer, top: 984, left: 349 });
  }

  return sharp(CERTIFICATE_TEMPLATE_PATH)
    .composite(composites)
    .png()
    .toBuffer();
}

async function generateCertificate(data, outputPath = 'certificate.png') {
  const certificate = await renderCertificate(data);
  await fs.promises.writeFile(outputPath, certificate, { flag: 'w' });
  return outputPath;
}

module.exports = {
  CERTIFICATE_TEMPLATE_PATH,
  buildTextOverlay,
  generateCertificate,
  renderCertificate,
};
