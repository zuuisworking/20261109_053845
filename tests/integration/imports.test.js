const ExcelJS = require('exceljs');
const iconv = require('iconv-lite');
const Customer = require('../../backend/src/modules/customers/customerModel');
const Transformer = require('../../backend/src/modules/transformers/transformerModel');
const ImportJob = require('../../backend/src/modules/imports/importJobModel');
const importService = require('../../backend/src/modules/imports/importService');
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

async function previewCustomers(session, csv, filename = 'pelanggan.csv') {
  return authenticatedRequest(app, session)
    .post('/api/v1/imports/preview')
    .field('kind', 'customer')
    .field('format', filename.endsWith('.csv') ? 'csv' : 'xlsx')
    .attach('file', Buffer.isBuffer(csv) ? csv : Buffer.from(csv, 'utf8'), {
      filename,
      contentType: filename.endsWith('.csv')
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
}

async function previewTransformers(session, csv, filename = 'trafo.csv') {
  return authenticatedRequest(app, session)
    .post('/api/v1/imports/preview')
    .field('kind', 'transformer')
    .field('format', filename.endsWith('.csv') ? 'csv' : 'xlsx')
    .attach('file', Buffer.isBuffer(csv) ? csv : Buffer.from(csv, 'utf8'), {
      filename,
      contentType: filename.endsWith('.csv')
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

describe('MongoDB-backed canonical customer import preview and commit', () => {
  beforeEach(async () => {
    await createTestUser();
    await Customer.insertMany([
      {
        customerId: '520100000001',
        name: 'Pelanggan Satu',
        tariff: 'B1',
        powerRaw: '1.300',
        powerVa: 1300,
        address: 'Alamat Satu',
      },
      {
        customerId: '520100000002',
        name: 'Pelanggan Dua Lama',
        tariff: 'B2',
        powerRaw: '900',
        powerVa: 900,
        address: 'Alamat Dua',
      },
    ]);
  });

  it('reports the exact canonical summary and commits only insert/update rows', async () => {
    const session = await loginTestUser(app);
    const csv = [
      'id_pelanggan;nama;tarif;daya;alamat',
      '520100000001;Pelanggan Satu;B1;1.300;Alamat Satu',
      '520100000002;Pelanggan Dua Baru;B2;900;Alamat Dua',
      '520100000003;Pelanggan Tiga;B1;2.000;Alamat Tiga',
      '520100000004;;B1;900;Alamat Empat',
      '',
    ].join('\n');

    const preview = await previewCustomers(session, csv);
    expect(preview.status).toBe(201);
    expect(preview.body.data).toMatchObject({
      importJobId: expect.any(String),
      previewToken: expect.any(String),
      kind: 'customer',
      format: 'csv',
      sourceFilename: 'pelanggan.csv',
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(preview.body.data.summary).toEqual({
      totalRows: 4,
      validRows: 3,
      insertCount: 1,
      updateCount: 1,
      unchangedCount: 1,
      rejectedCount: 1,
    });
    expect(preview.body.data.issueCount).toBe(1);
    expect(preview.body.data.issues[0]).toMatchObject({
      rowNumber: 5,
      field: 'name',
      code: 'REQUIRED',
      action: 'reject',
    });

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(200);
    expect(commit.body.data).toMatchObject({
      importJobId: preview.body.data.importJobId,
      status: 'committed',
      result: {
        insertedCount: 1,
        updatedCount: 1,
        unchangedCount: 1,
        rejectedCount: 1,
        failedCount: 0,
      },
    });
    expect(await Customer.countDocuments({})).toBe(3);

    const updated = await Customer.findOne({ customerId: '520100000002' }).lean();
    expect(updated.name).toBe('Pelanggan Dua Baru');
    expect(updated.tariff).toBe('B2');
    expect(updated.powerVa).toBe(900);
    expect(updated.source).toBe('operator_import');
    expect(updated.sourceFile).toBe('pelanggan.csv');
    expect(updated.sourceRow).toBe(3);
    expect(updated.sourceMetadata.importJobId).toBe(preview.body.data.importJobId);
  });

  it('binds a preview token and job to the user who created it', async () => {
    const ownerSession = await loginTestUser(app);
    const csv = [
      'id_pelanggan;nama',
      '520100000003;Pelanggan Tiga',
      '',
    ].join('\n');
    const preview = await previewCustomers(ownerSession, csv);
    expect(preview.status).toBe(201);

    await createTestUser({
      adminId: 'otheradmin',
      username: 'Other Administrator',
      email: 'other.admin@example.test',
      role: 'admin',
    });
    const otherSession = await loginTestUser(app, { adminId: 'otheradmin' });

    const rejected = await commitImport(otherSession, preview.body.data);
    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe('IMPORT_JOB_OWNER_MISMATCH');

    const accepted = await commitImport(ownerSession, preview.body.data);
    expect(accepted.status).toBe(200);
  });

  it('does not erase fields when the uploaded file omits their columns', async () => {
    const session = await loginTestUser(app);
    const csv = [
      'id_pelanggan;nama',
      '520100000002;Pelanggan Dua Baru',
      '',
    ].join('\n');

    const preview = await previewCustomers(session, csv);
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary.updateCount).toBe(1);

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(200);

    const updated = await Customer.findOne({ customerId: '520100000002' }).lean();
    expect(updated.name).toBe('Pelanggan Dua Baru');
    expect(updated.tariff).toBe('B2');
    expect(updated.powerRaw).toBe('900');
    expect(updated.powerVa).toBe(900);
    expect(updated.address).toBe('Alamat Dua');
  });

  it('returns the stored result when a successful commit is repeated', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', '520100000003;Pelanggan Tiga', ''].join('\n'),
    );
    expect(preview.status).toBe(201);

    const first = await commitImport(session, preview.body.data);
    const second = await commitImport(session, preview.body.data);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.result).toEqual(first.body.data.result);
    expect(await Customer.countDocuments({ customerId: '520100000003' })).toBe(1);
  });

  it('reports accurate cumulative counts when a partial commit is retried', async () => {
    const session = await loginTestUser(app);
    const rows = Array.from({ length: 1001 }, (_, index) => {
      const customerId = String(520100100000 + index + 1);
      return `${customerId};Pelanggan ${index + 1}`;
    });
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', ...rows, ''].join('\n'),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary.insertCount).toBe(1001);

    const originalWriteBatch = importService.writeBatch.bind(importService);
    let writeCalls = 0;
    importService.writeBatch = async (...args) => {
      writeCalls += 1;
      if (writeCalls === 2) throw new Error('Simulated batch interruption');
      return originalWriteBatch(...args);
    };

    const interrupted = await commitImport(session, preview.body.data);
    importService.writeBatch = originalWriteBatch;

    expect(interrupted.status).toBe(500);
    expect(interrupted.body.error.code).toBe('IMPORT_COMMIT_INTERRUPTED');
    expect(await Customer.countDocuments({})).toBe(1002);

    const retried = await commitImport(session, preview.body.data);
    expect(retried.status).toBe(200);
    expect(retried.body.data.result.insertedCount).toBe(1001);
    expect(retried.body.data.result.updatedCount).toBe(0);
    expect(await Customer.countDocuments({})).toBe(1003);
  });

  it('rejects a stale target instead of overwriting a post-preview change', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', '520100000002;Pelanggan Dua Baru', ''].join('\n'),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary.updateCount).toBe(1);

    await Customer.updateOne(
      { customerId: '520100000002' },
      { $set: { name: 'Berubah Di Luar Pratinjau' } },
    );

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(409);
    expect(commit.body.error.code).toBe('IMPORT_TARGET_CONFLICT');

    const current = await Customer.findOne({ customerId: '520100000002' }).lean();
    expect(current.name).toBe('Berubah Di Luar Pratinjau');
  });

  it('rejects a commit when an unchanged target changes after preview', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', '520100000001;Pelanggan Satu', ''].join('\n'),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary.unchangedCount).toBe(1);

    await Customer.updateOne(
      { customerId: '520100000001' },
      { $set: { name: 'Berubah Di Luar Pratinjau' } },
    );

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(409);
    expect(commit.body.error.code).toBe('IMPORT_TARGET_CONFLICT');
  });

  it('rejects an expired preview before any write', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', '520100000003;Pelanggan Tiga', ''].join('\n'),
    );
    expect(preview.status).toBe(201);

    await ImportJob.updateOne(
      { jobId: preview.body.data.importJobId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(410);
    expect(commit.body.error.code).toBe('IMPORT_PREVIEW_EXPIRED');
    expect(await Customer.countDocuments({ customerId: '520100000003' })).toBe(0);
  });

  it('returns the stored result when a committed job is replayed after expiry', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', '520100000003;Pelanggan Tiga', ''].join('\n'),
    );
    expect(preview.status).toBe(201);

    const first = await commitImport(session, preview.body.data);
    expect(first.status).toBe(200);

    await ImportJob.updateOne(
      { jobId: preview.body.data.importJobId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );

    const replay = await commitImport(session, preview.body.data);
    expect(replay.status).toBe(200);
    expect(replay.body.data.result).toEqual(first.body.data.result);
    expect(await Customer.countDocuments({ customerId: '520100000003' })).toBe(1);
  });

  it('does not reclaim a committing job while its lease is active', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', '520100000003;Pelanggan Tiga', ''].join('\n'),
    );
    expect(preview.status).toBe(201);

    await ImportJob.updateOne(
      { jobId: preview.body.data.importJobId },
      {
        $set: {
          status: 'committing',
          commitLeaseUntil: new Date(Date.now() + 60_000),
        },
      },
    );

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(409);
    expect(commit.body.error.code).toBe('IMPORT_JOB_STATE_CONFLICT');
    expect(await Customer.countDocuments({ customerId: '520100000003' })).toBe(0);
  });

  it('recovers a job stranded in committing after its lease expires', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', '520100000003;Pelanggan Tiga', ''].join('\n'),
    );
    expect(preview.status).toBe(201);

    await ImportJob.updateOne(
      { jobId: preview.body.data.importJobId },
      {
        $set: {
          status: 'committing',
          commitLeaseUntil: new Date(Date.now() - 60_000),
        },
      },
    );

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(200);
    expect(commit.body.data.result.insertedCount).toBe(1);
    expect(await Customer.countDocuments({ customerId: '520100000003' })).toBe(1);
  });
});

