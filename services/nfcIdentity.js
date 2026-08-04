const crypto = require('node:crypto');

function uidDigest(uid, pepper) {
  return crypto
    .createHmac('sha256', pepper)
    .update(Buffer.from(uid, 'hex'))
    .digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function exchangeToken(organizationId) {
  const route = Buffer.from(organizationId, 'utf8').toString('base64url');
  return `${route}.${randomToken()}`;
}

function exchangeOrganizationId(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }
  try {
    const organizationId = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
    return /^[A-Za-z0-9_-]{1,100}$/.test(organizationId) ? organizationId : null;
  } catch {
    return null;
  }
}

function tokenDigest(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function cardAccessCredentials(uid, publicId, secret) {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`ntag215:${uid.toUpperCase()}:${publicId}`)
    .digest();
  return {
    passwordHex: digest.subarray(0, 4).toString('hex').toUpperCase(),
    packHex: digest.subarray(4, 6).toString('hex').toUpperCase(),
  };
}

module.exports = {
  uidDigest,
  randomToken,
  tokenDigest,
  exchangeToken,
  exchangeOrganizationId,
  cardAccessCredentials,
};
