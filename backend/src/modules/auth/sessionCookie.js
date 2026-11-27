const config = require('../../config');

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlMs,
  };
}

// The CSRF cookie is intentionally readable by the same-origin SPA so the
// client can copy its value into the X-CSRF-Token header. It is still bound to
// the session through the SHA-256 hash stored server-side.
function getCsrfCookieOptions() {
  return {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlMs,
  };
}

function clearSessionCookie(res) {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
  });
}

function clearCsrfCookie(res) {
  res.clearCookie(config.csrfCookieName, {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
  });
}

function clearAuthCookies(res) {
  clearSessionCookie(res);
  clearCsrfCookie(res);
}

module.exports = {
  clearAuthCookies,
  clearCsrfCookie,
  clearSessionCookie,
  getCsrfCookieOptions,
  getSessionCookieOptions,
};
