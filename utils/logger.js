const SAFE_FIELD = /^[a-z][a-zA-Z0-9]{0,79}$/;
const SENSITIVE_FIELD = /token|secret|password|authorization|cookie|payload|body|email|phone|name|address|mnemonic/i;

function safeFields(fields = {}) {
  const output = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELD.test(key) || SENSITIVE_FIELD.test(key)) continue;
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      output[key] = typeof value === 'string' ? value.slice(0, 500) : value;
    }
  }
  return output;
}

function write(level, event, fields) {
  const config = require('../config');
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    service: 'medfinet-api',
    environment: config.nodeEnv,
    ...safeFields(fields),
  });
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${entry}\n`);
}

const logger = Object.freeze({
  info(event, fields) {
    write('info', event, fields);
  },
  warn(event, fields) {
    write('warn', event, fields);
  },
  error(event, fields) {
    write('error', event, fields);
  },
});

module.exports = { logger, safeFields };
