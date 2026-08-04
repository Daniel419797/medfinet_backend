const { DomainError } = require('../utils/domainError');
const crypto = require('node:crypto');

function stateKey(settings) {
  const key = settings.stateEncryptionKey?.();
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new DomainError(503, 'USSD_STATE_KEY_UNAVAILABLE', 'USSD session protection is unavailable');
  }
  return key;
}

function seal(value, settings, associatedData) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', stateKey(settings), iv);
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function unseal(envelope, settings, associatedData) {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm', stateKey(settings), Buffer.from(envelope.iv, 'base64')
    );
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const clear = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(clear);
  } catch {
    throw new DomainError(409, 'USSD_STATE_INVALID', 'USSD session state could not be verified');
  }
}

function encryptedEnvelope(value) {
  return value?.v === 1 && typeof value.iv === 'string'
    && typeof value.tag === 'string' && typeof value.data === 'string';
}

function createUssdSessionService(prismaClient, { config, now = () => new Date() } = {}) {
  const database = prismaClient || require('../utils/prisma').prisma;
  const settings = config || require('../config').ussd;

  async function open(request, identity) {
    const currentTime = now();
    let session = await database.ussdSession.findUnique({
      where: { provider_providerSessionId: {
        provider: request.provider,
        providerSessionId: request.providerSessionId,
      } },
    });
    if (session) {
      if (encryptedEnvelope(session.state)) {
        const clear = unseal(session.state, settings, `state:${session.id}`);
        session.state = clear;
        session.currentMenu = clear._menu || 'ROOT';
      }
      if (session.lastRequestDigest === request.requestDigest && session.lastResponse) {
        const replay = session.lastResponse.startsWith('enc:v1:')
          ? unseal(JSON.parse(Buffer.from(session.lastResponse.slice(7), 'base64url').toString()), settings, `response:${session.id}`)
          : session.lastResponse;
        return { session, replay };
      }
      if (session.status !== 'ACTIVE' || session.expiresAt <= currentTime) {
        await database.ussdSession.updateMany({
          where: { id: session.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED', completedAt: currentTime },
        });
        throw new DomainError(410, 'USSD_SESSION_EXPIRED', 'This session has expired');
      }
      return { session, replay: null };
    }
    const resolved = await identity.resolveRoutes(request.phoneNumber);
    const single = resolved.routes.length === 1 ? resolved.routes[0] : null;
    const menu = resolved.routes.length > 1 ? 'SELECT_ORG' : single ? 'PIN' : 'UNREGISTERED';
    session = await database.ussdSession.create({
      data: {
        provider: request.provider,
        providerSessionId: request.providerSessionId,
        phoneDigest: resolved.digest,
        phoneLastFour: resolved.normalized.slice(-4),
        ...(single ? single : {}),
        assurance: single ? 'PHONE' : 'NONE',
        currentMenu: menu,
        state: { inputCount: 0, routes: resolved.routes },
        expiresAt: new Date(currentTime.getTime() + settings.sessionTtlSeconds * 1000),
      },
    });
    return { session, replay: null };
  }

  async function save(session, request, result) {
    const currentTime = now();
    const completed = !result.continueSession;
    const protectedSession = Boolean(result.organizationId || session.organizationId);
    const clearState = { ...(result.state || session.state) };
    const persistedState = protectedSession
      ? seal({ ...clearState, _menu: result.menu || session.currentMenu }, settings, `state:${session.id}`)
      : clearState;
    const responseEnvelope = protectedSession
      ? seal(result.formatted, settings, `response:${session.id}`)
      : null;
    const persistedResponse = responseEnvelope
      ? `enc:v1:${Buffer.from(JSON.stringify(responseEnvelope)).toString('base64url')}`
      : result.formatted;
    return database.ussdSession.update({
      where: { id: session.id },
      data: {
        currentMenu: protectedSession ? 'SECURE' : (result.menu || session.currentMenu),
        state: persistedState,
        locale: result.locale || session.locale,
        ...(result.organizationId ? { organizationId: result.organizationId } : {}),
        ...(result.caregiverId ? { caregiverId: result.caregiverId, assurance: 'PHONE' } : {}),
        lastRequestDigest: request.requestDigest,
        lastResponse: persistedResponse,
        expiresAt: new Date(currentTime.getTime() + settings.sessionTtlSeconds * 1000),
        ...(completed ? { status: 'COMPLETED', completedAt: currentTime } : {}),
      },
    });
  }

  return { open, save };
}

module.exports = { createUssdSessionService };
