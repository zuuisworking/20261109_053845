const app = require('../../backend/src/app');
const Transformer = require('../../backend/src/modules/transformers/transformerModel');
const TransformerAlias = require('../../backend/src/modules/transformers/transformerAliasModel');
const transformerAliasService = require('../../backend/src/modules/transformers/transformerAliasService');
const {
  findApprovedAliasResolutions,
} = require('../../backend/src/database/migrateMeasurements');
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

describe('transformer alias registry', () => {
  it('allows only superadmins to approve, list, and delete aliases', async () => {
    await createTestUser({ adminId: 'aliasadmin' });
    const superadminSession = await loginTestUser(app, { adminId: 'aliasadmin' });
    const transformer = await Transformer.create({
      name: 'ML.391',
      feeder: 'FEEDER-ALIAS',
      capacity: '100 kVA',
      capacityKva: 100,
    });

    const created = await authenticatedRequest(app, superadminSession)
      .post('/api/v1/transformer-aliases')
      .send({
        aliasName: 'PDAM TIRTANADI',
        transformerId: transformer._id.toString(),
        reason: 'Disetujui operator setelah verifikasi lapangan.',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.aliasName).toBe('PDAM TIRTANADI');
    expect(created.body.data.aliasKey).toBe('pdam tirtanadi');

    const listed = await authenticatedRequest(app, superadminSession).get(
      '/api/v1/transformer-aliases?q=PDAM&pageSize=10',
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.meta).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });

    await createTestUser({
      adminId: 'aliasoperator',
      username: 'Alias Operator',
      role: 'admin',
      email: 'alias.operator@example.test',
    });
    const operatorSession = await loginTestUser(app, { adminId: 'aliasoperator' });
    const forbidden = await authenticatedRequest(app, operatorSession)
      .post('/api/v1/transformer-aliases')
      .send({
        aliasName: 'Alias Lain',
        transformerId: transformer._id.toString(),
        reason: 'Percobaan tanpa persetujuan superadmin.',
      });
    expect(forbidden.status).toBe(403);

    const deleted = await authenticatedRequest(app, superadminSession).delete(
      `/api/v1/transformer-aliases/${created.body.data._id}`,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toBe(true);
    expect(await TransformerAlias.countDocuments({})).toBe(0);
  });

  it('resolves only an explicitly approved alias to an existing transformer', async () => {
    const transformer = await Transformer.create({
      name: 'ML.391',
      feeder: 'FEEDER-ALIAS',
      capacity: '100 kVA',
      capacityKva: 100,
    });
    await TransformerAlias.create({
      aliasName: 'PDAM TIRTANADI',
      aliasKey: 'pdam tirtanadi',
      transformerId: transformer._id,
      reason: 'Persetujuan operator tersimpan.',
      approvedBy: new transformer._id.constructor(),
      approvedAt: new Date(),
      source: 'static-html',
      sourceVersion: 'protected-html-v1',
    });

    const result = await findApprovedAliasResolutions(
      TransformerAlias,
      Transformer,
      ['PDAM TIRTANADI', 'ML Pancing V 1'],
    );
    expect(result.available).toBe(1);
    expect(result.resolutions.has('pdam tirtanadi')).toBe(true);
    expect(result.resolutions.get('pdam tirtanadi').transformer._id.toString()).toBe(
      transformer._id.toString(),
    );
    expect(result.resolutions.has('ml pancing v 1')).toBe(false);
  });

  it('rejects unknown fields and wrong types on alias writes', async () => {
    await createTestUser({ adminId: 'aliasstrict' });
    const session = await loginTestUser(app, { adminId: 'aliasstrict' });
    const transformer = await Transformer.create({
      name: 'ML.391',
      feeder: 'FEEDER-ALIAS',
      capacity: '100 kVA',
      capacityKva: 100,
    });

    const unexpected = await authenticatedRequest(app, session)
      .post('/api/v1/transformer-aliases')
      .send({
        aliasName: 'Alias Provenance Palsu',
        transformerId: transformer._id.toString(),
        reason: 'Percobaan menyalin field server.',
        source: 'operator',
        aliasKey: 'alias-dibuat-pelanggan',
      });
    expect(unexpected.status).toBe(422);
    expect(unexpected.body.error.code).toBe('UNEXPECTED_FIELD');
    expect(unexpected.body.error.message).toBe('Permintaan tidak valid.');
    expect(unexpected.body.error.details.map((detail) => detail.path)).toEqual(
      expect.arrayContaining(['aliasKey', 'source']),
    );

    const wrongTypes = [
      {
        payload: { aliasName: 123, transformerId: transformer._id.toString(), reason: 'Tipe salah.' },
        path: 'aliasName',
      },
      {
        payload: {
          aliasName: 'Alias Tipe Salah',
          transformerId: transformer._id.toString(),
          reason: { text: 'objek' },
        },
        path: 'reason',
      },
      {
        payload: { aliasName: 'Alias Tipe Salah', transformerId: 12345, reason: 'Tipe salah.' },
        path: 'transformerId',
      },
      {
        payload: {
          aliasName: 'Alias Tipe Salah',
          transformerId: transformer._id.toString(),
          reason: 'Tipe salah.',
          sourceVersion: { version: 'v2' },
        },
        path: 'sourceVersion',
      },
    ];

    for (const { payload, path } of wrongTypes) {
      const response = await authenticatedRequest(app, session)
        .post('/api/v1/transformer-aliases')
        .send(payload);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.map((detail) => detail.path)).toContain(path);
    }

    const missing = await authenticatedRequest(app, session)
      .post('/api/v1/transformer-aliases')
      .send({ aliasName: 'Alias Tidak Lengkap' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(await TransformerAlias.countDocuments({})).toBe(0);
  });

  it('rejects overlong alias fields and never persists a non-string sourceVersion', async () => {
    await createTestUser({ adminId: 'aliaslimits' });
    const session = await loginTestUser(app, { adminId: 'aliaslimits' });
    const transformer = await Transformer.create({
      name: 'ML.391',
      feeder: 'FEEDER-ALIAS',
      capacity: '100 kVA',
      capacityKva: 100,
    });

    const overlongName = await authenticatedRequest(app, session)
      .post('/api/v1/transformer-aliases')
      .send({
        aliasName: 'A'.repeat(201),
        transformerId: transformer._id.toString(),
        reason: 'Alasan valid.',
      });
    expect(overlongName.status).toBe(422);
    expect(overlongName.body.error.code).toBe('VALIDATION_ERROR');
    expect(overlongName.body.error.details.map((detail) => detail.path)).toContain('aliasName');

    const overlongReason = await authenticatedRequest(app, session)
      .post('/api/v1/transformer-aliases')
      .send({
        aliasName: 'Alias Alasan Panjang',
        transformerId: transformer._id.toString(),
        reason: 'B'.repeat(1001),
      });
    expect(overlongReason.status).toBe(422);
    expect(overlongReason.body.error.code).toBe('VALIDATION_ERROR');

    const overlongVersion = await authenticatedRequest(app, session)
      .post('/api/v1/transformer-aliases')
      .send({
        aliasName: 'Alias Versi Panjang',
        transformerId: transformer._id.toString(),
        reason: 'Alasan valid.',
        sourceVersion: 'v'.repeat(101),
      });
    expect(overlongVersion.status).toBe(422);
    expect(overlongVersion.body.error.code).toBe('VALIDATION_ERROR');
    expect(await TransformerAlias.countDocuments({})).toBe(0);

    // The model keeps the same bounds for write paths that bypass the API.
    const modelOverflow = await TransformerAlias.create({
      aliasName: 'Alias Model Terlalu Panjang',
      aliasKey: 'alias model terlalu panjang',
      transformerId: transformer._id,
      reason: 'Alasan valid.',
      approvedBy: new transformer._id.constructor(),
      approvedAt: new Date(),
      source: 'static-html',
      sourceVersion: 'v'.repeat(101),
    }).catch((error) => error);
    expect(modelOverflow).toBeInstanceOf(Error);
    expect(modelOverflow.name).toBe('ValidationError');
    expect(await TransformerAlias.countDocuments({})).toBe(0);

    // A structured sourceVersion is rejected instead of being stringified.
    const structuredVersion = await transformerAliasService
      .create({
        aliasName: 'Alias Versi Objek',
        transformerId: transformer._id.toString(),
        reason: 'Alasan valid.',
        approvedBy: new transformer._id.constructor(),
        sourceVersion: { version: 'v2' },
      })
      .catch((error) => error);
    expect(structuredVersion).toBeInstanceOf(Error);
    expect(structuredVersion.statusCode).toBe(422);
    expect(structuredVersion.details[0].path).toBe('sourceVersion');
    expect(await TransformerAlias.countDocuments({})).toBe(0);
  });

  it('rejects malformed pagination and overlong search terms with canonical 422 errors', async () => {
    await createTestUser({ adminId: 'aliaspage' });
    const session = await loginTestUser(app, { adminId: 'aliaspage' });

    const malformedQueries = [
      { query: '?page=abc', path: 'page' },
      { query: '?page=0', path: 'page' },
      { query: '?page=-1', path: 'page' },
      { query: '?page=1.5', path: 'page' },
      { query: '?page=1000001', path: 'page' },
      { query: '?pageSize=0', path: 'pageSize' },
      { query: '?pageSize=101', path: 'pageSize' },
      { query: '?pageSize=abc', path: 'pageSize' },
    ];

    for (const { query, path } of malformedQueries) {
      const response = await authenticatedRequest(app, session).get(
        `/api/v1/transformer-aliases${query}`,
      );
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Permintaan tidak valid.');
      expect(response.body.error.details[0]).toMatchObject({ path, code: 'VALIDATION_ERROR' });
    }

    const longSearch = await authenticatedRequest(app, session).get(
      `/api/v1/transformer-aliases?q=${'x'.repeat(101)}`,
    );
    expect(longSearch.status).toBe(422);
    expect(longSearch.body.error.code).toBe('VALIDATION_ERROR');
    expect(longSearch.body.error.details[0]).toMatchObject({ path: 'q', code: 'VALIDATION_ERROR' });

    const boundarySearch = await authenticatedRequest(app, session).get(
      `/api/v1/transformer-aliases?q=${'x'.repeat(100)}`,
    );
    expect(boundarySearch.status).toBe(200);
    expect(boundarySearch.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  });

  it('returns stable pagination metadata for valid alias queries', async () => {
    await createTestUser({ adminId: 'aliasmeta' });
    const session = await loginTestUser(app, { adminId: 'aliasmeta' });
    const transformer = await Transformer.create({
      name: 'ML.391',
      feeder: 'FEEDER-ALIAS',
      capacity: '100 kVA',
      capacityKva: 100,
    });

    const empty = await authenticatedRequest(app, session).get('/api/v1/transformer-aliases');
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });

    for (const aliasName of ['PDAM TIRTANADI', 'PLN CABANG']) {
      const created = await authenticatedRequest(app, session)
        .post('/api/v1/transformer-aliases')
        .send({
          aliasName,
          transformerId: transformer._id.toString(),
          reason: 'Persetujuan operator tersimpan.',
          sourceVersion: 'protected-html-v2',
        });
      expect(created.status).toBe(201);
      expect(created.body.data.sourceVersion).toBe('protected-html-v2');
    }

    const firstPage = await authenticatedRequest(app, session).get(
      '/api/v1/transformer-aliases?page=1&pageSize=1',
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(1);
    expect(firstPage.body.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });

    const secondPage = await authenticatedRequest(app, session).get(
      '/api/v1/transformer-aliases?page=2&pageSize=1',
    );
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.meta).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2 });

    const beyondLastPage = await authenticatedRequest(app, session).get(
      '/api/v1/transformer-aliases?page=9&pageSize=1',
    );
    expect(beyondLastPage.status).toBe(200);
    expect(beyondLastPage.body.data).toEqual([]);
    expect(beyondLastPage.body.meta).toEqual({ page: 9, pageSize: 1, total: 2, totalPages: 2 });

    const filtered = await authenticatedRequest(app, session).get(
      '/api/v1/transformer-aliases?q=PDAM&pageSize=10',
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.meta).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
  });
});
