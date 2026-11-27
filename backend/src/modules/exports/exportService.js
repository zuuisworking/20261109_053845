const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { finished, pipeline } = require('stream/promises');
const { stringify } = require('csv-stringify');
const ExcelJS = require('exceljs');
const config = require('../../config');
const Transformer = require('../transformers/transformerModel');
const Measurement = require('../measurements/measurementModel');
const Customer = require('../customers/customerModel');
const GuestVisit = require('../guests/guestModel');
const { calculateIncomingAnalysis } = require('../../shared/utils/electricalCalculator');
const AppError = require('../../shared/errors/AppError');
const {
  ByteLimitTransform,
  ExportConcurrencyLimiter,
  resolveMaxExportBytes,
  resolveMaxConcurrentExports,
  EXPORT_TOO_LARGE_CODE,
  EXPORT_CONCURRENCY_CODE,
} = require('./exportLimits');

const MAX_EXPORT_ROWS = 100000;
const TRANSFORMER_BATCH_SIZE = 500;
const UTF8_BOM = Buffer.from('\uFEFF', 'utf8');
const EXPORT_TEMP_PREFIX = 'sigap-export-';

function normalizeFormat(format = 'csv') {
  const normalized = String(format || 'csv').trim().toLowerCase();
  if (!['csv', 'xlsx'].includes(normalized)) {
    throw new AppError('Format ekspor harus csv atau xlsx.', 415);
  }
  return normalized;
}

function normalizeView(view = 'semua') {
  const normalized = String(view || 'semua').trim().toLowerCase();
  if (['semua', 'all'].includes(normalized)) return 'semua';
  if (['pincang', 'unbalanced'].includes(normalized)) return 'pincang';
  if (['overload', 'overloaded'].includes(normalized)) return 'overload';
  throw new AppError("View ekspor harus 'semua', 'pincang', atau 'overload'.", 400);
}

function normalizePeriod(period = 'wbp') {
  const normalized = String(period || 'wbp').trim().toLowerCase();
  if (['wbp', 'lwbp'].includes(normalized)) return normalized;
  throw new AppError('Periode ekspor harus wbp atau lwbp.', 400);
}

function sanitizeSpreadsheetText(value) {
  if (value === null || value === undefined) return '';

  const text = String(value);
  let hasFormulaPrefix = false;
  let hasLeadingControl = false;

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 32) {
      if (codePoint !== 32) hasLeadingControl = true;
      continue;
    }
    hasFormulaPrefix = ['=', '+', '-', '@'].includes(character);
    break;
  }

  return hasFormulaPrefix || hasLeadingControl ? `'${text}` : text;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '_');
}

function getLocationCoordinates(location) {
  if (Array.isArray(location)) return location;
  if (Array.isArray(location?.coordinates)) return location.coordinates;
  return null;
}

function calculateExportAnalysis(measurement, capacityKva, period) {
  const analysis = calculateIncomingAnalysis(
    measurement?.incoming || {},
    capacityKva ?? null,
    period
  );

  return {
    period,
    hasMeasurement: analysis.hasIncoming,
    ir: analysis.ir,
    is: analysis.is,
    it: analysis.it,
    in: analysis.inVal,
    iAvg: analysis.iAvg,
    nominalCurrent: analysis.nominalA,
    unbalance: analysis.unbalance,
    loadingPercent: analysis.loadingPercent,
    isPincang: analysis.isPincang,
    isOverload: analysis.isOverload,
    labelStatus: analysis.labelStatus,
    recommendation: analysis.rekomendasi,
  };
}

function contentTypeFor(format) {
  return format === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv; charset=utf-8';
}

async function removeTempDirectory(directoryPath) {
  if (!directoryPath) return;
  try {
    await fs.promises.rm(directoryPath, { recursive: true, force: true });
  } catch (error) {
    console.error('[Export] Gagal membersihkan berkas ekspor sementara:', error.message);
  }
}

async function fileSize(filePath) {
  const stats = await fs.promises.stat(filePath);
  return stats.size;
}

async function* withHeaderRow(headers, sourceRows) {
  yield headers;
  yield* sourceRows;
}

/**
 * Writes the CSV export straight into the temporary file. The UTF-8 BOM is
 * pushed through the same byte-limited stream as the CSV body, so the export
 * never allocates a second full-size copy of the payload.
 */
