const request = require('supertest');
const User = require('../../backend/src/modules/auth/userModel');

const TEST_ORIGIN = 'http://localhost:5173';
const SESSION_COOKIE_NAME = 'sigap_session';
const CSRF_COOKIE_NAME = 'sigap_csrf';

function cookieValue(cookieHeader, name) {
  const match = String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!match) return null;

  const rawValue = match.slice(name.length + 1);
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

async function createTestUser(overrides = {}) {
  const password = overrides.password || 'CorrectHorse9!';
  const passwordHash = await User.hashPassword(password);

  return User.create({
    adminId: overrides.adminId || 'testadmin',
    username: overrides.username || 'Test Administrator',
    passwordHash,
    fullName: overrides.fullName || 'Test Administrator',
    email: overrides.email || 'test.admin@example.test',
    role: overrides.role || 'superadmin',
    isActive: overrides.isActive !== false,
  });
}

async function loginTestUser(app, credentials = {}) {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({
      idadmin: credentials.adminId || 'testadmin',
      password: credentials.password || 'CorrectHorse9!',
    })
    .expect(200);

  const cookies = response.headers['set-cookie'] || [];
  const sessionCookie = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  const csrfCookie = cookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`));

  if (!sessionCookie || !csrfCookie) {
    throw new Error(
      `Login response did not contain session and CSRF cookies: ${JSON.stringify(cookies)}`,
    );
  }

  const sessionCookiePair = sessionCookie.split(';')[0];
  const csrfCookiePair = csrfCookie.split(';')[0];
  const csrfToken = cookieValue(csrfCookiePair, CSRF_COOKIE_NAME);

  if (!csrfToken) {
    throw new Error(`Login response did not contain a readable CSRF token: ${csrfCookiePair}`);
  }

  return {
    // Both cookies are sent on every authenticated request.
    cookie: `${sessionCookiePair}; ${csrfCookiePair}`,
    sessionCookie: sessionCookiePair,
    csrfCookie: csrfCookiePair,
    csrfToken,
    rawSessionToken: cookieValue(sessionCookiePair, SESSION_COOKIE_NAME),
    response,
    user: response.body?.data?.user,
  };
}

function authenticatedRequest(app, session) {
  const agent = request(app);
  const send = (method, endpoint) =>
    agent[method](endpoint)
      .set('Cookie', session.cookie)
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', session.csrfToken);

  return {
    delete: (endpoint) => send('delete', endpoint),
    get: (endpoint) => send('get', endpoint),
    post: (endpoint) => send('post', endpoint),
    put: (endpoint) => send('put', endpoint),
  };
}

module.exports = {
  authenticatedRequest,
  cookieValue,
  createTestUser,
  loginTestUser,
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  TEST_ORIGIN,
};
