const app = require('../../backend/src/app');
const Transformer = require('../../backend/src/modules/transformers/transformerModel');
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

const NFC_NAME = 'Caf\u00e9 Trafo';
const NFD_NAME = 'Cafe\u0301 TRAFO';

beforeAll(async () => {
  await connectTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

async function previewTransformers(session, csv, filename = 'trafo.csv') {
  return authenticatedRequest(app, session)
    .post('/api/v1/imports/preview')
    .field('kind', 'transformer')
    .field('format', 'csv')
    .attach('file', Buffer.from(csv, 'utf8'), {
      filename,
      contentType: 'text/csv',
    });
}

function commitImport(session, previewData) {
  return authenticatedRequest(app, session)
    .post('/api/v1/imports/commit')
    .send({
      importJobId: previewData.importJobId,
      previewToken: previewData.previewToken,
    });
}

describe('transformer import target lookup uses the canonical name key', () => {
  beforeEach(async () => {
    await createTestUser();
  });

  it('matches a Unicode-equivalent import row against the existing transformer', async () => {
    const session = await loginTestUser(app);
    const created = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: NFC_NAME });
    expect(created.status).toBe(201);

    const preview = await previewTransformers(
      session,
      ['nama_trafo;penyulang', `${NFD_NAME};FEEDER-BARU`, ''].join('\n'),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary).toMatchObject({
      validRows: 1,
      insertCount: 0,
      updateCount: 1,
      unchangedCount: 0,
      rejectedCount: 0,
    });

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(200);
    expect(commit.body.data.result).toMatchObject({
      insertedCount: 0,
      updatedCount: 1,
    });

    expect(await Transformer.countDocuments({})).toBe(1);
    const stored = await Transformer.findById(created.body.data.id).lean();
    expect(stored.nameKey).toBe('caf\u00e9 trafo');
    expect(stored.feeder).toBe('FEEDER-BARU');
  });

  it('reports an unchanged row when the canonical name matches exactly', async () => {
    const session = await loginTestUser(app);
    const created = await authenticatedRequest(app, session)
      .post('/api/v1/transformers')
      .send({ name: NFC_NAME, feeder: 'FEEDER-LAMA' });
    expect(created.status).toBe(201);

    const preview = await previewTransformers(
      session,
      ['nama_trafo;penyulang', `${NFC_NAME};FEEDER-LAMA`, ''].join('\n'),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary).toMatchObject({
      validRows: 1,
      insertCount: 0,
      updateCount: 0,
      unchangedCount: 1,
    });

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(200);
    expect(await Transformer.countDocuments({})).toBe(1);
  });

  it('rejects a second row that is Unicode-equivalent to the first row', async () => {
    const session = await loginTestUser(app);

    const preview = await previewTransformers(
      session,
      ['nama_trafo', NFC_NAME, NFD_NAME, ''].join('\n'),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary).toMatchObject({
      validRows: 1,
      rejectedCount: 1,
    });
    expect(preview.body.data.issues[0]).toMatchObject({
      rowNumber: 3,
      field: 'name',
      code: 'DUPLICATE_IN_FILE',
      action: 'reject',
    });
  });

  it('rejects a second row that is Unicode full case-fold equivalent', async () => {
    const session = await loginTestUser(app);

    const preview = await previewTransformers(
      session,
      ['nama_trafo', '\u039f\u03a3', '\u03bf\u03c3', 'Stra\u00dfe', 'strasse', ''].join('\n'),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary).toMatchObject({
      validRows: 2,
      rejectedCount: 2,
    });
    expect(preview.body.data.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 3,
          field: 'name',
          code: 'DUPLICATE_IN_FILE',
        }),
        expect.objectContaining({
          rowNumber: 5,
          field: 'name',
          code: 'DUPLICATE_IN_FILE',
        }),
      ]),
    );
  });

  it('keeps a case-only duplicate row out of the import as one transformer', async () => {
    const session = await loginTestUser(app);

    const preview = await previewTransformers(
      session,
      ['nama_trafo', 'Trafo Kembar', 'TRAFO KEMBAR', ''].join('\n'),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary).toMatchObject({
      validRows: 1,
      insertCount: 1,
      rejectedCount: 1,
    });
    expect(preview.body.data.issues[0]).toMatchObject({
      rowNumber: 3,
      field: 'name',
      code: 'DUPLICATE_IN_FILE',
    });

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(200);
    expect(await Transformer.countDocuments({})).toBe(1);
  });
});