async function writeCsvExport({ headers, sourceRows, filePath, maxBytes }) {
  const fileStream = fs.createWriteStream(filePath);
  const limiter = new ByteLimitTransform(maxBytes);
  const stringifier = stringify({
    delimiter: ';',
    record_delimiter: '\r\n',
  });
  const source = Readable.from(withHeaderRow(headers, sourceRows), { objectMode: true });

  try {
    limiter.write(UTF8_BOM);
    await pipeline(source, stringifier, limiter, fileStream);
    await finished(fileStream);
  } catch (error) {
    fileStream.destroy();
    throw error;
  }

  return fileSize(filePath);
}

/**
 * Writes the XLSX export through the streaming ExcelJS writer into the
 * temporary file. The byte ceiling is enforced by the same limiting stream, so
 * an oversized workbook aborts instead of filling the disk.
 */
async function writeXlsxExport({ headers, sourceRows, sheetName, filePath, maxBytes }) {
  const fileStream = fs.createWriteStream(filePath);
  const limiter = new ByteLimitTransform(maxBytes);
  let streamError = null;

  const captureError = (error) => {
    if (!streamError) {
      streamError = error;
    }
  };

  // Both streams need their own listener: an unhandled 'error' event would
  // terminate the process instead of failing only this export.
  limiter.on('error', captureError);
  fileStream.on('error', captureError);
  limiter.pipe(fileStream);

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: limiter,
    useStyles: false,
    useSharedStrings: false,
  });
  const worksheet = workbook.addWorksheet(sheetName);
  const streamFailure = new Promise((resolve) => {
    limiter.once('error', resolve);
    fileStream.once('error', resolve);
  });

  try {
    worksheet.addRow(headers);
    for await (const row of sourceRows) {
      if (streamError) throw streamError;
      worksheet.addRow(row);
    }
    if (streamError) throw streamError;

    const outcome = await Promise.race([
      workbook.commit().then(() => null, (error) => error),
      streamFailure,
    ]);
    if (outcome) throw outcome;
    if (streamError) throw streamError;

    await finished(fileStream);
    if (streamError) throw streamError;
  } catch (error) {
    workbook.zip.on('error', () => undefined);
    try {
      workbook.zip.destroy();
    } catch (_error) {
      // The archive is already torn down; the temporary file is removed below.
    }
    limiter.destroy();
    fileStream.destroy();
    throw streamError || error;
  }

  return fileSize(filePath);
}

class ExportService {
  constructor() {
    this.concurrencyLimiter = new ExportConcurrencyLimiter();
  }

  get activeExportCount() {
    return this.concurrencyLimiter.activeCount;
  }

  async exportTransformers({ format = 'csv', view = 'semua', period = 'wbp' } = {}) {
    const normalizedFormat = normalizeFormat(format);
    const normalizedView = normalizeView(view);
    const normalizedPeriod = normalizePeriod(period);

    const headers = [
      'No',
      'Nama Trafo',
      'Penyulang',
      'Kapasitas',
      'Kapasitas (kVA)',
      'Merek',
      'Grounding',
      'Titik Koordinat',
      'Longitude',
      'Latitude',
      'Incoming R (A)',
      'Incoming S (A)',
      'Incoming T (A)',
      'Incoming N (A)',
      'I Rata-Rata (A)',
      'Arus Nominal (A)',
      'Ketidakseimbangan (%)',
      'Pembebanan (%)',
      'Status Operasional',
      'Rekomendasi',
      'Status Pincang',
      'Status Overload',
      'Data Pengukuran',
      'Tanggal Pengukuran',
    ];

    const rows = this.guardedRows(this.transformerExportRows(normalizedView, normalizedPeriod));
    const filename = `SIGAP_Data_Trafo_${normalizedView.toUpperCase()}_${normalizedPeriod.toUpperCase()}_${formatTimestamp()}`;

    return this.createExportFile({
      format: normalizedFormat,
      headers,
      rows,
      sheetName: 'Trafo',
      filename,
    });
  }

