const config = require('../config');
const User = require('../modules/auth/userModel');
const {
  findSessionByToken,
  isSessionActive,
  revokeSessionById,
  touchSession,
} = require('../modules/auth/sessionService');
const { clearAuthCookies } = require('../modules/auth/sessionCookie');
const { csrfProtection } = require('./csrfMiddleware');
const AppError = require('../shared/errors/AppError');

const INVALID_SESSION_MESSAGE = 'Sesi tidak valid atau telah kedaluwarsa.';
const ADMIN_ROLES = new Set(['superadmin', 'admin']);

function unauthenticatedError() {
  return new AppError(INVALID_SESSION_MESSAGE, 401, null, 'UNAUTHENTICATED');
}

async function authMiddleware(req, res, next) {
  try {
    const rawToken = req.cookies?.[config.sessionCookieName];
    if (typeof rawToken !== 'string' || !rawToken || rawToken.length > 512) {
      clearAuthCookies(res);
      return next(unauthenticatedError());
    }

    const session = await findSessionByToken(rawToken);
    const now = new Date();
    if (!isSessionActive(session, now)) {
      clearAuthCookies(res);
      return next(unauthenticatedError());
    }

    const user = await User.findById(session.userId).select('-passwordHash');
    if (!user || !user.isActive) {
      await revokeSessionById(session._id, 'inactive-user');
      clearAuthCookies(res);
      return next(unauthenticatedError());
    }

    const lastUsedAt = session.lastUsedAt ? new Date(session.lastUsedAt).getTime() : 0;
    if (now.getTime() - lastUsedAt >= config.sessionLastUsedUpdateIntervalMs) {
      try {
        await touchSession(session._id, now);
        session.lastUsedAt = now;
      } catch (_error) {
        console.error('[Session] Failed to update last-used timestamp.');
      }
    }

    req.session = session;
    req.user = user;
    req.auth = {
      sessionId: session._id,
      userId: user._id,
    };

    return csrfProtection(req, res, next);
  } catch (error) {
    return next(error);
  }
}

function requireRole(...requestedRoles) {
  const roles = requestedRoles.flat();
  if (roles.length === 0 || roles.some((role) => !ADMIN_ROLES.has(role))) {
    throw new Error('requireRole received an invalid role.');
  }

  return function roleAuthorizationMiddleware(req, res, next) {
    if (!req.user) {
      return next(unauthenticatedError());
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          'Anda tidak memiliki hak akses untuk tindakan ini.',
          403,
          null,
          'FORBIDDEN'
        )
      );
    }

    return next();
  };
}

module.exports = {
  authMiddleware,
  requireRole,
};
