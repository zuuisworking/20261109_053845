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

async function createTransformerAndSession() {
  await createTestUser();
  const session = await loginTestUser(app);
  const transformer = await Transformer.create({
    name: 'Trafo Pengukuran',
    feeder: 'FEEDER-MEASUREMENT',
    capacity: '100 kVA',
    capacityKva: 100,
    brand: 'Merek Lama',
    grounding: 'Ada',
    location: { type: 'Point', coordinates: [98.67, 3.66] },
  });
  return { session, transformer };
}

const completeVoltage = { r: 220, s: 220, t: 220 };
const completeIncoming = { r: 0, s: 0, t: 0, n: 0 };

describe('manual measurement contract', () => {
  it('uses PUT for creation and requires every manual phase', async () => {
    const { session, transformer } = await createTransformerAndSession();

    const unsupportedPost = await authenticatedRequest(app, session)
      .post(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
      });
    expect(unsupportedPost.status).toBe(405);
    expect(unsupportedPost.body.error.code).toBe('METHOD_NOT_ALLOWED');
    expect(unsupportedPost.headers.allow).toBe('GET, PUT');

    const missingNeutral = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: { r: 0, s: 0, t: 0 },
      });
    expect(missingNeutral.status).toBe(422);
    expect(missingNeutral.body.error.code).toBe('VALIDATION_ERROR');

    const missingVoltage = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: { r: 220, t: 220 },
        incoming: completeIncoming,
      });
    expect(missingVoltage.status).toBe(422);
    expect(missingVoltage.body.error.code).toBe('VALIDATION_ERROR');

    const created = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
      });
    expect(created.status).toBe(200);
    expect(created.body.data.source).toBe('manual');
    expect(created.body.data.measurementDate).toBeNull();
    expect(created.body.data.measurementTime).toBeNull();
    expect(created.body.data.branches).toEqual([]);

    const detail = await authenticatedRequest(app, session).get(
      `/api/v1/transformers/${transformer._id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.analysis.wbp.iAvg).toBe(0);
    expect(detail.body.data.analysis.wbp.unbalance).toBeNull();
    expect(detail.body.data.analysis.wbp.loadingPercent).toBeNull();
    expect(detail.body.data.analysis.wbp.isApplicable).toBe(false);
    expect(detail.body.data.analysis.wbp.isPincang).toBe(false);
  });

  it('replaces the current period and clears omitted date and time', async () => {
    const { session, transformer } = await createTransformerAndSession();

    await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: { r: 10, s: 10, t: 10, n: 1 },
        branches: [
          { name: 'Jurusan Lama', r: 10, s: 10, t: 10, n: 1, fuse: '10 A', note: 'Lama' },
        ],
        measurementDate: '2026-11-26',
        measurementTime: '08:30',
      });

    const replaced = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: { r: 20, s: 20, t: 20, n: 2 },
      });

    expect(replaced.status).toBe(200);
    expect(replaced.body.data.incoming).toMatchObject({ r: 20, s: 20, t: 20, n: 2 });
    expect(replaced.body.data.branches).toEqual([]);
    expect(replaced.body.data.measurementDate).toBeNull();
    expect(replaced.body.data.measurementTime).toBeNull();
    expect(await Measurement.countDocuments({ transformerId: transformer._id, period: 'wbp' })).toBe(1);
  });

  it('rejects invalid or non-strict date and time without mutating the record', async () => {
    const { session, transformer } = await createTransformerAndSession();

    const created = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
        measurementDate: '2026-11-26',
        measurementTime: '08:30',
      });
    expect(created.status).toBe(200);
    expect(created.body.data.measurementDate).toBe('2026-11-26');
    expect(created.body.data.measurementTime).toBe('08:30');
    expect(created.body.data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const invalidDate = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
        measurementDate: '2026-02-30',
      });
    expect(invalidDate.status).toBe(422);

    const invalidTime = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
        measurementTime: '24:00',
      });
    expect(invalidTime.status).toBe(422);

    const stored = await Measurement.findOne({
      transformerId: transformer._id,
      period: 'wbp',
    }).lean();
    expect(stored.measurementDate.toISOString()).toBe('2026-11-26T00:00:00.000Z');
    expect(stored.measurementTime).toBe('08:30');
  });

  it('rejects unknown fields, aliases, and numeric strings', async () => {
    const { session, transformer } = await createTransformerAndSession();
    const endpoint = `/api/v1/measurements/${transformer._id}`;

    const unknownTopLevel = await authenticatedRequest(app, session)
      .put(endpoint)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
        source: 'html_snapshot',
        isBaseline: true,
      });
    expect(unknownTopLevel.status).toBe(422);
    expect(unknownTopLevel.body.error.code).toBe('UNEXPECTED_FIELD');

    const legacyAliases = await authenticatedRequest(app, session)
      .put(endpoint)
      .send({
        periode: 'wbp',
        tegangan: completeVoltage,
        arusIncoming: completeIncoming,
        jurusan: [],
        tanggalUkur: '2026-11-26',
        jamUkur: '08:30',
      });
    expect(legacyAliases.status).toBe(422);
    expect(legacyAliases.body.error.code).toBe('UNEXPECTED_FIELD');

    const unknownBranchField = await authenticatedRequest(app, session)
      .put(endpoint)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
        branches: [{ nama: 'Jurusan Legacy', ket: 'Legacy' }],
      });
    expect(unknownBranchField.status).toBe(422);
    expect(unknownBranchField.body.error.code).toBe('UNEXPECTED_FIELD');

    const numericString = await authenticatedRequest(app, session)
      .put(endpoint)
      .send({
        period: 'wbp',
        voltage: { r: '220', s: 220, t: 220 },
        incoming: completeIncoming,
      });
    expect(numericString.status).toBe(422);
    expect(numericString.body.error.code).toBe('VALIDATION_ERROR');

    expect(await Measurement.countDocuments({ transformerId: transformer._id })).toBe(0);
  });

  it('rejects currents outside the canonical operational limit', async () => {
    const { session, transformer } = await createTransformerAndSession();

    const response = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: { r: 100001, s: 100, t: 100, n: 0 },
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Measurement.countDocuments({ transformerId: transformer._id })).toBe(0);
  });

  it('persists canonical branch fields and does not mutate transformer metadata', async () => {
    const { session, transformer } = await createTransformerAndSession();

    const response = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
        branches: [
          { name: 'Jurusan A', r: 1, s: 2, t: 3, n: 0, fuse: '10 A', note: 'Keterangan' },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.branches).toEqual([
      { name: 'Jurusan A', r: 1, s: 2, t: 3, n: 0, fuse: '10 A', note: 'Keterangan' },
    ]);
    expect(response.body.data.branches[0]).not.toHaveProperty('nama');
    expect(response.body.data.branches[0]).not.toHaveProperty('ket');

    const storedMeasurement = await Measurement.findOne({
      transformerId: transformer._id,
      period: 'wbp',
    }).lean();
    expect(storedMeasurement.branches[0]).not.toHaveProperty('nama');
    expect(storedMeasurement.branches[0]).not.toHaveProperty('ket');

    const storedTransformer = await Transformer.findById(transformer._id).lean();
    expect(storedTransformer.brand).toBe('Merek Lama');
    expect(storedTransformer.grounding).toBe('Ada');
  });

  it('returns the canonical WBP/LWBP measurement shape', async () => {
    const { session, transformer } = await createTransformerAndSession();

    await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
      });

    const response = await authenticatedRequest(app, session).get(
      `/api/v1/measurements/${transformer._id}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.transformerId).toBe(transformer._id.toString());
    expect(response.body.data.wbp).toMatchObject({
      period: 'wbp',
      source: 'manual',
      measurementDate: null,
      measurementTime: null,
      branches: [],
    });
    expect(response.body.data.wbp.id).toMatch(/^[a-f0-9]{24}$/);
    expect(response.body.data.wbp.sourceRecordKey).toBeNull();
    expect(response.body.data.lwbp).toBeNull();
  });

  it('handles concurrent first writes for the same period without duplicate records', async () => {
    const { session, transformer } = await createTransformerAndSession();
    const endpoint = `/api/v1/measurements/${transformer._id}`;
    const payload = {
      period: 'wbp',
      voltage: completeVoltage,
      incoming: { r: 10, s: 10, t: 10, n: 1 },
    };

    const responses = await Promise.all([
      authenticatedRequest(app, session).put(endpoint).send(payload),
      authenticatedRequest(app, session).put(endpoint).send(payload),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await Measurement.countDocuments({ transformerId: transformer._id, period: 'wbp' })).toBe(1);
  });

  it('keeps one WBP and one LWBP document per transformer', async () => {
    const { session, transformer } = await createTransformerAndSession();

    const wbp = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
      });
    expect(wbp.status).toBe(200);

    const lwbp = await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'lwbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
      });
    expect(lwbp.status).toBe(200);

    await authenticatedRequest(app, session)
      .put(`/api/v1/measurements/${transformer._id}`)
      .send({
        period: 'wbp',
        voltage: completeVoltage,
        incoming: completeIncoming,
      });

    expect(await Measurement.countDocuments({ transformerId: transformer._id })).toBe(2);
    expect(await Measurement.countDocuments({ transformerId: transformer._id, period: 'wbp' })).toBe(1);
    expect(await Measurement.countDocuments({ transformerId: transformer._id, period: 'lwbp' })).toBe(1);
  });
});