  async *transformerExportRows(view, period) {
    let transformerBatch = [];
    let rowNumber = 0;

    const flushBatch = async function* (batch) {
      const transformerIds = batch.map((transformer) => transformer._id);
      const measurements = await Measurement.find({
        transformerId: { $in: transformerIds },
        period,
      }).lean();
      const measurementMap = new Map();
      for (const measurement of measurements) {
        measurementMap.set(String(measurement.transformerId), measurement);
      }

      for (const transformer of batch) {
        const measurement = measurementMap.get(String(transformer._id)) || null;
        const analysis = calculateExportAnalysis(
          measurement,
          transformer.capacityKva,
          period
        );

        if (view === 'pincang' && !analysis.isPincang) continue;
        if (view === 'overload' && !analysis.isOverload) continue;

        rowNumber += 1;
        const coordinates = getLocationCoordinates(transformer.location);
        yield [
          rowNumber,
          sanitizeSpreadsheetText(transformer.name),
          sanitizeSpreadsheetText(transformer.feeder),
          sanitizeSpreadsheetText(transformer.capacity),
          finiteNumber(transformer.capacityKva),
          sanitizeSpreadsheetText(transformer.brand),
          sanitizeSpreadsheetText(transformer.grounding),
          sanitizeSpreadsheetText(transformer.rawCoordinates),
          coordinates ? finiteNumber(coordinates[0]) : null,
          coordinates ? finiteNumber(coordinates[1]) : null,
          analysis.ir,
          analysis.is,
          analysis.it,
          analysis.in,
          analysis.iAvg,
          analysis.nominalCurrent,
          analysis.unbalance,
          analysis.loadingPercent,
          sanitizeSpreadsheetText(analysis.labelStatus),
          sanitizeSpreadsheetText(analysis.recommendation),
          analysis.isPincang ? 'Ya' : 'Tidak',
          analysis.isOverload ? 'Ya' : 'Tidak',
          analysis.hasMeasurement ? 'Ada' : 'Tidak Ada',
          measurement?.measurementDate
            ? new Date(measurement.measurementDate).toISOString()
            : null,
        ];
      }
    };

    const cursor = Transformer.find().sort({ _id: 1 }).lean().cursor();
    for await (const transformer of cursor) {
      transformerBatch.push(transformer);
      if (transformerBatch.length >= TRANSFORMER_BATCH_SIZE) {
        yield* flushBatch(transformerBatch);
        transformerBatch = [];
      }
    }

    if (transformerBatch.length > 0) {
      yield* flushBatch(transformerBatch);
    }
  }

  async exportCustomers({ format = 'csv' } = {}) {
    const normalizedFormat = normalizeFormat(format);

    const totalItems = await Customer.countDocuments({});
    if (totalItems > MAX_EXPORT_ROWS) {
      throw new AppError(
        `Jumlah pelanggan melebihi batas ${MAX_EXPORT_ROWS} baris. Ekspor dibatalkan tanpa pemotongan data.`,
        422
      );
    }

    const headers = [
      'No',
      'ID Pelanggan',
      'Nama Pelanggan',
      'Tarif',
      'Daya',
      'Daya (VA)',
      'Alamat',
      'Penyulang',
      'Status',
    ];

    const rows = this.guardedRows(this.customerExportRows());
    const filename = `SIGAP_Data_Pelanggan_Lengkap_${formatTimestamp()}`;

    return this.createExportFile({
      format: normalizedFormat,
      headers,
      rows,
      sheetName: 'Pelanggan',
      filename,
    });
  }

  async *customerExportRows() {
    let rowNumber = 0;
    const cursor = Customer.find().sort({ _id: 1 }).lean().cursor();

    for await (const customer of cursor) {
      rowNumber += 1;
      const powerRaw =
        customer.powerRaw !== undefined ? customer.powerRaw : customer.power;

      yield [
        rowNumber,
        sanitizeSpreadsheetText(customer.customerId),
        sanitizeSpreadsheetText(customer.name),
        sanitizeSpreadsheetText(customer.tariff),
        sanitizeSpreadsheetText(powerRaw),
        finiteNumber(customer.powerVa),
        sanitizeSpreadsheetText(customer.address),
        sanitizeSpreadsheetText(customer.feeder),
        sanitizeSpreadsheetText(customer.status),
      ];
    }
  }

