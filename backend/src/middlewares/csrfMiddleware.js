const crypto = require('crypto');
const config = require('../config');
const AppError = require('../shared/errors/AppError');
const { hashCsrfToken } = require('../modules/auth/sessionService');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_ERROR_MESSAGE = 'Origin atau token CSRF tidak valid.';
const MAX_CSRF_TOKEN_LENGTH = 512;

function createCsrfError() {
  return new AppError(CSRF_ERROR_MESSAGE, 403, null, 'CSRF_FAILED');
}

function requireAllowedOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin || !config.isAllowedOrigin(origin)) {
    return next(createCsrfError());
  }

  return next();
}

function constantTimeTokenMatch(providedToken, expectedToken) {
  if (
    typeof providedToken !== 'string' ||
    typeof expectedToken !== 'string' ||
    !providedToken ||
    !expectedToken
  ) {
    return false;
  }

  const providedDigest = crypto
    .createHash('sha256')
    .update(providedToken, 'utf8')
    .digest();
  const expectedDigest = crypto
    .createHash('sha256')
    .update(expectedToken, 'utf8')
    .digest();

  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

function constantTimeHashMatch(providedHash, expectedHash) {
  if (typeof providedHash !== 'string' || typeof expectedHash !== 'string') {
    return false;
  }

  const provided = Buffer.from(providedHash, 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(provided, expected);
}

function isUsableToken(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CSRF_TOKEN_LENGTH
  );
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const origin = req.get('origin');
  if (!origin || !config.isAllowedOrigin(origin)) {
    return next(createCsrfError());
  }

  const cookieToken = req.cookies?.[config.csrfCookieName];
  const headerToken = req.get('x-csrf-token');

  if (!isUsableToken(cookieToken) || !isUsableToken(headerToken)) {
    return next(createCsrfError());
  }

  // The header must be the same value as the CSRF cookie...
  if (!constantTimeTokenMatch(cookieToken, headerToken)) {
    return next(createCsrfError());
  }

  // ...and that value must belong to the authenticated session.
  const expectedHash = req.session?.csrfTokenHash;
  if (!expectedHash || !constantTimeHashMatch(hashCsrfToken(headerToken), expectedHash)) {
    return next(createCsrfError());
  }

  return next();
}

module.exports = {
  constantTimeHashMatch,
  constantTimeTokenMatch,
  csrfProtection,
  requireAllowedOrigin,
};
