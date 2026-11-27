const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const config = require('../config');

function normalizeLoginAccount(body) {
  const candidate =
    body && typeof body === 'object'
      ? body.adminId ?? body.idadmin
      : '';

  if (typeof candidate !== 'string') {
    return '';
  }

  return candidate.trim().toLowerCase().slice(0, 64);
}

function loginRateLimitKeyGenerator(req) {
  const account = normalizeLoginAccount(req.body);
  const ip = ipKeyGenerator(req.ip || 'unknown');
  return `${account}|${ip}`;
}

const loginRateLimiter = rateLimit({
  windowMs: config.loginRateLimitWindowMs,
  limit: config.loginRateLimitLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: loginRateLimitKeyGenerator,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Terlalu banyak percobaan login. Silakan coba lagi nanti.',
      },
    });
  },
});

module.exports = {
  loginRateLimiter,
  loginRateLimitKeyGenerator,
  normalizeLoginAccount,
};