  async exportGuests({ format = 'csv' } = {}) {
    const normalizedFormat = normalizeFormat(format);

    const totalItems = await GuestVisit.countDocuments({});
    if (totalItems > MAX_EXPORT_ROWS) {
      throw new AppError(
        `Jumlah tamu melebihi batas ${MAX_EXPORT_ROWS} baris. Ekspor dibatalkan tanpa pemotongan data.`,
        422
      );
    }

    const headers = [
      'No',
      'Waktu Kunjungan',
      'Waktu Kunjungan Asli',
      'Nama Tamu',
      'No Handphone',
      'ID Pelanggan',
      'Keperluan',
      'Sumber',
      'Waktu Sinkronisasi',
    ];

    const rows = this.guardedRows(this.guestExportRows());
    const filename = `SIGAP_Data_Tamu_Google_Form_${formatTimestamp()}`;

    return this.createExportFile({
      format: normalizedFormat,
      headers,
      rows,
      sheetName: 'Tamu',
      filename,
    });
  }

  async *guestExportRows() {
    let rowNumber = 0;
    const cursor = GuestVisit.find().sort({ createdAt: -1, _id: -1 }).lean().cursor();

    for await (const guest of cursor) {
      rowNumber += 1;
      yield [
        rowNumber,
        guest.timestamp ? new Date(guest.timestamp).toISOString() : null,
        sanitizeSpreadsheetText(guest.timestampRaw),
        sanitizeSpreadsheetText(guest.guestName),
        sanitizeSpreadsheetText(guest.phone),
        sanitizeSpreadsheetText(guest.customerId),
        sanitizeSpreadsheetText(guest.purpose),
        sanitizeSpreadsheetText(guest.source),
        guest.syncedAt
          ? new Date(guest.syncedAt).toISOString()
          : guest.createdAt
            ? new Date(guest.createdAt).toISOString()
            : null,
      ];
    }
  }

  async *guardedRows(sourceRows) {
    let rowCount = 0;

    for await (const row of sourceRows) {
      rowCount += 1;
      if (rowCount > MAX_EXPORT_ROWS) {
        throw new AppError(
          `Jumlah data ekspor melebihi batas ${MAX_EXPORT_ROWS} baris. Ekspor dibatalkan tanpa pemotongan data.`,
          422
        );
      }
      yield row;
    }
  }

  /**
   * Generates the export into a bounded temporary file and hands the caller a
   * read stream. Generation failures (row ceiling, byte ceiling, database
   * errors) surface before any response byte is written, so the canonical
   * error envelope is preserved and no partial file is returned.
   */
  async createExportFile({ format, headers, rows, sheetName, filename }) {
    const maxBytes = resolveMaxExportBytes(config.exportMaxBytes);
    const concurrencyLimit = resolveMaxConcurrentExports(config.exportMaxConcurrent);

    if (!this.concurrencyLimiter.tryAcquire(concurrencyLimit)) {
      throw new AppError(
        `Terlalu banyak ekspor berjalan bersamaan (maksimum ${concurrencyLimit}). Ekspor dibatalkan, silakan coba lagi sebentar lagi.`,
        429,
        { limit: concurrencyLimit, active: this.concurrencyLimiter.activeCount },
        EXPORT_CONCURRENCY_CODE
      );
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.concurrencyLimiter.release();
    };

    let tempDirectory = null;

    try {
      tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), EXPORT_TEMP_PREFIX));
      const filePath = path.join(tempDirectory, `export.${format}`);

      const byteLength =
        format === 'xlsx'
          ? await writeXlsxExport({ headers, sourceRows: rows, sheetName, filePath, maxBytes })
          : await writeCsvExport({ headers, sourceRows: rows, filePath, maxBytes });

      const stream = fs.createReadStream(filePath);
      const cleanup = () => {
        release();
        return removeTempDirectory(tempDirectory);
      };

      return {
        contentType: contentTypeFor(format),
        filename: `${filename}.${format}`,
        byteLength,
        stream,
        cleanup,
      };
    } catch (error) {
      release();
      await removeTempDirectory(tempDirectory);
      throw error;
    }
  }
}

module.exports = new ExportService();
module.exports.ExportService = ExportService;
module.exports.MAX_EXPORT_ROWS = MAX_EXPORT_ROWS;
module.exports.EXPORT_TOO_LARGE_CODE = EXPORT_TOO_LARGE_CODE;
