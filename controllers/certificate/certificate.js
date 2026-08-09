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

async function renderCertificate(data) {
  const verificationValue = data.verificationValue || data.verificationUrl || '';
  const vaccineName = data.vaccineId || data.vaccineName || data.vaccineCode || '';
  const vaccine = data.doseNumber
    ? `${vaccineName} (Dose ${data.doseNumber})`
    : vaccineName;
  const fields = {
    fullName: data.childName || data.fullName,
    birthDate: certificateDate(data.childDOB || data.dateOfBirth),
    sex: data.sex || data.gender,
    state: data.state,
    lga: data.lga || data.localGovernmentArea,
    ward: data.ward,
    facility: data.location || data.facility || data.healthFacility,
    vaccinator: data.provider || data.vaccinator || data.healthWorker,
    vaccine,
  };

  const textOverlay = `
    <svg width="853" height="1280">
      <style>
        .value {
          fill: #10251c;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 18px;
          font-weight: 600;
        }
      </style>
      <text x="350" y="530" class="value">${escapeXml(shortValue(fields.fullName))}</text>
      <text x="350" y="582" class="value">${escapeXml(shortValue(fields.birthDate))}</text>
      <text x="350" y="634" class="value">${escapeXml(shortValue(fields.sex))}</text>
      <text x="350" y="686" class="value">${escapeXml(shortValue(fields.state))}</text>
      <text x="350" y="738" class="value">${escapeXml(shortValue(fields.lga))}</text>
      <text x="350" y="790" class="value">${escapeXml(shortValue(fields.ward))}</text>
      <text x="350" y="842" class="value">${escapeXml(shortValue(fields.facility))}</text>
      <text x="350" y="894" class="value">${escapeXml(shortValue(fields.vaccinator))}</text>
      <text x="350" y="946" class="value">${escapeXml(shortValue(fields.vaccine))}</text>
      ${verificationValue ? '<rect x="344" y="984" width="164" height="154" fill="#ffffff" />' : ''}
      <g transform="rotate(-18 426 760)" opacity="0.16">
        <text x="426" y="742" fill="#8b1a1a" font-family="Arial, Helvetica, sans-serif"
              font-size="92" font-weight="800" text-anchor="middle">DEMO</text>
        <text x="426" y="780" fill="#8b1a1a" font-family="Arial, Helvetica, sans-serif"
              font-size="20" font-weight="700" letter-spacing="2" text-anchor="middle">
          NOT AN OFFICIAL GOVERNMENT DOCUMENT
        </text>
      </g>
    </svg>`;

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
  generateCertificate,
  renderCertificate,
};
