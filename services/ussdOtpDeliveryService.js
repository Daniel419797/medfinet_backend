const { DomainError } = require('../utils/domainError');
const { createBulkSmsNigeriaAdapter } = require('./notificationAdapters');

function otpMessageBody(code, expiresAt, now = Date.now()) {
  const minutes = Math.max(
    1,
    Math.ceil((new Date(expiresAt).getTime() - now) / 60_000)
  );
  return `Medfinet verification code: ${code}. Valid for ${minutes} minute(s). Do not share this code.`;
}

function createUssdOtpDeliveryService({
  config,
  smsConfig,
  fetchImpl = global.fetch,
  now = Date.now,
} = {}) {
  const settings = config || require('../config').notifications;
  const sms = smsConfig?.provider === 'bulksmsnigeria'
    ? createBulkSmsNigeriaAdapter(smsConfig, { fetchImpl })
    : null;

  return async function deliver({ phone, code, idempotencyKey, expiresAt }) {
    if (sms) {
      try {
        await sms.send({
          message: {
            id: idempotencyKey,
            channel: 'SMS',
            renderedBody: otpMessageBody(code, expiresAt, now()),
          },
          destination: phone,
        });
        return;
      } catch {
        throw new DomainError(503, 'USSD_OTP_DELIVERY_FAILED', 'OTP could not be delivered');
      }
    }
    if (!settings.gatewayUrl || !settings.gatewayToken || typeof fetchImpl !== 'function') {
      throw new DomainError(503, 'USSD_OTP_DELIVERY_UNAVAILABLE', 'OTP delivery is unavailable');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl(settings.gatewayUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${settings.gatewayToken}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({
          channel: 'SMS',
          to: phone,
          template: 'MEDFINET_USSD_OTP',
          parameters: { code, expiresAt: expiresAt.toISOString() },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Gateway returned ${response.status}`);
    } catch (error) {
      throw new DomainError(503, 'USSD_OTP_DELIVERY_FAILED', 'OTP could not be delivered');
    } finally {
      clearTimeout(timeout);
    }
  };
}

module.exports = { createUssdOtpDeliveryService, otpMessageBody };
