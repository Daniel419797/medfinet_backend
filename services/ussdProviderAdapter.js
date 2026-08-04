const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const { normalizePhone } = require('./ussdSecurity');

function boundedText(value, name, max) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized)) {
    throw new DomainError(400, 'USSD_PROVIDER_PAYLOAD_INVALID', `${name} is invalid`);
  }
  return normalized;
}

function createAfricasTalkingAdapter({ maxResponseCharacters = 160 } = {}) {
  function parse(body) {
    const providerSessionId = boundedText(body?.sessionId, 'sessionId', 160);
    const serviceCode = boundedText(body?.serviceCode, 'serviceCode', 40);
    const phoneNumber = normalizePhone(body?.phoneNumber);
    const text = String(body?.text || '');
    if (text.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
      throw new DomainError(400, 'USSD_PROVIDER_PAYLOAD_INVALID', 'text is invalid');
    }
    return {
      provider: 'africas_talking',
      providerSessionId,
      serviceCode,
      phoneNumber,
      text,
      inputs: text ? text.split('*').map((item) => item.trim()).slice(0, 20) : [],
      requestDigest: crypto.createHash('sha256')
        .update(`${providerSessionId}\0${serviceCode}\0${phoneNumber}\0${text}`)
        .digest('hex'),
    };
  }

  function format({ continueSession, message }) {
    const clean = String(message || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!clean) throw new DomainError(500, 'USSD_RESPONSE_INVALID', 'USSD response is empty');
    const prefix = continueSession ? 'CON ' : 'END ';
    return `${prefix}${clean.slice(0, maxResponseCharacters - prefix.length)}`;
  }

  return { format, parse };
}

module.exports = { createAfricasTalkingAdapter };
