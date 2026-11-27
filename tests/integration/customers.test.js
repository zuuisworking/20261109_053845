const app = require('../../backend/src/app');
const GuestVisit = require('../../backend/src/modules/guests/guestModel');
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

describe('canonical customer and guest contracts', () => {
  it('returns canonical customer identifiers and source provenance', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const created = await authenticatedRequest(app, session)
      .post('/api/v1/customers')
      .send({
        customerId: '520100000201',
        name: 'Pelanggan Kanonik',
        tariff: 'R1',
        power: '1.300',
        powerVa: 1300,
        address: 'Labuhan',
      });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      customerId: '520100000201',
      name: 'Pelanggan Kanonik',
      tariff: 'R1',
      power: '1.300',
      powerVa: 1300,
      address: 'Labuhan',
      source: 'operator',
    });
    expect(created.body.data._id).toBeUndefined();

    const list = await authenticatedRequest(app, session).get('/api/v1/customers?page=1&pageSize=10');
    expect(list.status).toBe(200);
    expect(list.body.meta).toMatchObject({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: created.body.data.id, source: 'operator' });
    expect(list.body.data[0]._id).toBeUndefined();

    const detail = await authenticatedRequest(app, session).get(
      `/api/v1/customers/${created.body.data.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(created.body.data.id);
    expect(detail.body.data._id).toBeUndefined();
  });

  it('treats customer PUT as a validated full replacement without changing provenance', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const created = await authenticatedRequest(app, session)
      .post('/api/v1/customers')
      .send({
        customerId: '520100000202',
        name: 'Pelanggan Replacement',
        tariff: 'R1',
        power: '900',
        address: 'Alamat lama',
      });
    expect(created.status).toBe(201);

    const replaced = await authenticatedRequest(app, session)
      .put(`/api/v1/customers/${created.body.data.id}`)
      .send({
        customerId: '520100000202',
        name: 'Pelanggan Replacement Baru',
      });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data).toMatchObject({
      id: created.body.data.id,
      customerId: '520100000202',
      name: 'Pelanggan Replacement Baru',
      tariff: null,
      power: null,
      powerVa: null,
      address: null,
      source: 'operator',
    });
  });

  it('rejects unknown customer fields and invalid pagination or identifiers', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const unexpected = await authenticatedRequest(app, session)
      .post('/api/v1/customers')
      .send({
        customerId: '520100000203',
        name: 'Pelanggan Provenance Palsu',
        source: 'operator_import',
      });
    expect(unexpected.status).toBe(422);
    expect(unexpected.body.error.code).toBe('UNEXPECTED_FIELD');

    const invalidPageSize = await authenticatedRequest(app, session).get(
      '/api/v1/customers?pageSize=0',
    );
    expect(invalidPageSize.status).toBe(422);
    expect(invalidPageSize.body.error.code).toBe('VALIDATION_ERROR');

    const invalidId = await authenticatedRequest(app, session)
      .post('/api/v1/customers')
      .send({ customerId: '12345', name: 'ID Pendek' });
    expect(invalidId.status).toBe(422);
    expect(invalidId.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns canonical guest identifiers and canonical pagination', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const guest = await GuestVisit.create({
      syncFingerprint: 'fingerprint-canonical-guest',
      timestamp: new Date('2026-11-27T01:02:03.000Z'),
      timestampRaw: '2026-11-27 01:02:03',
      syncedAt: new Date('2026-11-27T01:03:00.000Z'),
      guestName: 'Tamu Kanonik',
      phone: '08123456789',
      customerId: '520100000204',
      purpose: 'Kunjungan',
      source: 'google_form',
    });

    const list = await authenticatedRequest(app, session).get('/api/v1/guests?page=1&pageSize=10');
    expect(list.status).toBe(200);
    expect(list.body.meta).toMatchObject({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(list.body.data[0]).toMatchObject({
      id: guest._id.toString(),
      guestName: 'Tamu Kanonik',
      customerId: '520100000204',
      timestamp: '2026-11-27T01:02:03.000Z',
      timestampRaw: '2026-11-27 01:02:03',
      source: 'google_form',
      syncFingerprint: 'fingerprint-canonical-guest',
    });
    expect(list.body.data[0]._id).toBeUndefined();
  });
});
