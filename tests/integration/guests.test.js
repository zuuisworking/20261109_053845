const config = require('../../backend/src/config');
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

describe('Google Forms guest synchronization', () => {
  it('uses a versioned, byte-length-delimited fingerprint over canonical source fields', () => {
    // SHA-256 of "v2|10:2026-11-26|8:évelyne|11:08123456789".
    // The name length is 8 bytes, not 7 JavaScript characters.
    const fingerprint = guestService.generateFingerprint(
      '2026-11-26',
      'évelyne',
      '08123456789'
    );

    expect(fingerprint).toBe(
      '73037804a73088b1565ed8cdf1da9940524b8bd6349bd0e468a77ce687941a9a'
    );
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);

    const equivalentFingerprint = guestService.generateFingerprint(
      ' 2026-11-26 ',
      '  Évelyne  ',
      '+0812-3456-789'
    );
    expect(equivalentFingerprint).toBe(fingerprint);

    expect(
      guestService.generateFingerprint('2026-11-27', 'évelyne', '08123456789')
    ).not.toBe(fingerprint);
    expect(
      guestService.generateFingerprint('2026-11-26', 'évelynea', '08123456789')
    ).not.toBe(fingerprint);
    expect(
      guestService.generateFingerprint('2026-11-26', 'évelyne', '08123456788')
    ).not.toBe(fingerprint);
  });

  it('does not collide when canonical fields have ambiguous concatenation boundaries', () => {
    const firstFields = ['2026-11-26T10:00|00', '00', '0812'];
    const secondFields = ['2026-11-26T10:00', '00|00', '0812'];

    // A separator-only encoding is ambiguous: both field tuples produce this
    // same text even though their boundaries differ.
    expect(firstFields.join('|')).toBe(secondFields.join('|'));

    const firstFingerprint = guestService.generateFingerprint(...firstFields);
    const secondFingerprint = guestService.generateFingerprint(...secondFields);
    expect(firstFingerprint).not.toBe(secondFingerprint);
  });

  it('retains parsed, raw, and synchronization provenance with the canonical source', async () => {
    const originalUrl = config.googleFormUrl;
    config.googleFormUrl = 'https://script.google.com/macros/s/test/exec';

    const payload = [
      {
        Timestamp: '2026-11-26T10:30:00+07:00',
        'Nama Tamu': 'Budi Santoso',
        'No HP': '08123456789',
        Keperluan: 'Rapat',
        'ID Pelanggan': 'CUST-001',
      },
      {
        Timestamp: 'not-a-real-timestamp',
        'Nama Tamu': 'Siti Aminah',
        'No HP': '08129876543',
        Keperluan: 'Pengujian',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const syncStartedAt = Date.now();
    try {
      const result = await guestService.syncFromGoogleForm();
      const syncCompletedAt = Date.now();

      expect(result).toMatchObject({
        totalFetched: 2,
        insertedCount: 2,
        duplicateCount: 0,
        rejectedCount: 0,
      });

      const guests = await GuestVisit.find({}).sort({ guestName: 1 }).lean();
      expect(guests).toHaveLength(2);

      const [budi, siti] = guests;
      expect(budi.timestamp).toBeInstanceOf(Date);
      expect(budi.timestamp.toISOString()).toBe('2026-11-26T03:30:00.000Z');
      expect(budi.timestampRaw).toBe('2026-11-26T10:30:00+07:00');
      expect(budi.syncedAt).toBeInstanceOf(Date);
      expect(budi.syncedAt.getTime()).toBeGreaterThanOrEqual(syncStartedAt);
      expect(budi.syncedAt.getTime()).toBeLessThanOrEqual(syncCompletedAt);
      expect(budi.source).toBe('google_form');
      expect(budi.syncFingerprint).toBe(
        guestService.generateFingerprint(
          '2026-11-26T10:30:00+07:00',
          'Budi Santoso',
          '08123456789'
        )
      );

      expect(siti.timestamp).toBeNull();
      expect(siti.timestampRaw).toBe('not-a-real-timestamp');
      expect(siti.syncedAt).toBeInstanceOf(Date);
      expect(siti.syncedAt.getTime()).toBeGreaterThanOrEqual(syncStartedAt);
      expect(siti.syncedAt.getTime()).toBeLessThanOrEqual(syncCompletedAt);
      expect(siti.source).toBe('google_form');
    } finally {
      config.googleFormUrl = originalUrl;
      vi.unstubAllGlobals();
    }
  });

  it('fails closed when the server has no configured endpoint', async () => {
    await createTestUser();
    const session = await loginTestUser(app);
    const originalUrl = config.googleFormUrl;
    config.googleFormUrl = '';

    try {
      const response = await authenticatedRequest(app, session)
        .post('/api/v1/guests/sync')
        .send({ customUrl: 'https://attacker.example/guest-data' });

      expect(response.status).toBe(503);
      expect(response.body.error.message).toContain('belum dikonfigurasi');
      expect(await GuestVisit.countDocuments({})).toBe(0);

      const list = await authenticatedRequest(app, session).get('/api/v1/guests');
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([]);
      expect(list.body.meta).toMatchObject({
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
      });
    } finally {
      config.googleFormUrl = originalUrl;
    }
  });

  it('rejects a configured endpoint outside the server allowlist', async () => {
    await createTestUser();
    const session = await loginTestUser(app);
    const originalUrl = config.googleFormUrl;
    config.googleFormUrl = 'https://attacker.example/exec';

    try {
      const response = await authenticatedRequest(app, session).post('/api/v1/guests/sync');
      expect(response.status).toBe(503);
      expect(await GuestVisit.countDocuments({})).toBe(0);
    } finally {
      config.googleFormUrl = originalUrl;
    }
  });
});
