const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DomainError } = require('../utils/domainError');

const scrypt = promisify(crypto.scrypt);
const PIN_PATTERN = /^[0-9]{4,6}$/;
const OTP_PATTERN = /^[0-9]{6}$/;

function normalizePhone(value) {
  const compact = String(value || '').replace(/[\s()-]/g, '');
  let normalized = compact;
  if (/^0[789][01][0-9]{8}$/.test(compact)) normalized = `+234${compact.slice(1)}`;
  else if (/^234[789][01][0-9]{8}$/.test(compact)) normalized = `+${compact}`;
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
    throw new DomainError(400, 'USSD_PHONE_INVALID', 'Phone number must be valid E.164');
  }
  return normalized;
}

function keyedDigest(value, secret, label) {
  if (!secret || secret.length < 32) {
    throw new DomainError(503, 'USSD_SECURITY_NOT_CONFIGURED', 'USSD security is unavailable');
  }
  return crypto.createHmac('sha256', secret).update(`${label}\0${value}`).digest('hex');
}

function phoneDigest(phone, secret) {
  return keyedDigest(normalizePhone(phone), secret, 'ussd-phone-v1');
}

function actionDigest(action, secret) {
  const canonical = JSON.stringify(action, Object.keys(action).sort());
  return keyedDigest(canonical, secret, 'ussd-action-v1');
}

async function hashPin(pin, pepper) {
  if (!PIN_PATTERN.test(String(pin || ''))) {
    throw new DomainError(400, 'USSD_PIN_INVALID', 'USSD PIN must contain 4 to 6 digits');
  }
  if (!pepper || pepper.length < 32) {
    throw new DomainError(503, 'USSD_SECURITY_NOT_CONFIGURED', 'USSD security is unavailable');
  }
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(`${pin}\0${pepper}`, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function verifyPin(pin, encoded, pepper) {
  if (
    !PIN_PATTERN.test(String(pin || ''))
    || typeof encoded !== 'string'
    || !pepper
    || pepper.length < 32
  ) return false;
  const [algorithm, n, r, p, saltValue, expectedValue] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltValue || !expectedValue) return false;
  const expected = Buffer.from(expectedValue, 'base64url');
  if (expected.length !== 32) return false;
  const actual = await scrypt(
    `${pin}\0${pepper}`,
    Buffer.from(saltValue, 'base64url'),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p) }
  );
  return crypto.timingSafeEqual(actual, expected);
}

function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function otpDigest(challengeId, purpose, code, secret) {
  if (!OTP_PATTERN.test(String(code || ''))) {
    throw new DomainError(400, 'USSD_OTP_INVALID', 'Verification code must contain 6 digits');
  }
  return keyedDigest(`${challengeId}\0${purpose}\0${code}`, secret, 'ussd-otp-v1');
}

function secureEquals(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

module.exports = {
  actionDigest,
  generateOtp,
  hashPin,
  normalizePhone,
  otpDigest,
  phoneDigest,
  secureEquals,
  verifyPin,
};
