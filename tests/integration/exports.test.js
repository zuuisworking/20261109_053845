const fs = require('fs');
const os = require('os');
const ExcelJS = require('exceljs');
const { parse: parseDelimited } = require('csv-parse/sync');
const config = require('../../backend/src/config');
const Customer = require('../../backend/src/modules/customers/customerModel');
const GuestVisit = require('../../backend/src/modules/guests/guestModel');
const Transformer = require('../../backend/src/modules/transformers/transformerModel');
const Measurement = require('../../backend/src/modules/measurements/measurementModel');
const exportService = require('../../backend/src/modules/exports/exportService');
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

function parseBinaryResponse(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

async function download(session, endpoint) {
  return authenticatedRequest(app, session)
    .get(endpoint)
    .buffer(true)
    .parse(parseBinaryResponse);
}

async function requestJson(session, endpoint) {
  return authenticatedRequest(app, session).get(endpoint);
}

function listExportTempDirectories() {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('sigap-export-'));
}

async function waitForExportTempCleanup(baselineCount) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (listExportTempDirectories().length <= baselineCount) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Direktori ekspor sementara tidak dibersihkan: ${listExportTempDirectories().join(', ')}`
  );
}

function parseCsvRows(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  return parseDelimited(text, {
    delimiter: ';',
    skip_empty_lines: true,
  });
}

function guestProvenanceData() {
  return {
    syncFingerprint: 'a'.repeat(64),
    timestamp: new Date('2026-11-26T08:30:00.000Z'),
    timestampRaw: '26 November 2026 08:30 WIB',
    syncedAt: new Date('2026-11-26T09:00:00.000Z'),
    sourceRecordId: 'source-record-1',
    guestName: 'Tamu Provenance',
    phone: '08123456789',
    customerId: '520100000001',
    purpose: 'Kunjungan provenance',
    source: 'google_form',
  };
}

describe('complete customer export', () => {
  beforeEach(async () => {
    await createTestUser();
    const customers = Array.from({ length: 125 }, (_, index) => ({
      customerId: `5201${String(index + 1).padStart(8, '0')}`,
      name: `Pelanggan ${index + 1}`,
      tariff: 'B1',
      powerRaw: '1.300',
      powerVa: 1300,
      address: `Alamat ${index + 1}`,
      feeder: 'FEEDER-01',
      status: 'Aktif',
    }));
    await Customer.insertMany(customers);
  });

  it('exports every customer row to CSV instead of the paginated API limit', async () => {
    const session = await loginTestUser(app);
    const tempBaseline = listExportTempDirectories().length;
    const response = await download(session, '/api/v1/exports/customers?format=csv');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('SIGAP_Data_Pelanggan_Lengkap');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.headers['content-length']).toBe(String(response.body.length));

    const bom = Buffer.from('\uFEFF', 'utf8');
    expect(response.body.subarray(0, 3)).toEqual(bom);
    expect(response.body.indexOf(bom, 1)).toBe(-1);

    const text = response.body.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(Boolean);
    expect(lines).toHaveLength(126);
    expect(lines[0]).toContain('ID Pelanggan');
    expect(lines[1]).toContain('520100000001');
    expect(lines[125]).toContain('520100000125');

    const rows = parseCsvRows(response.body);
    expect(rows[0][4]).toBe('Daya');
    expect(rows[0][5]).toBe('Daya (VA)');
    expect(rows[1][4]).toBe('1.300');
    expect(rows[1][5]).toBe('1300');
    expect(rows[125][4]).toBe('1.300');
    expect(rows[125][5]).toBe('1300');

    await waitForExportTempCleanup(tempBaseline);
  });

  it('exports every customer row to XLSX', async () => {
    const session = await loginTestUser(app);
    const tempBaseline = listExportTempDirectories().length;
    const response = await download(session, '/api/v1/exports/customers?format=xlsx');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.headers['content-length']).toBe(String(response.body.length));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const worksheet = workbook.getWorksheet('Pelanggan');
    expect(worksheet).toBeDefined();
    expect(worksheet.rowCount).toBe(126);
    expect(worksheet.getCell('B2').value).toBe('520100000001');
    expect(worksheet.getCell('B126').value).toBe('520100000125');
    expect(worksheet.getCell('E2').value).toBe('1.300');
    expect(worksheet.getCell('F2').value).toBe(1300);

    await waitForExportTempCleanup(tempBaseline);
  });
});

describe('guest export provenance timestamps', () => {
  it('keeps parsed, raw, and synchronized timestamps distinct in CSV', async () => {
    await createTestUser();
    await GuestVisit.create(guestProvenanceData());
    const session = await loginTestUser(app);

    const response = await download(session, '/api/v1/exports/guests?format=csv');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');

    const rows = parseCsvRows(response.body);
    expect(rows[0][1]).toBe('Waktu Kunjungan');
    expect(rows[0][2]).toBe('Waktu Kunjungan Asli');
    expect(rows[0][8]).toBe('Waktu Sinkronisasi');
    expect(rows[1][1]).toBe('2026-11-26T08:30:00.000Z');
    expect(rows[1][2]).toBe('26 November 2026 08:30 WIB');
    expect(rows[1][8]).toBe('2026-11-26T09:00:00.000Z');
    expect(rows[1][1]).not.toBe(rows[1][8]);
  });

  it('keeps parsed, raw, and synchronized timestamps distinct in XLSX', async () => {
    await createTestUser();
    await GuestVisit.create(guestProvenanceData());
    const session = await loginTestUser(app);

    const response = await download(session, '/api/v1/exports/guests?format=xlsx');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const worksheet = workbook.getWorksheet('Tamu');
    expect(worksheet).toBeDefined();
    expect(worksheet.getCell('B1').value).toBe('Waktu Kunjungan');
    expect(worksheet.getCell('C1').value).toBe('Waktu Kunjungan Asli');
    expect(worksheet.getCell('I1').value).toBe('Waktu Sinkronisasi');
    expect(worksheet.getCell('B2').value).toBe('2026-11-26T08:30:00.000Z');
    expect(worksheet.getCell('C2').value).toBe('26 November 2026 08:30 WIB');
    expect(worksheet.getCell('I2').value).toBe('2026-11-26T09:00:00.000Z');
    expect(worksheet.getCell('B2').value).not.toBe(worksheet.getCell('I2').value);
  });
});

describe('transformer export', () => {
  beforeEach(async () => {
    await createTestUser();
    const transformer = await Transformer.create({
      name: 'Trafo Ekspor 1',
      feeder: 'FEEDER-01',
      capacity: '100',
      capacityKva: 100,
      brand: 'Merek Uji',
      grounding: 'TN',
      rawCoordinates: '1,2',
      location: { type: 'Point', coordinates: [1, 2] },
    });
    await Measurement.create({
      transformerId: transformer._id,
      period: 'wbp',
      voltage: { r: 220, s: 220, t: 220 },
      incoming: { r: 80, s: 40, t: 30, n: 10 },
      measurementDate: new Date('2026-11-26T08:30:00.000Z'),
      source: 'manual',
    });
  });

  it('streams the transformer export to CSV with the canonical filename', async () => {
    const session = await loginTestUser(app);
    const tempBaseline = listExportTempDirectories().length;
    const response = await download(
      session,
      '/api/v1/exports/transformers?format=csv&view=semua&period=wbp'
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('SIGAP_Data_Trafo_SEMUA_WBP');
    expect(response.headers['content-length']).toBe(String(response.body.length));

    const rows = parseCsvRows(response.body);
    expect(rows[0][0]).toBe('No');
    expect(rows[0][1]).toBe('Nama Trafo');
    expect(rows[1][1]).toBe('Trafo Ekspor 1');
    expect(rows[1][2]).toBe('FEEDER-01');

    await waitForExportTempCleanup(tempBaseline);
  });

  it('streams the transformer export to XLSX', async () => {
    const session = await loginTestUser(app);
    const tempBaseline = listExportTempDirectories().length;
    const response = await download(
      session,
      '/api/v1/exports/transformers?format=xlsx&view=semua&period=wbp'
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const worksheet = workbook.getWorksheet('Trafo');
    expect(worksheet).toBeDefined();
    expect(worksheet.getCell('B1').value).toBe('Nama Trafo');
    expect(worksheet.getCell('B2').value).toBe('Trafo Ekspor 1');

    await waitForExportTempCleanup(tempBaseline);
  });
});

describe('export resource guards', () => {
  const originalMaxBytes = config.exportMaxBytes;
  const originalMaxConcurrent = config.exportMaxConcurrent;

  beforeEach(async () => {
    await createTestUser();
    await Customer.insertMany([
      {
        customerId: '520100000001',
        name: 'Pelanggan Batas',
        tariff: 'B1',
        powerRaw: '1.300',
        powerVa: 1300,
        address: 'Alamat Batas',
        feeder: 'FEEDER-01',
        status: 'Aktif',
      },
    ]);
  });

  afterEach(() => {
    config.exportMaxBytes = originalMaxBytes;
    config.exportMaxConcurrent = originalMaxConcurrent;
  });

  it('fails with the canonical error envelope when the CSV exceeds the byte ceiling', async () => {
    const session = await loginTestUser(app);
    const tempBaseline = listExportTempDirectories().length;
    config.exportMaxBytes = 64;

    const response = await requestJson(session, '/api/v1/exports/customers?format=csv');

    expect(response.status).toBe(422);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.body).toEqual({
      error: {
        code: 'EXPORT_TOO_LARGE',
        message: expect.stringContaining('Ukuran file ekspor melebihi batas'),
        details: { maxBytes: 64 },
      },
    });

    await waitForExportTempCleanup(tempBaseline);
  });

  it('fails with the canonical error envelope when the XLSX exceeds the byte ceiling', async () => {
    const session = await loginTestUser(app);
    const tempBaseline = listExportTempDirectories().length;
    config.exportMaxBytes = 64;

    const response = await requestJson(session, '/api/v1/exports/customers?format=xlsx');

    expect(response.status).toBe(422);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.body.error.code).toBe('EXPORT_TOO_LARGE');
    expect(response.body.error.details).toEqual({ maxBytes: 64 });

    await waitForExportTempCleanup(tempBaseline);
  });

  it('keeps serving exports that stay inside the byte ceiling', async () => {
    const session = await loginTestUser(app);
    config.exportMaxBytes = 1024 * 1024;

    const response = await download(session, '/api/v1/exports/customers?format=csv');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body.toString('utf8')).toContain('520100000001');
  });

  it('rejects a concurrent export above the limit with the canonical error envelope', async () => {
    const session = await loginTestUser(app);
    const tempBaseline = listExportTempDirectories().length;
    config.exportMaxConcurrent = 1;

    let releaseGate;
    const gate = new Promise((resolve) => {
      releaseGate = resolve;
    });
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });

    const originalRows = exportService.customerExportRows;
    let gated = false;
    exportService.customerExportRows = async function* gatedCustomerExportRows() {
      if (gated) {
        yield* originalRows.call(this);
        return;
      }
      gated = true;
      markStarted();
      yield* originalRows.call(this);
      await gate;
    };

    try {
      const firstExport = download(session, '/api/v1/exports/customers?format=csv');
      await started;

      const rejected = await requestJson(session, '/api/v1/exports/customers?format=csv');

      expect(rejected.status).toBe(429);
      expect(rejected.headers['content-type']).toContain('application/json');
      expect(rejected.headers['content-disposition']).toBeUndefined();
      expect(rejected.body.error.code).toBe('RATE_LIMITED');
      expect(rejected.body.error.message).toContain('Terlalu banyak ekspor berjalan bersamaan');
      expect(rejected.body.error.details).toEqual({ limit: 1, active: 1 });

      releaseGate();
      const firstResponse = await firstExport;

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.headers['content-type']).toContain('text/csv');
      expect(firstResponse.body.toString('utf8')).toContain('520100000001');
    } finally {
      releaseGate();
      exportService.customerExportRows = originalRows;
      await waitForExportTempCleanup(tempBaseline);
    }
  });

  it('releases the export slot so a later export succeeds', async () => {
    const session = await loginTestUser(app);
    config.exportMaxConcurrent = 1;

    const first = await download(session, '/api/v1/exports/customers?format=csv');
    expect(first.status).toBe(200);

    const second = await download(session, '/api/v1/exports/customers?format=csv');
    expect(second.status).toBe(200);
    expect(exportService.activeExportCount).toBe(0);
  });
});
