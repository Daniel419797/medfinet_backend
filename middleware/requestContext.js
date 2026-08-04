const crypto = require('node:crypto');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

function requestContext(req, res, next) {
  const suppliedRequestId = req.get('x-request-id');
  req.requestId = REQUEST_ID_PATTERN.test(suppliedRequestId || '')
    ? suppliedRequestId
    : crypto.randomUUID();
  res.set('x-request-id', req.requestId);
  return next();
}

module.exports = { requestContext, REQUEST_ID_PATTERN };
