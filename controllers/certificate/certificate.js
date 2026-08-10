const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const QRCode = require('qrcode');

const CERTIFICATE_TEMPLATE_PATH = path.join(
  __dirname,
  'assets',
  'official-vaccination-record.png',
);

const FONT_5X7 = Object.freeze({
  ' ': [0, 0, 0, 0, 0, 0, 0],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [31, 4, 4, 4, 4, 4, 31],
  J: [7, 2, 2, 2, 18, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 17, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14],
  1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 2, 4, 8, 31],
  3: [30, 1, 1, 14, 1, 1, 30],
  4: [2, 6, 10, 18, 31, 2, 2],
  5: [31, 16, 16, 30, 1, 1, 30],
  6: [14, 16, 16, 30, 17, 17, 14],
  7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 1, 14],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '/': [1, 2, 4, 8, 16, 0, 0],
  '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8],
  '.': [0, 0, 0, 0, 0, 12, 12],
  ',': [0, 0, 0, 0, 0, 4, 8],
  ':': [0, 4, 4, 0, 4, 4, 0],
  "'": [4, 4, 8, 0, 0, 0, 0],
  '&': [12, 18, 20, 8, 21, 18, 13],
  '?': [14, 17, 1, 2, 4, 0, 4],
  '#': [10, 31, 10, 10, 31, 10, 0],
  '+': [0, 4, 4, 31, 4, 4, 0],
  '_': [0, 0, 0, 0, 0, 0, 31],
});

function shortValue(value, maximumLength = 38) {
  const text = String(value ?? '').trim();
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, Math.max(0, maximumLength - 3))}...`;
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

function normalizeBitmapText(value, maximumLength = 38, fallback = 'NOT RECORDED') {
  const raw = shortValue(value, maximumLength)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  const text = raw || fallback;
  return Array.from(text)
    .map((character) => (FONT_5X7[character] ? character : '?'))
    .join('');
}

function bitmapText({
  value,
  x,
  y,
  maxWidth,
  maxCell = 2.3,
  color = '#10251c',
  opacity = 1,
  align = 'left',
  maximumLength = 38,
  fallback = 'NOT RECORDED',
}) {
  const text = normalizeBitmapText(value, maximumLength, fallback);
  const unitsWide = Math.max(1, text.length * 6 - 1);
  const cell = Math.min(maxCell, maxWidth / unitsWide);
  const width = unitsWide * cell;
  const startX = align === 'center' ? x - width / 2 : x;
  const pixel = Math.max(0.8, cell * 0.84);
  const radius = Math.min(0.55, pixel * 0.22);
  const rectangles = [];

  Array.from(text).forEach((character, characterIndex) => {
    const rows = FONT_5X7[character] || FONT_5X7['?'];
    rows.forEach((mask, row) => {
      for (let column = 0; column < 5; column += 1) {
        if ((mask & (1 << (4 - column))) === 0) continue;
        rectangles.push(
          `<rect x="${(startX + (characterIndex * 6 + column) * cell).toFixed(2)}" `
          + `y="${(y + row * cell).toFixed(2)}" width="${pixel.toFixed(2)}" `
          + `height="${pixel.toFixed(2)}" rx="${radius.toFixed(2)}" fill="${color}" />`,
        );
      }
    });
  });

  return `<g opacity="${opacity}">${rectangles.join('')}</g>`;
}

function fieldBitmap(y, value) {
  return bitmapText({
    value,
    x: 350,
    y: y - 16,
    maxWidth: 430,
    maxCell: 2.35,
    color: '#10251c',
    maximumLength: 38,
  });
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

  const evidenceGuidance = verificationValue
    ? `
      <rect x="344" y="984" width="164" height="154" fill="#ffffff" />
      <rect x="180" y="1148" width="493" height="48" fill="#ffffff" opacity="0.96" />
      ${bitmapText({
        value: 'SCAN TO CHECK CERTIFICATE EVIDENCE',
        x: 426,
        y: 1156,
        maxWidth: 390,
        maxCell: 1.45,
        color: '#064e3b',
        align: 'center',
        fallback: '',
        maximumLength: 40,
      })}
      ${bitmapText({
        value: 'EVIDENCE MAY BE PENDING - NO IDENTITY OR MEDICAL DATA IS PUBLIC',
        x: 426,
        y: 1178,
        maxWidth: 455,
        maxCell: 1.05,
        color: '#334155',
        align: 'center',
        fallback: '',
        maximumLength: 72,
      })}
    `
    : '';

  const demoWatermark = `
    <g transform="rotate(-18 426 760)">
      ${bitmapText({
        value: 'DEMO',
        x: 426,
        y: 715,
        maxWidth: 260,
        maxCell: 8.5,
        color: '#8b1a1a',
        opacity: 0.13,
        align: 'center',
        fallback: '',
        maximumLength: 8,
      })}
      ${bitmapText({
        value: 'NOT AN OFFICIAL GOVERNMENT DOCUMENT',
        x: 426,
        y: 782,
        maxWidth: 500,
        maxCell: 1.9,
        color: '#8b1a1a',
        opacity: 0.18,
        align: 'center',
        fallback: '',
        maximumLength: 40,
      })}
    </g>`;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="853" height="1280" viewBox="0 0 853 1280">
      ${fieldBitmap(530, fields.fullName)}
      ${fieldBitmap(582, fields.birthDate)}
      ${fieldBitmap(634, fields.sex)}
      ${fieldBitmap(686, fields.state)}
      ${fieldBitmap(738, fields.lga)}
      ${fieldBitmap(790, fields.ward)}
      ${fieldBitmap(842, fields.facility)}
      ${fieldBitmap(894, fields.vaccinator)}
      ${fieldBitmap(946, fields.vaccine)}
      ${evidenceGuidance}
      ${demoWatermark}
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
  bitmapText,
  buildTextOverlay,
  generateCertificate,
  normalizeBitmapText,
  renderCertificate,
};
