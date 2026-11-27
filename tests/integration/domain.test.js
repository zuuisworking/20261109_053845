const app = require('../../backend/src/app');
const Transformer = require('../../backend/src/modules/transformers/transformerModel');
const Measurement = require('../../backend/src/modules/measurements/measurementModel');
const Customer = require('../../backend/src/modules/customers/customerModel');
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

describe('transformer, measurement, and dashboard integration', () => {
  it('stores canonical longitude-first coordinates and keeps one record per period', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const created = await authenticatedRequest(app, session).post('/api/v1/transformers').send({
      name: 'Trafo Integrasi',
      feeder: 'FEEDER-01',
      capacity: '100 kVA',
      location: { type: 'Point', coordinates: [98.67, 3.66] },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.location.coordinates).toEqual([98.67, 3.66]);
    expect(created.body.data.capacityKva).toBe(100);

    const transformerId = created.body.data.id;
    const measurement = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformerId}`)
      .send({
        period: 'wbp',
        incoming: { r: 140, s: 110, t: 110, n: 0 },
        voltage: { r: 220, s: 220, t: 220 },
      });
    expect(measurement.status).toBe(200);
    expect(await Measurement.countDocuments({ transformerId })).toBe(1);

    const updated = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformerId}`)
      .send({
        period: 'wbp',
        incoming: { r: 145, s: 110, t: 110, n: 0 },
        voltage: { r: 220, s: 220, t: 220 },
      });
    expect(updated.status).toBe(200);
    expect(await Measurement.countDocuments({ transformerId })).toBe(1);

    const detail = await authenticatedRequest(app, session).get(
      `/api/v1/transformers/${transformerId}`
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.analysis.wbp.unbalance).toBeGreaterThan(10);
    expect(detail.body.data.analysis.wbp.isPincang).toBe(true);
    expect(detail.body.data.analysis.wbp.loadingPercent).toBeGreaterThan(80);
  });

  it('normalizes customer power representations and rejects mismatched values', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const numericPower = await authenticatedRequest(app, session)
      .post('/api/v1/customers')
      .send({
        customerId: '520100000101',
        name: 'Pelanggan Daya Numerik',
        powerVa: 1300,
      });
    expect(numericPower.status).toBe(201);
    expect(numericPower.body.data.id).toBeTruthy();
    expect(numericPower.body.data._id).toBeUndefined();
    expect(numericPower.body.data.power).toBe('1300');
    expect(numericPower.body.data.powerVa).toBe(1300);

    const matchingPower = await authenticatedRequest(app, session)
      .post('/api/v1/customers')
      .send({
        customerId: '520100000102',
        name: 'Pelanggan Daya Sesuai',
        power: '1.300',
        powerVa: 1300,
      });
    expect(matchingPower.status).toBe(201);
    expect(matchingPower.body.data.power).toBe('1.300');
    expect(matchingPower.body.data.powerVa).toBe(1300);

    const mismatchedPower = await authenticatedRequest(app, session)
      .post('/api/v1/customers')
      .send({
        customerId: '520100000103',
        name: 'Pelanggan Daya Tidak Sesuai',
        power: '900',
        powerVa: 1300,
      });
    expect(mismatchedPower.status).toBe(422);
    expect(mismatchedPower.body.error.code).toBe('POWER_VALUE_MISMATCH');
    expect(await Customer.countDocuments({ customerId: '520100000103' })).toBe(0);

    const dottedThousandsMismatch = await authenticatedRequest(app, session)
      .post('/api/v1/customers')
      .send({
        customerId: '520100000104',
        name: 'Pelanggan Daya Titik Ribuan Tidak Sesuai',
        power: '1.300',
        powerVa: 900,
      });
    expect(dottedThousandsMismatch.status).toBe(422);
    expect(dottedThousandsMismatch.body.error.code).toBe('POWER_VALUE_MISMATCH');
    expect(await Customer.countDocuments({ customerId: '520100000104' })).toBe(0);
  });

  it('rejects a customer power mismatch without overwriting the stored representation', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const created = await authenticatedRequest(app, session)
      .post('/api/v1/customers')
      .send({
        customerId: '520100000105',
        name: 'Pelanggan Daya Diagnostic',
        power: '1.300',
        powerVa: 1300,
      });
    expect(created.status).toBe(201);

    const mismatch = await authenticatedRequest(app, session)
      .put(`/api/v1/customers/${created.body.data.id}`)
      .send({
        customerId: '520100000105',
        name: 'Pelanggan Daya Diagnostic',
        tariff: null,
        address: null,
        power: '1.300',
        powerVa: 900,
      });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('POWER_VALUE_MISMATCH');

    const stored = await Customer.findById(created.body.data.id).lean();
    expect(stored.powerRaw).toBe('1.300');
    expect(stored.powerVa).toBe(1300);
  });

  it('returns dashboard totals, GIS points, and recent anomaly records', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    await Transformer.create({
      name: 'Trafo Dashboard',
      feeder: 'FEEDER-02',
      capacity: '100 kVA',
      capacityKva: 100,
      location: { type: 'Point', coordinates: [98.68, 3.67] },
    });
    const transformer = await Transformer.findOne({ name: 'Trafo Dashboard' });
    await Measurement.create({
      transformerId: transformer._id,
      period: 'wbp',
      incoming: { r: 24, s: 19, t: 19, n: 0 },
      source: 'manual',
    });

    const dashboard = await authenticatedRequest(app, session).get('/api/v1/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.transformerTotal).toBe(1);
    expect(dashboard.body.data.transformers.periods.wbp.unbalance).toBe(1);
    expect(dashboard.body.data.mapPoints).toHaveLength(1);
    expect(dashboard.body.data.mapPoints[0].geometry.coordinates).toEqual([98.68, 3.67]);
    expect(dashboard.body.data.mapPoints[0].properties.visualStatus).toBe('warning');
    expect(dashboard.body.data.pincangList).toHaveLength(1);
    expect(dashboard.body.data.pincangList[0].name).toBe('Trafo Dashboard');
  });

  it('uses the selected dashboard period and counts missing-capacity records as not analyzable', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const analyzable = await Transformer.create({
      name: 'Trafo Dua Periode',
      feeder: 'FEEDER-PERIOD',
      capacity: '100 kVA',
      capacityKva: 100,
      location: { type: 'Point', coordinates: [98.68, 3.67] },
    });
    const withoutCapacity = await Transformer.create({
      name: 'Trafo Tanpa Kapasitas',
      feeder: 'FEEDER-PERIOD',
      location: { type: 'Point', coordinates: [98.69, 3.68] },
    });

    await Measurement.create({
      transformerId: analyzable._id,
      period: 'wbp',
      incoming: { r: 24, s: 19, t: 19, n: 0 },
      source: 'manual',
    });
    await Measurement.create({
      transformerId: analyzable._id,
      period: 'lwbp',
      incoming: { r: 100, s: 100, t: 100, n: 0 },
      source: 'manual',
    });
    await Measurement.create({
      transformerId: withoutCapacity._id,
      period: 'wbp',
      incoming: { r: 120, s: 80, t: 80, n: 0 },
      source: 'manual',
    });

    const wbp = await authenticatedRequest(app, session).get('/api/v1/dashboard?period=wbp');
    expect(wbp.status).toBe(200);
    expect(wbp.body.data.period).toBe('wbp');
    expect(wbp.body.data.summary).toMatchObject({
      transformerTotal: 2,
      analyzableTotal: 1,
      unbalancedTotal: 1,
      overloadedTotal: 0,
      notAnalyzableTotal: 1,
    });
    expect(wbp.body.data.anomalies.unbalanced).toHaveLength(1);
    expect(wbp.body.data.anomalies.overloaded).toHaveLength(0);

    const lwbp = await authenticatedRequest(app, session).get('/api/v1/dashboard?period=lwbp');
    expect(lwbp.status).toBe(200);
    expect(lwbp.body.data.period).toBe('lwbp');
    expect(lwbp.body.data.summary).toMatchObject({
      transformerTotal: 2,
      analyzableTotal: 1,
      unbalancedTotal: 0,
      overloadedTotal: 0,
      notAnalyzableTotal: 1,
    });
    expect(lwbp.body.data.anomalies.unbalanced).toHaveLength(0);

    const invalid = await authenticatedRequest(app, session).get('/api/v1/dashboard?period=invalid');
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });
});
