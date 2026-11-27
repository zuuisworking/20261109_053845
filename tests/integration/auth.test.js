const request = require('supertest');
const app = require('../../backend/src/app');
const {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} = require('../helpers/database');
const {
  authenticatedRequest,
  cookieValue,
  createTestUser,
  loginTestUser,
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  TEST_ORIGIN,
} = require('../helpers/auth');

beforeAll(async () => {
  await connectTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

function findCookie(cookies, name) {
  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

function maxAgeOf(cookie) {
  const match = String(cookie).match(/Max-Age=(\d+)/);
  return match ? Number(match[1]) : null;
}

describe('opaque session authentication', () => {
  it('rejects protected resources without a session', async () => {
    const response = await request(app).get('/api/v1/transformers');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: expect.any(String),
      },
    });
    expect(response.body.status).toBeUndefined();
    expect(response.body.code).toBeUndefined();
  });

  it('sets a HttpOnly session cookie and a JS-readable CSRF cookie with aligned attributes', async () => {
    await createTestUser();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ idadmin: 'testadmin', password: 'CorrectHorse9!' });

    expect(response.status).toBe(200);

    const cookies = response.headers['set-cookie'] || [];
    const sessionCookie = findCookie(cookies, SESSION_COOKIE_NAME);
    const csrfCookie = findCookie(cookies, CSRF_COOKIE_NAME);

    expect(sessionCookie).toBeDefined();
    expect(csrfCookie).toBeDefined();

    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).not.toContain('Secure');

    expect(csrfCookie).not.toContain('HttpOnly');
    expect(csrfCookie).toContain('SameSite=Lax');
    expect(csrfCookie).toContain('Path=/');
    expect(csrfCookie).not.toContain('Secure');

    expect(maxAgeOf(csrfCookie)).toBe(maxAgeOf(sessionCookie));
    expect(maxAgeOf(sessionCookie)).toBeGreaterThan(0);
  });

  it('never returns the raw session or CSRF token in JSON', async () => {
    await createTestUser();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ idadmin: 'testadmin', password: 'CorrectHorse9!' });

    const cookies = response.headers['set-cookie'] || [];
    const rawSessionToken = cookieValue(
      findCookie(cookies, SESSION_COOKIE_NAME).split(';')[0],
      SESSION_COOKIE_NAME,
    );
    const rawCsrfToken = cookieValue(
      findCookie(cookies, CSRF_COOKIE_NAME).split(';')[0],
      CSRF_COOKIE_NAME,
    );

    expect(rawSessionToken).toEqual(expect.any(String));
    expect(rawCsrfToken).toEqual(expect.any(String));
    expect(response.body.data.csrfToken).toBeUndefined();
    expect(response.body.csrfToken).toBeUndefined();
    expect(response.body.data.token).toBeUndefined();
    expect(response.body.data.user.adminId).toBe('testadmin');

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(rawSessionToken);
    expect(serialized).not.toContain(rawCsrfToken);
  });

  it('does not reveal whether an account exists', async () => {
    await createTestUser();

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ idadmin: 'testadmin', password: 'wrong-password' });
    const unknownAccount = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ idadmin: 'unknown', password: 'wrong-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownAccount.body.error.message);
  });

  it('fails closed when the CSRF cookie or header is missing, mismatched, or from another session', async () => {
    await createTestUser();
    const session = await loginTestUser(app);
    const otherSession = await loginTestUser(app);
    const payload = {
      name: 'CSRF Test',
      feeder: 'TEST',
      capacity: '100 kVA',
      location: { type: 'Point', coordinates: [98.67, 3.66] },
    };

    const missingCookie = await request(app)
      .post('/api/v1/transformers')
      .set('Cookie', session.sessionCookie)
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', session.csrfToken)
      .send(payload);

    expect(missingCookie.status).toBe(403);
    expect(missingCookie.body).toEqual({
      error: {
        code: 'CSRF_FAILED',
        message: expect.any(String),
      },
    });

    const missingHeader = await request(app)
      .post('/api/v1/transformers')
      .set('Cookie', session.cookie)
      .set('Origin', TEST_ORIGIN)
      .send(payload);

    expect(missingHeader.status).toBe(403);
    expect(missingHeader.body.error.code).toBe('CSRF_FAILED');

    const mismatched = await request(app)
      .post('/api/v1/transformers')
      .set('Cookie', session.cookie)
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', `${session.csrfToken}-lain`)
      .send(payload);

    expect(mismatched.status).toBe(403);
    expect(mismatched.body.error.code).toBe('CSRF_FAILED');

    const crossSession = await request(app)
      .post('/api/v1/transformers')
      .set('Cookie', `${session.sessionCookie}; ${otherSession.csrfCookie}`)
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', otherSession.csrfToken)
      .send(payload);

    expect(crossSession.status).toBe(403);
    expect(crossSession.body.error.code).toBe('CSRF_FAILED');

    const accepted = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send(payload);

    expect(accepted.status).toBe(201);
  });

  it('revokes the server session and clears both cookies on logout', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const logout = await authenticatedRequest(app, session).post('/api/v1/auth/logout');
    expect(logout.status).toBe(200);

    const clearedCookies = logout.headers['set-cookie'] || [];
    const clearedSession = findCookie(clearedCookies, SESSION_COOKIE_NAME);
    const clearedCsrf = findCookie(clearedCookies, CSRF_COOKIE_NAME);

    expect(clearedSession).toBeDefined();
    expect(clearedCsrf).toBeDefined();
    expect(clearedSession).toContain('Expires=Thu, 01 Jan 1970');
    expect(clearedCsrf).toContain('Expires=Thu, 01 Jan 1970');
    expect(clearedCsrf).not.toContain('HttpOnly');

    const afterLogout = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', session.cookie);
    expect(afterLogout.status).toBe(401);
  });

  it('clears both cookies when the password changes', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const changed = await authenticatedRequest(app, session)
      .put('/api/v1/auth/profile/password')
      .send({ currentPassword: 'CorrectHorse9!', newPassword: 'NewCorrectHorse9!' });

    expect(changed.status).toBe(200);
    expect(changed.body.data.reauthenticationRequired).toBe(true);

    const clearedCookies = changed.headers['set-cookie'] || [];
    const clearedSession = findCookie(clearedCookies, SESSION_COOKIE_NAME);
    const clearedCsrf = findCookie(clearedCookies, CSRF_COOKIE_NAME);

    expect(clearedSession).toBeDefined();
    expect(clearedCsrf).toBeDefined();
    expect(clearedSession).toContain('Expires=Thu, 01 Jan 1970');
    expect(clearedCsrf).toContain('Expires=Thu, 01 Jan 1970');

    const afterChange = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', session.cookie);
    expect(afterChange.status).toBe(401);
  });

  it('returns a bounded request identifier in every response', async () => {
    const supplied = await request(app)
      .get('/api/health')
      .set('X-Request-ID', 'release-check-123');
    expect(supplied.headers['x-request-id']).toBe('release-check-123');

    const generated = await request(app).get('/api/health');
    expect(generated.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const invalid = await request(app)
      .get('/api/health')
      .set('X-Request-ID', 'x'.repeat(129));
    expect(invalid.headers['x-request-id']).not.toBe('x'.repeat(129));
  });

  it('does not emit credentialed CORS headers for an untrusted origin', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://attacker.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a configured origin and rejects unsafe requests from another origin', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const trusted = await request(app)
      .get('/api/v1/auth/me')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', session.cookie);
    expect(trusted.status).toBe(200);
    expect(trusted.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(trusted.headers['access-control-allow-credentials']).toBe('true');

    const untrusted = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://attacker.example')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);
    expect(untrusted.status).toBe(403);
    expect(untrusted.body.error.code).toBe('CSRF_FAILED');
  });

  it('rejects unsafe requests without an Origin header', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_FAILED');
  });

  it('does not cache authentication responses', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ idadmin: 'testadmin', password: 'CorrectHorse9!' });
    expect(login.headers['cache-control']).toBe('no-store');

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', session.cookie);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.body.data.csrfToken).toBeUndefined();
  });

  it('allows an admin to read data but blocks destructive and account-management actions', async () => {
    await createTestUser({
      adminId: 'regularadmin',
      username: 'Regular Administrator',
      email: 'regular.admin@example.test',
      role: 'admin',
    });
    const session = await loginTestUser(app, { adminId: 'regularadmin' });

    const list = await authenticatedRequest(app, session).get('/api/v1/transformers');
    expect(list.status).toBe(200);

    const created = await authenticatedRequest(app, session).post('/api/v1/transformers').send({
      name: 'Trafo Role Test',
      feeder: 'TEST',
      capacity: '100 kVA',
      location: { type: 'Point', coordinates: [98.67, 3.66] },
    });
    expect(created.status).toBe(201);

    const removed = await authenticatedRequest(app, session).delete(
      `/api/v1/transformers/${created.body.data.id}`
    );
    expect(removed.status).toBe(403);

    const registered = await authenticatedRequest(app, session)
      .post('/api/v1/auth/register-admin')
      .send({
        adminId: 'forbiddenadmin',
        username: 'Forbidden Administrator',
        password: 'CorrectHorse9!',
      });
    expect(registered.status).toBe(403);
  });

  it('allows a superadmin to provision a controlled admin account', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const response = await authenticatedRequest(app, session)
      .post('/api/v1/auth/register-admin')
      .send({
        adminId: 'newadmin',
        username: 'New Administrator',
        password: 'CorrectHorse9!',
        role: 'admin',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.adminId).toBe('newadmin');
    expect(response.body.data.role).toBe('admin');
    expect(response.body.data.passwordHash).toBeUndefined();
  });
});
