const mongoose = require('mongoose');
const app = require('../../backend/src/app');
const Transformer = require('../../backend/src/modules/transformers/transformerModel');
const Measurement = require('../../backend/src/modules/measurements/measurementModel');
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

describe('canonical transformer write contract', () => {
  it('stores canonical location, capacity, and independent metadata', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const response = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({
        name: 'Trafo Kanonik',
        feeder: 'FEEDER-01',
        capacity: '100 kVA',
        capacityKva: 100,
        brand: 'Siemens',
        grounding: 'Pentanahan langsung',
        location: { type: 'Point', coordinates: [98.67, 3.66] },
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      name: 'Trafo Kanonik',
      feeder: 'FEEDER-01',
      capacity: '100 kVA',
      capacityKva: 100,
      brand: 'Siemens',
      grounding: 'Pentanahan langsung',
      location: { type: 'Point', coordinates: [98.67, 3.66] },
      rawCoordinates: null,
      source: 'operator',
    });
    expect(response.body.data._id).toBeUndefined();

    const stored = await Transformer.findById(response.body.data.id).lean();
    expect(stored.location.coordinates).toEqual([98.67, 3.66]);
    expect(stored.nameKey).toBe('trafo kanonik');
  });

  it('rejects malformed canonical locations and client-controlled provenance', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const invalidLocations = [
      { type: 'LineString', coordinates: [98.67, 3.66] },
      { type: 'Point', coordinates: [98.67] },
      { type: 'Point', coordinates: [98.67, 3.66, 3.67] },
      { type: 'Point', coordinates: ['98.67', '3.66'] },
    ];

    for (const location of invalidLocations) {
      const response = await authenticatedRequest(app, session)
        .post('/api/v1/transformers')
        .send({ name: 'Trafo Koordinat Salah', location });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }

    const spoofed = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({
        name: 'Trafo Provenance Palsu',
        source: 'html_snapshot',
        sourceMetadata: { sourceRow: 1 },
      });
    expect(spoofed.status).toBe(422);
    expect(spoofed.body.error.code).toBe('UNEXPECTED_FIELD');
    expect(await Transformer.countDocuments({ name: 'Trafo Provenance Palsu' })).toBe(0);
  });

  it('treats PUT as full replacement and clears omitted nullable fields', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const created = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({
        name: 'Trafo Replacement',
        feeder: 'FEEDER-02',
        capacity: '100 kVA',
        brand: 'Schneider',
        grounding: 'Resistive',
        location: { type: 'Point', coordinates: [98.68, 3.67] },
      });
    expect(created.status).toBe(201);

    const missingName = await authenticatedRequest(app, session)
      .put(`/api/v1/transformers/${created.body.data.id}`)
      .send({ feeder: 'FEEDER-03' });
    expect(missingName.status).toBe(422);
    expect(missingName.body.error.code).toBe('VALIDATION_ERROR');

    const replaced = await authenticatedRequest(app, session)
      .put(`/api/v1/transformers/${created.body.data.id}`)
      .send({ name: 'Trafo Replacement Baru' });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data).toMatchObject({
      name: 'Trafo Replacement Baru',
      feeder: null,
      capacity: null,
      capacityKva: null,
      brand: null,
      grounding: null,
      location: null,
      rawCoordinates: null,
      source: 'operator',
    });
  });

  it('retains ambiguous capacity labels but rejects invalid or conflicting capacity', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const ambiguous = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'Trafo Kapasitas Majemuk', capacity: '500/300/865 kVA' });
    expect(ambiguous.status).toBe(201);
    expect(ambiguous.body.data.capacity).toBe('500/300/865 kVA');
    expect(ambiguous.body.data.capacityKva).toBeNull();

    const invalid = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'Trafo Kapasitas Salah', capacity: 'not-a-capacity' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Transformer.countDocuments({ name: 'Trafo Kapasitas Salah' })).toBe(0);

    const mismatch = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'Trafo Kapasitas Tidak Cocok', capacity: '100 kVA', capacityKva: 200 });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Transformer.countDocuments({ name: 'Trafo Kapasitas Tidak Cocok' })).toBe(0);
  });

  it('rejects operational numeric limits outside the canonical domain', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const response = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'Trafo Kapasitas ekstrem', capacityKva: 1_000_001 });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Transformer.countDocuments({ name: 'Trafo Kapasitas ekstrem' })).toBe(0);
  });

  it('rejects conflicting canonical and raw coordinates without mutation', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const response = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({
        name: 'Trafo Konflik Koordinat',
        location: { type: 'Point', coordinates: [98.67, 3.66] },
        rawCoordinates: 'POINT (98.68 3.67)',
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Transformer.countDocuments({ name: 'Trafo Konflik Koordinat' })).toBe(0);
  });

  it('keeps list, anomaly, and map counts consistent with electrical eligibility', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const analyzable = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({
        name: 'Trafo Dapat Dinilai',
        capacity: '100 kVA',
        location: { type: 'Point', coordinates: [98.67, 3.66] },
      });
    const notAnalyzable = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'Trafo Tanpa Kapasitas' });

    await Measurement.create({
      transformerId: analyzable.body.data.id,
      period: 'wbp',
      incoming: { r: 120, s: 80, t: 80, n: 0 },
      source: 'manual',
    });
    await Measurement.create({
      transformerId: notAnalyzable.body.data.id,
      period: 'wbp',
      incoming: { r: 120, s: 80, t: 80, n: 0 },
      source: 'manual',
    });

    const list = await authenticatedRequest(app, session).get('/api/v1/transformers?period=wbp');
    expect(list.status).toBe(200);
    expect(list.body.counts).toMatchObject({
      total: 2,
      analyzable: 1,
      notAnalyzable: 1,
      pincang: 1,
      overload: 0,
    });

    const filtered = await authenticatedRequest(app, session).get(
      '/api/v1/transformers?category=unbalanced&period=wbp',
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].name).toBe('Trafo Dapat Dinilai');

    const anomalies = await authenticatedRequest(app, session).get(
      '/api/v1/transformers/anomalies?category=unbalanced&period=wbp',
    );
    expect(anomalies.status).toBe(200);
    expect(anomalies.body.data).toHaveLength(1);
    expect(anomalies.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(anomalies.body.counts).toMatchObject({
      total: 2,
      analyzable: 1,
      notAnalyzable: 1,
      pincang: 1,
      overload: 0,
    });

    const map = await authenticatedRequest(app, session).get(
      '/api/v1/transformers/map-points?period=wbp',
    );
    expect(map.status).toBe(200);
    expect(map.body.data.type).toBe('FeatureCollection');
    expect(map.body.data.features).toHaveLength(1);
    expect(map.body.data.features[0].geometry.coordinates).toEqual([98.67, 3.66]);
    expect(map.body.data.features[0].properties.visualStatus).toBe('critical');

    const invalidPageSize = await authenticatedRequest(app, session).get(
      '/api/v1/transformers?pageSize=0',
    );
    expect(invalidPageSize.status).toBe(422);
    expect(invalidPageSize.body.error.code).toBe('VALIDATION_ERROR');

    const invalidSearch = await authenticatedRequest(app, session).get(
      `/api/v1/transformers?q=${'a'.repeat(101)}`,
    );
    expect(invalidSearch.status).toBe(422);
    expect(invalidSearch.body.error.code).toBe('VALIDATION_ERROR');

    const invalidAnomalyCategory = await authenticatedRequest(app, session).get(
      '/api/v1/transformers/anomalies?category=unknown&period=wbp',
    );
    expect(invalidAnomalyCategory.status).toBe(422);
    expect(invalidAnomalyCategory.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('fails closed for extreme legacy aggregation values', async () => {
    await createTestUser();
    const session = await loginTestUser(app);
    const transformerId = new mongoose.Types.ObjectId();
    await Transformer.collection.insertOne({
      _id: transformerId,
      name: 'Trafo Legacy Ekstrem',
      nameKey: 'trafo legacy ekstrem',
      capacityKva: 1e307,
    });
    await Measurement.collection.insertOne({
      transformerId,
      period: 'wbp',
      incoming: { r: 1e308, s: 1e308, t: 1e308, n: 1e308 },
      source: 'manual',
    });

    const list = await authenticatedRequest(app, session).get('/api/v1/transformers?period=wbp');
    expect(list.status).toBe(200);
    expect(list.body.counts).toMatchObject({
      total: 1,
      analyzable: 0,
      notAnalyzable: 1,
      pincang: 0,
      overload: 0,
    });
    expect(list.body.data[0].analysis).toMatchObject({
      available: false,
      averageCurrent: null,
      unbalancePercent: null,
      nominalCurrent: null,
      visualStatus: 'unknown',
      recommendationStatus: 'unknown',
      overloaded: null,
      isPincang: false,
      isOverload: false,
    });

    const anomalies = await authenticatedRequest(app, session).get(
      '/api/v1/transformers/anomalies?category=overloaded&period=wbp',
    );
    expect(anomalies.status).toBe(200);
    expect(anomalies.body.data).toHaveLength(0);
  });

  it('serializes list and detail measurements with canonical identifiers and provenance', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const created = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'Trafo Pengukuran Kanonik', capacity: '100 kVA' });
    expect(created.status).toBe(201);

    const measurement = await Measurement.create({
      transformerId: created.body.data.id,
      period: 'wbp',
      incoming: { r: 80, s: 80, t: 80, n: 0 },
      voltage: { r: 220, s: 220, t: 220 },
      source: 'html_snapshot',
      sourceRecordKey: 'html-snapshot:trafo-pengukuran-kanonik:wbp',
    });

    const list = await authenticatedRequest(app, session).get('/api/v1/transformers?period=wbp');
    expect(list.status).toBe(200);
    expect(list.body.data[0].measurement).toMatchObject({
      id: measurement._id.toString(),
      transformerId: created.body.data.id,
      source: 'html_snapshot',
      sourceRecordKey: 'html-snapshot:trafo-pengukuran-kanonik:wbp',
    });
    expect(list.body.data[0].measurement._id).toBeUndefined();

    const detail = await authenticatedRequest(app, session).get(
      `/api/v1/transformers/${created.body.data.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.measurements.wbp).toMatchObject({
      id: measurement._id.toString(),
      source: 'html_snapshot',
      sourceRecordKey: 'html-snapshot:trafo-pengukuran-kanonik:wbp',
    });
    expect(detail.body.data.measurements.wbp._id).toBeUndefined();
    expect(detail.body.data.beban.wbp.measurement._id).toBeUndefined();
  });

  it('enforces one canonical name key across Unicode-equivalent names', async () => {
    await createTestUser();
    const session = await loginTestUser(app);

    const first = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'Café Trafo' });
    expect(first.status).toBe(201);

    const duplicate = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'CAFÉ TRAFO' });
    expect(duplicate.status).toBe(409);

    const greek = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'ΟΣ' });
    expect(greek.status).toBe(201);

    const greekDuplicate = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'οσ' });
    expect(greekDuplicate.status).toBe(409);

    const sharpS = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'Straße' });
    expect(sharpS.status).toBe(201);

    const sharpSDuplicate = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: 'STRASSE' });
    expect(sharpSDuplicate.status).toBe(409);
  });
});
