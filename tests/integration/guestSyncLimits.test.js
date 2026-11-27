const config = require('../../backend/src/config');
const request = require('supertest');
const GuestVisit = require('../../backend/src/modules/guests/guestModel');
const guestService = require('../../backend/src/modules/guests/guestService');
const app = require('../../backend/src/app');
const {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} = require('../helpers/database');
const {
  authenticatedRequest,
  createTestUser,
  loginTestUser,
  TEST_ORIGIN,
} = require('../helpers/auth');

const UPSTREAM_URL = 'https://script.google.com/macros/s/test/exec';
const ATTACKER_URL = 'https://attacker.example/guest-data';

const VALID_PAYLOAD = [
  {
    Timestamp: '2026-11-26T10:30:00+07:00',
    'Nama Tamu': 'Budi Santoso',
    'No HP': '08123456789',
    Keperluan: 'Rapat',
    'ID Pelanggan': 'CUST-001',
  },
];

function upstreamResponse(payload = VALID_PAYLOAD) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Holds every caller inside the service call until all of them arrived.
 *
 * The barrier only synchronizes the arrival of the requests; the coalescing
 * behavior under test is still the real service implementation.
 */
function createSyncBarrier(expectedCalls) {
  const originalSync = guestService.syncFromGoogleForm.bind(guestService);
  let arrived = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => {
    releaseBarrier = resolve;
  });

  vi.spyOn(guestService, 'syncFromGoogleForm').mockImplementation(async (...args) => {
    arrived += 1;
    await barrier;
    return originalSync(...args);
  });

  return {
    get arrived() {
      return arrived;
    },
    release: releaseBarrier,
    async waitForArrival(timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (arrived < expectedCalls) {
        if (Date.now() > deadline) {
          throw new Error(
            `Only ${arrived} of ${expectedCalls} sync requests reached the service.`
          );
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };
}

function dispatchSyncRequests(session, count, body = {}) {
  return Array.from({ length: count }, () =>
    authenticatedRequest(app, session)
      .post('/api/v1/guests/sync')
      .send(body)
      .then((response) => response)
  );
}

beforeAll(async () => {
  await connectTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('Guest synchronization resource limits', () => {
  it('coalesces concurrent sync requests into one upstream fetch and one upsert', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const originalUrl = config.googleFormUrl;
    const originalLimit = config.guestSyncRateLimitLimit;
    config.googleFormUrl = UPSTREAM_URL;
    config.guestSyncRateLimitLimit = 50;

    const fetchMock = vi.fn(async () => upstreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    const barrier = createSyncBarrier(12);

    try {
      const pending = dispatchSyncRequests(session, 12);
      await barrier.waitForArrival();
      barrier.release();

      const responses = await Promise.all(pending);

      expect(barrier.arrived).toBe(12);
      expect(responses.every((response) => response.status === 200)).toBe(true);

      // Exactly one upstream request and one database operation.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe(UPSTREAM_URL);
      expect(await GuestVisit.countDocuments({})).toBe(1);

      // Every caller receives the same successful result.
      const payloads = responses.map((response) => response.body.data);
      for (const payload of payloads) {
        expect(payload).toEqual(payloads[0]);
        expect(payload).toMatchObject({
          totalFetched: 1,
          fetchedCount: 1,
          insertedCount: 1,
          duplicateCount: 0,
          duplicateSkipped: 0,
          rejectedCount: 0,
        });
      }
    } finally {
      config.guestSyncRateLimitLimit = originalLimit;
      config.googleFormUrl = originalUrl;
    }
  });

  it('rejects requests above the dedicated rate ceiling with the canonical error envelope', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const originalUrl = config.googleFormUrl;
    const originalLimit = config.guestSyncRateLimitLimit;
    config.googleFormUrl = UPSTREAM_URL;
    config.guestSyncRateLimitLimit = 2;

    const fetchMock = vi.fn(async () => upstreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    try {
      const first = await authenticatedRequest(app, session)
        .post('/api/v1/guests/sync')
        .send({});
      const second = await authenticatedRequest(app, session)
        .post('/api/v1/guests/sync')
        .send({});
      const limited = await authenticatedRequest(app, session)
        .post('/api/v1/guests/sync')
        .send({});

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      expect(limited.status).toBe(429);
      expect(Object.keys(limited.body)).toEqual(['error']);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(typeof limited.body.error.message).toBe('string');
      expect(limited.body.error.message.length).toBeGreaterThan(0);
      expect(limited.headers.ratelimit).toContain('r=0');

      // A rate-limited request never reaches the upstream integration.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await GuestVisit.countDocuments({})).toBe(1);
    } finally {
      config.guestSyncRateLimitLimit = originalLimit;
      config.googleFormUrl = originalUrl;
    }
  });

  it('scopes the rate ceiling to the authenticated user', async () => {
    await createTestUser({ adminId: 'rateadmin' });
    const firstSession = await loginTestUser(app, { adminId: 'rateadmin' });
    await createTestUser({
      adminId: 'otheradmin',
      username: 'Other Administrator',
      email: 'other.admin@example.test',
    });
    const secondSession = await loginTestUser(app, { adminId: 'otheradmin' });

    const originalUrl = config.googleFormUrl;
    const originalLimit = config.guestSyncRateLimitLimit;
    config.googleFormUrl = UPSTREAM_URL;
    config.guestSyncRateLimitLimit = 1;

    const fetchMock = vi.fn(async () => upstreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    try {
      const limited = await authenticatedRequest(app, firstSession)
        .post('/api/v1/guests/sync')
        .send({});
      expect(limited.status).toBe(200);

      const rejected = await authenticatedRequest(app, firstSession)
        .post('/api/v1/guests/sync')
        .send({});
      expect(rejected.status).toBe(429);
      expect(rejected.body.error.code).toBe('RATE_LIMITED');

      // A different administrator keeps its own budget.
      const allowed = await authenticatedRequest(app, secondSession)
        .post('/api/v1/guests/sync')
        .send({});
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.insertedCount).toBe(0);
    } finally {
      config.guestSyncRateLimitLimit = originalLimit;
      config.googleFormUrl = originalUrl;
    }
  });

  it('releases the single-flight slot after a failed synchronization so a later request retries', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const originalUrl = config.googleFormUrl;
    const originalLimit = config.guestSyncRateLimitLimit;
    config.googleFormUrl = UPSTREAM_URL;
    config.guestSyncRateLimitLimit = 50;

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream connection failed'))
      .mockResolvedValueOnce(upstreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    const barrier = createSyncBarrier(3);

    try {
      const pending = dispatchSyncRequests(session, 3);
      await barrier.waitForArrival();
      barrier.release();

      const failures = await Promise.all(pending);
      for (const response of failures) {
        expect(response.status).toBe(502);
        expect(Object.keys(response.body)).toEqual(['error']);
        expect(response.body.error.code).toBe('UPSTREAM_INVALID_RESPONSE');
      }

      // The failed attempt reached the upstream integration once and wrote nothing.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await GuestVisit.countDocuments({})).toBe(0);

      // The released slot lets a later request run a fresh attempt.
      const retry = await authenticatedRequest(app, session)
        .post('/api/v1/guests/sync')
        .send({});

      expect(retry.status).toBe(200);
      expect(retry.body.data.insertedCount).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await GuestVisit.countDocuments({})).toBe(1);
    } finally {
      config.guestSyncRateLimitLimit = originalLimit;
      config.googleFormUrl = originalUrl;
    }
  });

  it('keeps the canonical success envelope and never exposes the upstream endpoint', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const originalUrl = config.googleFormUrl;
    config.googleFormUrl = UPSTREAM_URL;

    const fetchMock = vi.fn(async () => upstreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    try {
      const response = await authenticatedRequest(app, session)
        .post('/api/v1/guests/sync')
        .send({ customUrl: ATTACKER_URL });

      expect(response.status).toBe(200);
      expect(Object.keys(response.body)).toEqual(['data']);
      expect(response.body.data).toMatchObject({
        totalFetched: 1,
        fetchedCount: 1,
        insertedCount: 1,
        duplicateCount: 0,
        duplicateSkipped: 0,
        duplicatesInFile: 0,
        existingDuplicateCount: 0,
        invalidCount: 0,
        rejectedCount: 0,
        invalidRows: [],
        invalidRowsTruncated: false,
      });
      expect(typeof response.body.data.lastSyncTime).toBe('string');

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('script.google.com');
      expect(serialized).not.toContain('attacker.example');

      // Only the server-configured endpoint is contacted.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe(UPSTREAM_URL);
      expect(await GuestVisit.countDocuments({})).toBe(1);
    } finally {
      config.googleFormUrl = originalUrl;
    }
  });

  it('still requires an authenticated session and a valid CSRF token', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const originalUrl = config.googleFormUrl;
    config.googleFormUrl = UPSTREAM_URL;

    const fetchMock = vi.fn(async () => upstreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    try {
      const anonymous = await request(app)
        .post('/api/v1/guests/sync')
        .set('Origin', TEST_ORIGIN)
        .send({});
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

      const missingCsrf = await authenticatedRequest(app, {
        ...session,
        csrfToken: '',
      })
        .post('/api/v1/guests/sync')
        .send({});
      expect(missingCsrf.status).toBe(403);
      expect(missingCsrf.body.error.code).toBe('CSRF_FAILED');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await GuestVisit.countDocuments({})).toBe(0);
    } finally {
      config.googleFormUrl = originalUrl;
    }
  });
});
