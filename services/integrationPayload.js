const crypto = require('node:crypto');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function payloadHash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

module.exports = { canonicalize, canonicalJson, payloadHash };
