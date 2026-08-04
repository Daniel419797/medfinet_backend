const { DomainError } = require('../utils/domainError');

function createInAppAdapter() {
  return {
    name: 'medfinet-in-app',
    async send({ message }) {
      return {
        status: 'DELIVERED',
        providerMessageId: `in-app:${message.id}`,
        responseCode: 'INTERNAL',
      };
    },
  };
}

function createGatewayAdapter(config, { fetchImpl = globalThis.fetch } = {}) {
  return {
    name: 'notification-gateway',
    async send({ message, destination }) {
      if (!config.gatewayUrl || !config.gatewayToken) {
        throw new DomainError(
          503,
          'NOTIFICATION_GATEWAY_UNAVAILABLE',
          'The notification gateway is not configured'
        );
      }
      if (!destination) {
        throw new DomainError(
          409,
          'NOTIFICATION_DESTINATION_UNAVAILABLE',
          `No verified ${message.channel.toLowerCase()} destination is available`
        );
      }
      let response;
      try {
        response = await fetchImpl(config.gatewayUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.gatewayToken}`,
            'content-type': 'application/json',
            'idempotency-key': message.idempotencyKey,
          },
          body: JSON.stringify({
            channel: message.channel,
            destination,
            subject: message.renderedSubject,
            body: message.renderedBody,
            metadata: {
              notificationMessageId: message.id,
              organizationId: message.organizationId,
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new DomainError(
          503,
          'NOTIFICATION_GATEWAY_UNREACHABLE',
          'The notification gateway request failed'
        );
      }
      if (!response.ok) {
        throw new DomainError(
          response.status >= 500 ? 503 : 409,
          'NOTIFICATION_GATEWAY_REJECTED',
          `The notification gateway returned ${response.status}`
        );
      }
      const result = await response.json();
      if (
        typeof result.messageId !== 'string'
        || result.messageId.length < 1
        || result.messageId.length > 200
      ) {
        throw new DomainError(
          503,
          'NOTIFICATION_GATEWAY_RESPONSE_INVALID',
          'The notification gateway returned an invalid message identifier'
        );
      }
      return {
        status: result.delivered === true ? 'DELIVERED' : 'ACCEPTED',
        providerMessageId: result.messageId,
        responseCode: String(response.status),
      };
    },
  };
}

function toInternationalDigits(value) {
  const compact = String(value || '').replace(/[\s()-]/g, '');
  if (/^\+?234[789][01][0-9]{8}$/.test(compact)) return compact.replace(/^\+/, '');
  if (/^0[789][01][0-9]{8}$/.test(compact)) return `234${compact.slice(1)}`;
  return null;
}

function createBulkSmsNigeriaAdapter(config, { fetchImpl = globalThis.fetch } = {}) {
  return {
    name: 'bulksmsnigeria',
    async send({ message, destination }) {
      if (!config?.apiToken) {
        throw new DomainError(503, 'SMS_PROVIDER_NOT_CONFIGURED', 'The SMS provider is not configured');
      }
      const to = toInternationalDigits(destination);
      if (!to) {
        throw new DomainError(
          400,
          'SMS_DESTINATION_INVALID',
          'The SMS destination must be a valid Nigerian phone number'
        );
      }
      const body = String(message.renderedBody || '').trim();
      if (!body || body.length > 1530) {
        throw new DomainError(
          400,
          'SMS_BODY_INVALID',
          'The SMS body must contain between 1 and 1530 characters'
        );
      }
      const payload = {
        from: config.senderId,
        to,
        body,
        gateway: config.gateway,
        ...(config.callbackUrl ? { callback_url: config.callbackUrl } : {}),
      };
      let response;
      try {
        response = await fetchImpl(`${config.baseUrl}/sms`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiToken}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(config.timeoutMs || 10_000),
        });
      } catch {
        throw new DomainError(503, 'SMS_PROVIDER_UNREACHABLE', 'The SMS provider request failed');
      }
      let result;
      try {
        result = await response.json();
      } catch {
        result = null;
      }
      if (!response.ok || result?.status !== 'success') {
        throw new DomainError(
          response.status >= 500 ? 503 : 409,
          'SMS_PROVIDER_REJECTED',
          `The SMS provider returned ${response.status}`
        );
      }
      const providerMessageId = result?.data?.message_id;
      if (typeof providerMessageId !== 'string' || providerMessageId.length < 1) {
        throw new DomainError(
          503,
          'SMS_PROVIDER_RESPONSE_INVALID',
          'The SMS provider returned an invalid message identifier'
        );
      }
      return {
        status: 'ACCEPTED',
        providerMessageId,
        responseCode: String(response.status),
      };
    },
  };
}

function createNotificationAdapters(config, options) {
  const gateway = createGatewayAdapter(config.notifications || config, options);
  const smsConfig = config.sms || null;
  const sms = smsConfig?.provider === 'bulksmsnigeria'
    ? createBulkSmsNigeriaAdapter(smsConfig, options)
    : gateway;
  return {
    IN_APP: createInAppAdapter(),
    EMAIL: gateway,
    SMS: sms,
    PUSH: gateway,
  };
}

module.exports = {
  createBulkSmsNigeriaAdapter,
  createInAppAdapter,
  createGatewayAdapter,
  createNotificationAdapters,
  toInternationalDigits,
};
