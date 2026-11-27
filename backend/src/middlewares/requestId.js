const crypto = require('crypto');

const REQUEST_ID_HEADER = 'X-Request-ID';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function resolveRequestId(value) {
  if (typeof value !== 'string') return null;
  const requestId = value.trim();
  return REQUEST_ID_PATTERN.test(requestId) ? requestId : null;
}

function requestIdMiddleware(req, res, next) {
  const requestId =
    resolveRequestId(req.get(REQUEST_ID_HEADER)) || crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

module.exports = requestIdMiddleware;
module.exports.REQUEST_ID_HEADER = REQUEST_ID_HEADER;
module.exports.resolveRequestId = resolveRequestId;