describe('canonical import source contract', () => {
  beforeEach(async () => {
    await createTestUser();
  });

  it('rejects a CSV delimiter other than the canonical semicolon', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan,nama', '520100000003,Pelanggan Tiga', ''].join('\n'),
    );

    expect(preview.status).toBe(422);
    expect(preview.body.error.code).toBe('UNSUPPORTED_DELIMITER');
  });

  it('rejects a semicolon CSV whose records have inconsistent column counts', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      [
        'id_pelanggan;nama',
        '520100000003;Pelanggan Tiga;Kolom Ekstra',
        '',
      ].join('\n'),
    );

    expect(preview.status).toBe(400);
    expect(preview.body.error.code).toBe('SOURCE_PARSE_ERROR');
  });

  it('requires canonical kind and rejects legacy or unknown multipart fields', async () => {
    const session = await loginTestUser(app);
    const legacy = await authenticatedRequest(app, session)
      .post('/api/v1/imports/preview')
      .field('datasetType', 'customer')
      .field('format', 'csv')
      .attach('file', Buffer.from('id_pelanggan;nama\n520100000003;Pelanggan Tiga\n'), {
        filename: 'pelanggan.csv',
        contentType: 'text/csv',
      });
    expect(legacy.status).toBe(422);
    expect(legacy.body.error.code).toBe('UNEXPECTED_FIELD');

    const missingKind = await authenticatedRequest(app, session)
      .post('/api/v1/imports/preview')
      .field('format', 'csv')
      .attach('file', Buffer.from('id_pelanggan;nama\n520100000003;Pelanggan Tiga\n'), {
        filename: 'pelanggan.csv',
        contentType: 'text/csv',
      });
    expect(missingKind.status).toBe(400);
    expect(missingKind.body.error.code).toBe('MALFORMED_MULTIPART');
  });

  it('applies and persists an explicit canonical-to-source header mapping', async () => {
    const session = await loginTestUser(app);
    const preview = await authenticatedRequest(app, session)
      .post('/api/v1/imports/preview')
      .field('kind', 'transformer')
      .field('format', 'csv')
      .field('mapping', JSON.stringify({ name: 'Kode Trafo', feeder: 'Alamat Feeder' }))
      .attach('file', Buffer.from('Kode Trafo;Alamat Feeder\nTrafo Mapping;F-01\n', 'utf8'), {
        filename: 'trafo.csv',
        contentType: 'text/csv',
      });

    expect(preview.status).toBe(201);
    expect(preview.body.data.summary.validRows).toBe(1);

    const job = await authenticatedRequest(app, session).get(
      `/api/v1/imports/${preview.body.data.importJobId}`,
    );
    expect(job.status).toBe(200);
    expect(job.body.data.status).toBe('previewed');
    expect(job.body.data.mapping).toEqual({
      name: 'Kode Trafo',
      feeder: 'Alamat Feeder',
    });
    expect(job.body.data.resolvedMapping).toMatchObject({
      name: 'Kode Trafo',
      feeder: 'Alamat Feeder',
    });

    const rows = await authenticatedRequest(app, session).get(
      `/api/v1/imports/${preview.body.data.importJobId}/rows?page=1&pageSize=10`,
    );
    expect(rows.status).toBe(200);
    expect(rows.body.meta).toMatchObject({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(rows.body.data[0]).toMatchObject({
      rowNumber: 2,
      status: 'insert',
      data: { name: 'Trafo Mapping', feeder: 'F-01' },
    });
  });

  it('exposes owner-scoped import job metadata and paginated issues', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      [
        'id_pelanggan;nama;daya',
        '520100000003;Pelanggan Tiga;2.000',
        'not-a-customer-id;Pelanggan Salah;900',
        '',
      ].join('\n'),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary.rejectedCount).toBe(1);
    expect(preview.body.data.issues[0]).toMatchObject({
      rowNumber: 3,
      field: 'customerId',
      code: 'INVALID_CUSTOMER_ID',
      action: 'reject',
    });

    const job = await authenticatedRequest(app, session).get(
      `/api/v1/imports/${preview.body.data.importJobId}`,
    );
    expect(job.status).toBe(200);
    expect(job.body.data.importJobId).toBe(preview.body.data.importJobId);
    expect(job.body.data.status).toBe('previewed');

    const issues = await authenticatedRequest(app, session).get(
      `/api/v1/imports/${preview.body.data.importJobId}/issues?page=1&pageSize=10`,
    );
    expect(issues.status).toBe(200);
    expect(issues.body.data).toHaveLength(1);
    expect(issues.body.data[0]).toMatchObject({
      rowNumber: 3,
      field: 'customerId',
      code: 'INVALID_CUSTOMER_ID',
      action: 'reject',
    });
    expect(issues.body.meta).toMatchObject({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
  });

  it('keeps an ambiguous multi-valued capacity label raw with a null numeric value', async () => {
    const session = await loginTestUser(app);
    const preview = await previewTransformers(
      session,
      [
        'nama_trafo;penyulang;kapasitas;titik_koordinat',
        'Trafo Ambigu;FEEDER-AMBIGU;500/300/865;POINT (98.676652 3.666219)',
        '',
      ].join('\n'),
    );

    expect(preview.status).toBe(201);
    expect(preview.body.data.summary.validRows).toBe(1);
    expect(preview.body.data.summary.rejectedCount).toBe(0);

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(200);

    const imported = await Transformer.findOne({ name: 'Trafo Ambigu' }).lean();
    expect(imported.capacity).toBe('500/300/865');
    expect(imported.capacityKva).toBeNull();
  });

  it('resolves and persists the requested CSV encoding', async () => {
    const session = await loginTestUser(app);
    const csv = iconv.encode(
      ['id_pelanggan;nama', '520100000003;Pelanggan Ültima', ''].join('\n'),
      'win1252',
    );
    const preview = await authenticatedRequest(app, session)
      .post('/api/v1/imports/preview')
      .field('kind', 'customer')
      .field('format', 'csv')
      .field('encoding', 'cp1252')
      .attach('file', csv, { filename: 'pelanggan.csv', contentType: 'text/csv' });

    expect(preview.status).toBe(201);
    expect(preview.body.data.sourceEncoding).toBe('cp1252');

    const job = await authenticatedRequest(app, session).get(
      `/api/v1/imports/${preview.body.data.importJobId}`,
    );
    expect(job.body.data.sourceEncoding).toBe('cp1252');
  });

  it('rejects undefined CP1252 bytes instead of silently replacing them', async () => {
    const session = await loginTestUser(app);
    const csv = Buffer.concat([
      Buffer.from('id_pelanggan;nama\n520100000003;Pelanggan', 'utf8'),
      Buffer.from([0x81]),
      Buffer.from('\n', 'utf8'),
    ]);
    const preview = await authenticatedRequest(app, session)
      .post('/api/v1/imports/preview')
      .field('kind', 'customer')
      .field('format', 'csv')
      .field('encoding', 'cp1252')
      .attach('file', csv, { filename: 'pelanggan.csv', contentType: 'text/csv' });

    expect(preview.status).toBe(400);
    expect(preview.body.error.code).toBe('SOURCE_PARSE_ERROR');
  });

  it('reports physical source rows for RFC 4180 multiline fields', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      [
        'id_pelanggan;nama',
        '520100000003;"Pelanggan',
        'Lanjutan"',
        '520100000004;Pelanggan Berikutnya',
        '',
      ].join('\n'),
    );
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary.validRows).toBe(2);

    const rows = await authenticatedRequest(app, session).get(
      `/api/v1/imports/${preview.body.data.importJobId}/rows?page=1&pageSize=10`,
    );
    expect(rows.status).toBe(200);
    expect(rows.body.data.map((row) => row.rowNumber)).toEqual([3, 4]);
  });

  it('rejects names that exceed the canonical model limits during preview', async () => {
    const session = await loginTestUser(app);
    const customer = await previewCustomers(
      session,
      ['id_pelanggan;nama', `520100000003;${'N'.repeat(301)}`, ''].join('\n'),
    );
    expect(customer.status).toBe(201);
    expect(customer.body.data.summary.rejectedCount).toBe(1);
    expect(customer.body.data.issues[0]).toMatchObject({
      field: 'name',
      code: 'INVALID_NAME',
      action: 'reject',
    });

    const transformer = await previewTransformers(
      session,
      ['nama_trafo', `T${'a'.repeat(200)}`, ''].join('\n'),
    );
    expect(transformer.status).toBe(201);
    expect(transformer.body.data.summary.rejectedCount).toBe(1);
    expect(transformer.body.data.issues[0]).toMatchObject({
      field: 'name',
      code: 'INVALID_NAME',
      action: 'reject',
    });
  });

  it('rejects optional customer fields that exceed direct-write limits', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      [
        'id_pelanggan;nama;alamat',
        '520100000004;Pelanggan Valid;Alamat Valid',
        `520100000003;Pelanggan Alamat Terlalu Panjang;${'A'.repeat(1001)}`,
        '',
      ].join('\n'),
    );

    expect(preview.status).toBe(201);
    expect(preview.body.data.summary).toMatchObject({
      validRows: 1,
      rejectedCount: 1,
    });
    expect(preview.body.data.issues[0]).toMatchObject({
      rowNumber: 3,
      field: 'address',
      code: 'MAXLENGTH',
      action: 'reject',
    });

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(200);
    expect(await Customer.countDocuments({ customerId: '520100000003' })).toBe(0);
    expect(await Customer.countDocuments({ customerId: '520100000004' })).toBe(1);
  });

  it('requires a deterministic worksheet selection for a multi-sheet XLSX', async () => {
    const session = await loginTestUser(app);
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet('Data');
    first.addRows([
      ['id_pelanggan', 'nama'],
      ['520100000003', 'Pelanggan Pertama'],
    ]);
    const second = workbook.addWorksheet('Cadangan');
    second.addRows([
      ['id_pelanggan', 'nama'],
      ['520100000004', 'Pelanggan Cadangan'],
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const ambiguous = await previewCustomers(session, buffer, 'pelanggan.xlsx');
    expect(ambiguous.status).toBe(422);
    expect(ambiguous.body.error.code).toBe('SHEET_REQUIRED');

    const selected = await authenticatedRequest(app, session)
      .post('/api/v1/imports/preview')
      .field('kind', 'customer')
      .field('format', 'xlsx')
      .field('sheet', 'Cadangan')
      .attach('file', buffer, {
        filename: 'pelanggan.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(selected.status).toBe(201);
    expect(selected.body.data.sourceWorksheetName).toBe('Cadangan');
    expect(selected.body.data.summary.insertCount).toBe(1);
  });

  it('ignores a non-data cover sheet when selecting a worksheet', async () => {
    const session = await loginTestUser(app);
    const workbook = new ExcelJS.Workbook();
    const cover = workbook.addWorksheet('Tentang');
    cover.addRows([
      ['Laporan Import Pelanggan'],
      ['Dibuat oleh operator'],
    ]);
    const data = workbook.addWorksheet('Data');
    data.addRows([
      ['id_pelanggan', 'nama'],
      ['520100000003', 'Pelanggan Pertama'],
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const preview = await previewCustomers(session, buffer, 'pelanggan.xlsx');
    expect(preview.status).toBe(201);
    expect(preview.body.data.sourceWorksheetName).toBe('Data');
    expect(preview.body.data.summary.insertCount).toBe(1);
  });

  it('requires importJobId and previewToken and rejects legacy commit fields', async () => {
    const session = await loginTestUser(app);
    const missing = await authenticatedRequest(app, session)
      .post('/api/v1/imports/commit')
      .send({ previewToken: 'token-yang-lebih-dari-32-karakter-abcdefghijklmnopqrstuvwxyz' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const legacy = await authenticatedRequest(app, session)
      .post('/api/v1/imports/commit')
      .send({ importToken: 'legacy-token' });
    expect(legacy.status).toBe(422);
    expect(legacy.body.error.code).toBe('UNEXPECTED_FIELD');
  });

  it('rejects a commit when the staged reviewed source hash no longer matches', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', '520100000003;Pelanggan Tiga', ''].join('\n'),
    );
    expect(preview.status).toBe(201);

    const job = await ImportJob.findOne({ jobId: preview.body.data.importJobId }).lean();
    expect(job).not.toBeNull();
    const database = require('mongoose').connection.db;
    const chunk = await database
      .collection('import_staging.chunks')
      .findOne({ files_id: job.stagedUploadId });
    expect(chunk).not.toBeNull();

    const original =
      typeof chunk.data?.value === 'function'
        ? Buffer.from(chunk.data.value(true))
        : Buffer.from(chunk.data);
    expect(original.length).toBeGreaterThan(0);
    original[0] = original[0] === 0x69 ? 0x78 : 0x69;
    await database
      .collection('import_staging.chunks')
      .updateOne({ _id: chunk._id }, { $set: { data: original } });

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(409);
    expect(commit.body.error.code).toBe('IMPORT_HASH_MISMATCH');
  });

  it('stages the source and diff in GridFS instead of a BSON buffer collection', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', '520100000003;Pelanggan Tiga', ''].join('\n'),
    );
    expect(preview.status).toBe(201);

    const database = require('mongoose').connection.db;
    const collections = await database.listCollections().toArray();
    expect(collections.some((entry) => entry.name === 'import_job_sources')).toBe(false);
    expect(collections.some((entry) => entry.name === 'import_job_records')).toBe(false);
    expect(collections.some((entry) => entry.name === 'import_staging.files')).toBe(true);
    expect(collections.some((entry) => entry.name === 'import_staging.chunks')).toBe(true);
  });

  it('removes expired staged artifacts and job metadata without another preview', async () => {
    const session = await loginTestUser(app);
    const preview = await previewCustomers(
      session,
      ['id_pelanggan;nama', '520100000003;Pelanggan Tiga', ''].join('\n'),
    );
    expect(preview.status).toBe(201);

    const job = await ImportJob.findOne({ jobId: preview.body.data.importJobId }).lean();
    await ImportJob.updateOne(
      { _id: job._id },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );

    await importService.cleanupExpiredJobs();

    expect(await ImportJob.findById(job._id)).toBeNull();
    const database = require('mongoose').connection.db;
    expect(
      await database
        .collection('import_staging.files')
        .findOne({ _id: job.stagedUploadId })
    ).toBeNull();
    expect(
      await database
        .collection('import_staging.files')
        .findOne({ _id: job.diffReportUploadId })
    ).toBeNull();
  });
});

describe('MongoDB-backed transformer import coordinate handling', () => {
  beforeEach(async () => {
    await createTestUser();
  });

  it('keeps canonical WKT coordinates in longitude-first order after commit', async () => {
    const session = await loginTestUser(app);
    const csv = [
      'nama_trafo;penyulang;kapasitas;titik_koordinat',
      'Trafo Import;FEEDER-IMPORT;100 kVA;POINT (98.676652 3.666219)',
      '',
    ].join('\n');

    const preview = await previewTransformers(session, csv);
    expect(preview.status).toBe(201);
    expect(preview.body.data.summary.validRows).toBe(1);
    expect(preview.body.data.summary.rejectedCount).toBe(0);

    const commit = await commitImport(session, preview.body.data);
    expect(commit.status).toBe(200);

    const imported = await Transformer.findOne({ name: 'Trafo Import' }).lean();
    expect(imported).not.toBeNull();
    expect(imported.location.coordinates).toEqual([98.676652, 3.666219]);
    expect(imported.capacityKva).toBe(100);
  });

  it('exposes the original invalid coordinate text in the preview issue', async () => {
    const session = await loginTestUser(app);
    const preview = await previewTransformers(
      session,
      [
        'nama_trafo;titik_koordinat',
        'Trafo Koordinat Salah;POINT (abc def)',
        '',
      ].join('\n'),
    );

    expect(preview.status).toBe(201);
    expect(preview.body.data.issues[0]).toMatchObject({
      rowNumber: 2,
      field: 'coordinates',
      code: 'INVALID_COORDINATES',
      rawValue: 'POINT (abc def)',
      action: 'reject',
    });
  });
});
