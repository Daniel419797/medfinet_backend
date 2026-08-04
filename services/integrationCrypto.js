const crypto = require('node:crypto');
const { DomainError } = require('../utils/domainError');
const { canonicalJson, payloadHash } = require('./integrationPayload');

function encryptionKey(keyProvider) {
  const key = keyProvider?.();
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new DomainError(
      503,
      'INTEGRATION_ENCRYPTION_KEY_UNAVAILABLE',
      'Integration payload encryption is not configured'
    );
  }
  return key;
}

function createIntegrationCrypto({ keyProvider } = {}) {
  const provider = keyProvider || require('../config').integrations.payloadKey;

  function encrypt(payload) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(provider), iv);
    const plaintext = Buffer.from(canonicalJson(payload), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      payloadHash: payloadHash(payload),
      payloadCiphertext: ciphertext.toString('base64'),
      payloadIv: iv.toString('base64'),
      payloadAuthTag: cipher.getAuthTag().toString('base64'),
    };
  }

  function decrypt(record) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        encryptionKey(provider),
        Buffer.from(record.payloadIv, 'base64')
      );
      decipher.setAuthTag(Buffer.from(record.payloadAuthTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(record.payloadCiphertext, 'base64')),
        decipher.final(),
      ]);
      const payload = JSON.parse(plaintext.toString('utf8'));
      if (payloadHash(payload) !== record.payloadHash) {
        throw new Error('hash mismatch');
      }
      return payload;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        500,
        'INTEGRATION_PAYLOAD_DECRYPTION_FAILED',
        'Staged integration payload could not be verified'
      );
    }
  }

  return { encrypt, decrypt };
}

module.exports = { createIntegrationCrypto, encryptionKey };
