const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const config = require('../config');

const GUEST_SYNC_RATE_LIMIT_MESSAGE =
  'Terlalu banyak permintaan sinkronisasi tamu. Silakan coba lagi nanti.';

/**
 * Builds the rate-limit bucket key for a guest synchronization request.
 *
 * The bucket is scoped to the authenticated user *and* to the trusted client
 * address that Express resolved through the configured proxy hops. The user
 * component keeps one administrator from exhausting another administrator's
 * budget, while the address component separates activity arriving through
 * different trusted client addresses.
 */
function guestSyncRateLimitKeyGenerator(req) {
  const userId = req.auth?.userId ? String(req.auth.userId) : 'anonymous';
  const ip = ipKeyGenerator(req.ip || 'unknown');
  return `guest-sync|${userId}|${ip}`;
}

/**
 * Dedicated request-rate ceiling for `POST /guests/sync`.
 *
 * The guest synchronization endpoint performs an outbound upstream request and
 * a database upsert, so it needs its own budget instead of relying on the
 * login limiter. Every authenticated attempt counts, successful attempts
 * included, because the expensive part of the operation is the upstream call.
 *
 * The limit is resolved per request so the effective ceiling always follows
 * the current server configuration.
 */
const guestSyncRateLimiter = rateLimit({
  windowMs: config.guestSyncRateLimitWindowMs,
  limit: () => config.guestSyncRateLimitLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: guestSyncRateLimitKeyGenerator,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: GUEST_SYNC_RATE_LIMIT_MESSAGE,
      },
    });
  },
});

module.exports = {
  guestSyncRateLimiter,
  guestSyncRateLimitKeyGenerator,
  GUEST_SYNC_RATE_LIMIT_MESSAGE,
};
