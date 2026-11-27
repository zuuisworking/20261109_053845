const crypto = require('crypto');
const config = require('../../config');
const Session = require('./sessionModel');

const TOKEN_BYTES = 32;

function generateOpaqueToken(bytes = TOKEN_BYTES) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// The CSRF token is independent random material: it is never derived from the
// session token, the user id, or any deployment secret.
function generateCsrfToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashSessionToken(rawToken) {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(String(rawToken), 'utf8')
    .digest('hex');
}

function hashCsrfToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

async function createSession(userId) {
  const rawToken = generateOpaqueToken(TOKEN_BYTES);
  const tokenHash = hashSessionToken(rawToken);
  const csrfToken = generateCsrfToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlMs);

  const session = await Session.create({
    tokenHash,
    userId,
    csrfTokenHash: hashCsrfToken(csrfToken),
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
  });

  return {
    rawToken,
    csrfToken,
    session,
  };
}

async function findSessionByToken(rawToken) {
  if (typeof rawToken !== 'string' || !rawToken || rawToken.length > 512) {
    return null;
  }

  return Session.findOne({ tokenHash: hashSessionToken(rawToken) });
}

async function revokeSessionByToken(rawToken, reason = 'logout') {
  if (typeof rawToken !== 'string' || !rawToken || rawToken.length > 512) {
    return false;
  }

  const result = await Session.updateOne(
    {
      tokenHash: hashSessionToken(rawToken),
      revokedAt: null,
    },
    {
      $set: {
        revokedAt: new Date(),
        revokedReason: String(reason).slice(0, 64),
      },
    },
  );

  return result.modifiedCount === 1;
}

async function revokeSessionById(sessionId, reason = 'logout') {
  if (!sessionId) {
    return false;
  }

  const result = await Session.updateOne(
    {
      _id: sessionId,
      revokedAt: null,
    },
    {
      $set: {
        revokedAt: new Date(),
        revokedReason: String(reason).slice(0, 64),
      },
    },
  );

  return result.modifiedCount === 1;
}

async function revokeAllSessionsForUser(userId, reason = 'password-change') {
  const result = await Session.updateMany(
    {
      userId,
      revokedAt: null,
    },
    {
      $set: {
        revokedAt: new Date(),
        revokedReason: String(reason).slice(0, 64),
      },
    },
  );

  return result.modifiedCount;
}

async function touchSession(sessionId, now = new Date()) {
  await Session.updateOne(
    {
      _id: sessionId,
      revokedAt: null,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        lastUsedAt: now,
      },
    },
  );
}

function isSessionActive(session, now = new Date()) {
  return Boolean(
    session &&
      !session.revokedAt &&
      session.expiresAt &&
      session.expiresAt.getTime() > now.getTime()
  );
}

module.exports = {
  createSession,
  findSessionByToken,
  generateCsrfToken,
  generateOpaqueToken,
  hashCsrfToken,
  hashSessionToken,
  isSessionActive,
  revokeAllSessionsForUser,
  revokeSessionById,
  revokeSessionByToken,
  touchSession,
};
