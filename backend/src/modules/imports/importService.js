const crypto = require('crypto');
const path = require('path');
const { TextDecoder } = require('util');
const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');
const iconv = require('iconv-lite');
const mongoose = require('mongoose');
const Transformer = require('../transformers/transformerModel');
const Customer = require('../customers/customerModel');
const ImportJob = require('./importJobModel');
const ImportJobIssue = require('./importJobIssueModel');
const importStagingService = require('./importStagingService');
const AppError = require('../../shared/errors/AppError');
const { parseCapacityKva } = require('../../shared/utils/capacityParser');
const { normalizeNameKey } = require('../../shared/utils/nameKey');
const {
  CUSTOMER_NAME_MAX_LENGTH,
  TRANSFORMER_NAME_MAX_LENGTH,
} = require('../../shared/constants/domainLimits');
const {
  customerWriteSchema,
  formatValidationErrors,
  getValidator,
  transformerWriteSchema,
} = require('../../shared/validation');

const MAX_IMPORT_FILE_SIZE = 25 * 1024 * 1024;
const MAX_IMPORT_ROWS = 100000;
const MAX_IMPORT_COLUMNS = 100;
const MAX_IMPORT_CELL_BYTES = 1024 * 1024;
const MAX_IMPORT_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_XLSX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_XLSX_ARCHIVE_ENTRIES = 1000;
const HEADER_SEARCH_ROWS = 50;
const IMPORT_JOB_TTL_MS = 24 * 60 * 60 * 1000;
const DATABASE_BATCH_SIZE = 1000;
const MAX_INLINE_ISSUES = 100;
const IMPORT_COMMIT_LEASE_MS = 15 * 60 * 1000;
const IMPORT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CASE_INSENSITIVE_COLLATION = Object.freeze({
  locale: 'en',
  strength: 2,
});
const CUSTOMER_WRITE_VALIDATOR = getValidator(customerWriteSchema);
const TRANSFORMER_WRITE_VALIDATOR = getValidator(transformerWriteSchema);

const CUSTOMER_HEADER_ALIASES = {
  customerId: ['idpel', 'id_pelanggan', 'idpelanggan', 'customer_id', 'id_pelanggan_pln', 'no_id'],
  name: ['nama', 'nama_pelanggan', 'customer_name', 'nama_lengkap'],
  address: ['alamat', 'address', 'alamat_pelanggan'],
  tariff: ['tarif', 'tariff'],
  power: ['daya', 'power', 'power_va', 'daya_va'],
};

const TRANSFORMER_HEADER_ALIASES = {
  name: ['nama_trafo', 'nama', 'nama_travo', 'transformer_name', 'nama_transformer'],
  feeder: ['penyulang', 'feeder', 'feeder_name', 'kode_penyulang', 'id_penyulang'],
  capacity: ['kapasitas', 'capacity', 'kapasitas_kva', 'daya'],
  coordinates: [
    'titik_koordinat',
    'koordinat',
    'coordinates',
    'location',
    'lokasi',
    'titik_koordinate',
  ],
  brand: ['merek', 'brand', 'merek_trafo'],
  grounding: ['grounding', 'pentanahan'],
};

function normalizeKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'transformer') return 'transformer';
  if (normalized === 'customer') return 'customer';
  throw new AppError("Jenis dataset harus 'transformer' atau 'customer'.", 422);
}

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function safeFilename(filename) {
  const basename = path.basename(String(filename || '').replace(/\\/g, '/')).trim();
  if (!basename || basename === '.' || basename === '..') {
    throw new AppError('Nama file tidak valid.', 400);
  }
  return basename.slice(0, 255);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenDigest(token) {
  return sha256(Buffer.from(String(token), 'utf8'));
}

function normalizeNullable(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function isPlaceholder(value) {
  if (value === undefined || value === null) return true;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '' || normalized === '-' || normalized === 'n/a' || normalized === 'null';
}

function makeIssue(field, code, message) {
  return { field, code, message };
}

const IMPORT_FIELD_LABELS = Object.freeze({
  customerId: 'ID Pelanggan',
  name: 'Nama',
  tariff: 'Tarif',
  power: 'Daya',
  powerVa: 'Daya VA',
  address: 'Alamat pelanggan',
  feeder: 'Penyulang',
  capacity: 'Kapasitas',
  capacityKva: 'Kapasitas kVA',
  brand: 'Merek',
  grounding: 'Grounding',
  location: 'Lokasi',
  rawCoordinates: 'Koordinat mentah',
});

function canonicalImportIssueMessage(error) {
  const label = IMPORT_FIELD_LABELS[error.path] || error.path || 'Data baris';
  if (error.code === 'MAXLENGTH') {
    return `${label} maksimal ${error.params?.limit ?? '-'} karakter.`;
  }
  if (error.code === 'MAXIMUM') {
    return `${label} tidak boleh lebih dari ${error.params?.limit ?? '-'}.`;
  }
  if (error.code === 'MINIMUM') {
    return `${label} tidak boleh kurang dari ${error.params?.limit ?? '-'}.`;
  }
  if (error.code === 'PATTERN') {
    return `${label} tidak valid.`;
  }
  return `${label} tidak valid.`;
}

function appendCanonicalFieldIssues(validator, data, errors) {
  if (validator(data)) return;

  const existingFields = new Set(errors.map((issue) => issue.field));
  for (const error of formatValidationErrors(validator.errors)) {
    if (!error.path || existingFields.has(error.path)) continue;
    errors.push(
      makeIssue(
        error.path,
        error.code || 'INVALID_FIELD_VALUE',
        canonicalImportIssueMessage(error),
      ),
    );
    existingFields.add(error.path);
  }
}

function cellText(row, index) {
  if (index < 0) return null;

  const textValue = row.texts?.[index];
  const rawValue = textValue !== undefined && textValue !== null ? textValue : row.values?.[index];

  if (rawValue === undefined || rawValue === null) return null;
  if (rawValue instanceof Date) return rawValue.toISOString();

  if (typeof rawValue === 'object') {
    if (Object.prototype.hasOwnProperty.call(rawValue, 'formula')) {
      return rawValue.result === undefined || rawValue.result === null
        ? null
        : String(rawValue.result).trim();
    }
    if (Object.prototype.hasOwnProperty.call(rawValue, 'richText')) {
      return rawValue.richText.map((part) => part.text || '').join('').trim();
    }
    if (Object.prototype.hasOwnProperty.call(rawValue, 'text')) {
      return String(rawValue.text).trim();
    }
  }

  const result = String(rawValue).trim();
  return result === '' ? null : result;
}

function rowIsEmpty(row) {
  return row.values.every((value) => {
    if (value === undefined || value === null) return true;
    return String(value).trim() === '';
  });
}

function assertImportRecordSize(row) {
  const texts = row.texts || row.values || [];
  for (const value of texts) {
    if (value === undefined || value === null) continue;
    const size = Buffer.byteLength(String(value), 'utf8');
    if (size > MAX_IMPORT_CELL_BYTES) {
      throw new AppError(
        `Ukuran satu sel pada baris ${row.rowNumber} melebihi batas ${MAX_IMPORT_CELL_BYTES} byte.`,
        413
      );
    }
  }

  const recordSize = Buffer.byteLength(JSON.stringify(texts), 'utf8');
  if (recordSize > MAX_IMPORT_RECORD_BYTES) {
    throw new AppError(
      `Ukuran record pada baris ${row.rowNumber} melebihi batas ${MAX_IMPORT_RECORD_BYTES} byte.`,
      413
    );
  }
}

function normalizeCsvEncoding(value, kind) {
  const fallback = kind === 'customer' ? 'cp1252' : 'utf-8-sig';
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!['utf-8-sig', 'cp1252', 'auto'].includes(normalized)) {
    throw new AppError(
      'Encoding CSV harus utf-8-sig, cp1252, atau auto.',
      422,
      null,
      'VALIDATION_ERROR'
    );
  }
  return normalized;
}

function containsUndefinedCp1252Byte(buffer) {
  return buffer.some((byte) =>
    [0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(byte),
  );
}

function decodeCsvBuffer(buffer, kind, requestedEncoding) {
  const encoding = normalizeCsvEncoding(requestedEncoding, kind);
  const decoder = new TextDecoder('utf-8', { fatal: true });

  const decodeUtf8 = () => ({
    text: decoder.decode(buffer).replace(/^\uFEFF/, ''),
    encoding: 'utf-8-sig',
  });
  const decodeCp1252 = () => {
    if (containsUndefinedCp1252Byte(buffer)) {
      throw new AppError(
        'File CSV mengandung byte yang tidak valid untuk CP1252.',
        400,
        null,
        'SOURCE_PARSE_ERROR',
      );
    }
    return {
      text: iconv.decode(buffer, 'win1252').replace(/^\uFEFF/, ''),
      encoding: 'cp1252',
    };
  };

  if (encoding === 'utf-8-sig') {
    try {
      return decodeUtf8();
    } catch (_error) {
      throw new AppError('File CSV bukan UTF-8 yang valid.', 400, null, 'SOURCE_PARSE_ERROR');
    }
  }
  if (encoding === 'cp1252') {
    try {
      return decodeCp1252();
    } catch (conversionError) {
      if (conversionError instanceof AppError) throw conversionError;
      throw new AppError('File CSV tidak dapat didekode sebagai CP1252.', 400, null, 'SOURCE_PARSE_ERROR');
    }
  }

  try {
    return decodeUtf8();
  } catch (_error) {
    try {
      return decodeCp1252();
    } catch (conversionError) {
      if (conversionError instanceof AppError) throw conversionError;
      throw new AppError(
        'File CSV tidak dapat didekode sebagai UTF-8 atau CP1252.',
        400,
        null,
        'SOURCE_PARSE_ERROR'
      );
    }
  }
}

function looksLikeCsv(buffer) {
  if (buffer.length === 0) return false;
  if (buffer.includes(0x00)) return false;

  const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const oleSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
  if (buffer.subarray(0, 4).equals(zipSignature) || buffer.subarray(0, 4).equals(oleSignature)) {
    return false;
  }

  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return false;

  let disallowedControls = 0;
  for (const byte of buffer) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      disallowedControls += 1;
    }
  }

  return disallowedControls === 0;
}

function countDelimiterInFirstRecord(text, delimiter) {
  let inQuotes = false;
  let count = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') index += 1;
        else inQuotes = false;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character === delimiter) {
      count += 1;
      continue;
    }
    if (character === '\n' || character === '\r') return count;
  }

  return count;
}

function parseCsvWithDelimiter(text, delimiter) {
  return parse(text, {
    bom: true,
    columns: false,
    delimiter,
    relax_column_count: false,
    skip_empty_lines: false,
    trim: false,
    info: true,
  });
}

function parseCsvRows(buffer, kind, requestedEncoding) {
  const { text, encoding } = decodeCsvBuffer(buffer, kind, requestedEncoding);
  const delimiter = ';';
  let records = null;
  let semicolonError = null;

  try {
    records = parseCsvWithDelimiter(text, delimiter);
  } catch (error) {
    semicolonError = error;
  }

  if (!records) {
    const firstRecordSemicolons = countDelimiterInFirstRecord(text, ';');
    if (firstRecordSemicolons > 0) {
      throw new AppError(
        `File CSV tidak valid: ${semicolonError.message}`,
        400,
        null,
        'SOURCE_PARSE_ERROR',
      );
    }

    const firstRecordCommas = countDelimiterInFirstRecord(text, ',');
    const firstRecordTabs = countDelimiterInFirstRecord(text, '\t');
    if (firstRecordCommas > 0 || firstRecordTabs > 0) {
      throw new AppError(
        'Pemisah kolom CSV harus menggunakan titik koma (;).',
        422,
        null,
        'UNSUPPORTED_DELIMITER',
      );
    }

    throw new AppError(
      `File CSV tidak valid: ${semicolonError.message}`,
      400,
      null,
      'SOURCE_PARSE_ERROR',
    );
  }

  const firstRecord = records.find(
    (record) => Array.isArray(record?.record) && record.record.length > 0,
  );
  if (!firstRecord || firstRecord.record.length === 1) {
    const firstRecordCommas = countDelimiterInFirstRecord(text, ',');
    const firstRecordTabs = countDelimiterInFirstRecord(text, '\t');
    if (firstRecordCommas > 0 || firstRecordTabs > 0) {
      throw new AppError(
        'Pemisah kolom CSV harus menggunakan titik koma (;).',
        422,
        null,
        'UNSUPPORTED_DELIMITER',
      );
    }
  }

  if (records.length > MAX_IMPORT_ROWS + HEADER_SEARCH_ROWS) {
    throw new AppError(`Jumlah baris file melebihi batas ${MAX_IMPORT_ROWS}.`, 413);
  }

  const rows = records.map((entry, index) => {
    const values = Array.isArray(entry?.record) ? entry.record : [entry?.record];
    return {
      // csv-parse reports the physical line on which the record ends. Using
      // that location keeps row numbers aligned with the source file even
      // when an earlier field contains a quoted newline.
      rowNumber: Number(entry?.info?.lines) || index + 1,
      values,
      texts: values,
    };
  });
  rows.forEach(assertImportRecordSize);

  return {
    rows,
    format: 'csv',
    encoding,
    delimiter,
  };
}

function validateXlsxArchive(buffer) {
  const endSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const minimumEocdSize = 22;
  if (buffer.length < minimumEocdSize) {
    throw new AppError('Arsip XLSX tidak valid.', 415);
  }
  const searchStart = Math.max(0, buffer.length - minimumEocdSize - 65535);
  let eocdOffset = -1;

  for (let offset = buffer.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === endSignature) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new AppError('Struktur arsip XLSX tidak valid.', 415);
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new AppError('Arsip ZIP64 XLSX tidak didukung.', 415);
  }
  if (entryCount === 0 || entryCount > MAX_XLSX_ARCHIVE_ENTRIES) {
    throw new AppError(`Jumlah entri XLSX melebihi batas ${MAX_XLSX_ARCHIVE_ENTRIES}.`, 413);
  }
  if (
    centralDirectoryOffset + centralDirectorySize > buffer.length ||
    centralDirectoryOffset < 0
  ) {
    throw new AppError('Direktori sentral XLSX tidak valid.', 415);
  }

  const filenames = new Set();
  let uncompressedBytes = 0;
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== centralSignature) {
      throw new AppError('Entri arsip XLSX tidak valid.', 415);
    }

    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + filenameLength + extraLength + commentLength;

    if (nextOffset > buffer.length) {
      throw new AppError('Entri arsip XLSX tidak valid.', 415);
    }

    uncompressedBytes += uncompressedSize;
    if (uncompressedBytes > MAX_XLSX_UNCOMPRESSED_BYTES) {
      throw new AppError(
        `Ukuran XLSX setelah dekompresi melebihi batas ${MAX_XLSX_UNCOMPRESSED_BYTES} byte.`,
        413
      );
    }

    const filename = buffer
      .subarray(offset + 46, offset + 46 + filenameLength)
      .toString('utf8')
      .replace(/\\/g, '/');
    if (filename.startsWith('/') || filename.split('/').includes('..')) {
      throw new AppError('Arsip XLSX mengandung path yang tidak aman.', 415);
    }
    filenames.add(filename);
    offset = nextOffset;
  }

  const hasWorkbook = filenames.has('xl/workbook.xml');
  const hasWorksheet = Array.from(filenames).some((filename) =>
    /^xl\/worksheets\/sheet\d+\.xml$/i.test(filename)
  );
  if (!filenames.has('[Content_Types].xml') || !hasWorkbook || !hasWorksheet) {
    throw new AppError('Arsip ZIP bukan workbook XLSX yang valid.', 415);
  }
}

async function parseXlsxRows(buffer, requestedSheet = null, kind = 'transformer', explicitMapping = null) {
  const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  if (!buffer.subarray(0, 4).equals(zipSignature)) {
    throw new AppError('Signature file tidak sesuai dengan ekstensi .xlsx.', 415);
  }
  validateXlsxArchive(buffer);

  // Use an exact standalone Buffer. Some multipart producers expose a view
  // into a larger pooled ArrayBuffer, which is not safe for ZIP readers.
  const workbookBuffer = Buffer.allocUnsafeSlow(buffer.length);
  buffer.copy(workbookBuffer);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(workbookBuffer);
  } catch (error) {
    throw new AppError(`Workbook XLSX tidak valid atau rusak: ${error.message}`, 400);
  }

  const nonEmptyWorksheets = workbook.worksheets.filter(
    (worksheet) => worksheet.actualRowCount > 0,
  );
  // A workbook may contain a cover or metadata sheet. Only sheets whose rows
  // contain the canonical data headers are candidates for automatic selection.
  const candidateWorksheets = nonEmptyWorksheets.filter((worksheet) =>
    worksheetHasCanonicalHeader(worksheet, kind, explicitMapping),
  );

  let selectedWorksheet = null;
  if (requestedSheet) {
    selectedWorksheet = workbook.getWorksheet(requestedSheet);
    if (!selectedWorksheet) {
      throw new AppError(
        `Worksheet '${requestedSheet}' tidak ditemukan dalam file XLSX.`,
        422,
        null,
        'VALIDATION_ERROR',
      );
    }
    if (selectedWorksheet.actualRowCount === 0) {
      throw new AppError(
        `Worksheet '${requestedSheet}' tidak memiliki baris data.`,
        422,
        null,
        'VALIDATION_ERROR',
      );
    }
  } else if (candidateWorksheets.length > 1) {
    throw new AppError(
      "Workbook XLSX memiliki lebih dari satu worksheet data. Tentukan parameter 'sheet'.",
      422,
      null,
      'SHEET_REQUIRED',
    );
  } else if (candidateWorksheets.length === 1) {
    selectedWorksheet = candidateWorksheets[0];
  } else if (nonEmptyWorksheets.length === 1) {
    // Let the shared header detector return the canonical header error.
    selectedWorksheet = nonEmptyWorksheets[0];
  } else {
    throw new AppError(
      'Workbook XLSX tidak memiliki worksheet data yang dapat dikenali.',
      400,
      null,
      'SOURCE_PARSE_ERROR',
    );
  }

  const rows = [];
  selectedWorksheet.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length >= MAX_IMPORT_ROWS + HEADER_SEARCH_ROWS) {
      throw new AppError(`Jumlah baris file melebihi batas ${MAX_IMPORT_ROWS}.`, 413);
    }

    const columnCount = row.cellCount;
    if (columnCount > MAX_IMPORT_COLUMNS) {
      throw new AppError(`Jumlah kolom file melebihi batas ${MAX_IMPORT_COLUMNS}.`, 413);
    }

    const values = [];
    const texts = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      values.push(cell.value);
      texts.push(cell.text);
    }

    const parsedRow = {
      rowNumber: row.number,
      values,
      texts,
    };
    assertImportRecordSize(parsedRow);
    rows.push(parsedRow);
  });

  if (rows.length === 0) {
    throw new AppError(
      'Workbook XLSX tidak memiliki worksheet yang dapat dibaca.',
      400,
      null,
      'SOURCE_PARSE_ERROR',
    );
  }

  return {
    rows,
    format: 'xlsx',
    encoding: null,
    delimiter: null,
    worksheetName: selectedWorksheet.name,
  };
}

function mapHeaders(normalizedHeaders, aliases) {
  const mapping = {};
  for (const [field, acceptedAliases] of Object.entries(aliases)) {
    const index = normalizedHeaders.findIndex((header) => acceptedAliases.includes(header));
    mapping[field] = index >= 0 ? index : -1;
  }
  return mapping;
}

function parseExplicitMapping(value, kind) {
  if (value === null || value === undefined || value === '') return null;

  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_error) {
      throw new AppError(
        'Mapping import harus berupa objek JSON yang valid.',
        400,
        null,
        'MALFORMED_MULTIPART'
      );
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(
      'Mapping import harus berupa objek JSON.',
      400,
      null,
      'MALFORMED_MULTIPART'
    );
  }

  const aliases =
    kind === 'transformer' ? TRANSFORMER_HEADER_ALIASES : CUSTOMER_HEADER_ALIASES;
  const allowedFields = new Set(Object.keys(aliases));
  const mapping = {};
  for (const [field, sourceHeader] of Object.entries(parsed)) {
    if (!allowedFields.has(field)) {
      throw new AppError(
        `Field mapping '${field}' tidak dikenal.`,
        422,
        null,
        'UNEXPECTED_FIELD'
      );
    }
    if (typeof sourceHeader !== 'string' || !sourceHeader.trim()) {
      throw new AppError(
        `Header sumber untuk '${field}' wajib diisi.`,
        422,
        null,
        'VALIDATION_ERROR'
      );
    }
    mapping[field] = sourceHeader.trim();
  }
  if (Object.keys(mapping).length === 0) return null;
  return mapping;
}

function applyExplicitHeaderMapping(normalizedHeaders, aliases, explicitMapping) {
  const mapping = mapHeaders(normalizedHeaders, aliases);
  if (!explicitMapping) return mapping;

  for (const [field, sourceHeader] of Object.entries(explicitMapping)) {
    const index = normalizedHeaders.findIndex(
      (header) => header === normalizeHeader(sourceHeader),
    );
    mapping[field] = index;
  }
  return mapping;
}

function worksheetHasCanonicalHeader(worksheet, kind, explicitMapping = null) {
  const aliases =
    kind === 'transformer' ? TRANSFORMER_HEADER_ALIASES : CUSTOMER_HEADER_ALIASES;
  const requiredFields = kind === 'transformer' ? ['name'] : ['customerId', 'name'];
  const rowLimit = Math.min(worksheet.actualRowCount, HEADER_SEARCH_ROWS);

  for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const headers = [];
    for (let columnNumber = 1; columnNumber <= row.cellCount; columnNumber += 1) {
      headers.push(row.getCell(columnNumber).text.trim());
    }
    const normalizedHeaders = headers.map((value) => normalizeHeader(value));
    const mapping = applyExplicitHeaderMapping(
      normalizedHeaders,
      aliases,
      explicitMapping,
    );
    const explicitFieldsPresent = explicitMapping
      ? Object.keys(explicitMapping).every((field) => mapping[field] >= 0)
      : true;
    const hasRequiredFields = requiredFields.every((field) => mapping[field] >= 0);
    if (hasRequiredFields && explicitFieldsPresent) return true;
  }

  return false;
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableJsonValue(value[key]);
        return result;
      }, {});
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableJsonValue(value));
}

function normalizeIssueForStorage(issue, data) {
  const rawField =
    issue.field === 'coordinates' ? 'rawCoordinates' : issue.field;
  const rawValue = data?.[rawField];
  return {
    field: issue.field ?? null,
    code: issue.code,
    message: issue.message,
    rawValue:
      rawValue === null || rawValue === undefined
        ? null
        : String(rawValue).slice(0, 4096),
    action: issue.action || 'reject',
  };
}

function buildDiffReport(kind, prepared) {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      kind,
      rows: prepared.map((record) => ({
        rowNumber: record.rowNumber,
        status: record.status,
        data: record.data,
        existingId: record.existingId ? String(record.existingId) : null,
        expectedUpdatedAt: record.expectedUpdatedAt
          ? new Date(record.expectedUpdatedAt).toISOString()
          : null,
        existingFingerprint: record.existingFingerprint ?? null,
        issues: record.errors.map((issue) => normalizeIssueForStorage(issue, record.data)),
      })),
    }),
    'utf8',
  );
}

function parseDiffReport(buffer, expectedSha256, expectedKind) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(
      'Diff import yang telah ditinjau tidak tersedia.',
      409,
      null,
      'IMPORT_DIFF_NOT_FOUND',
    );
  }
  const actualSha256 = sha256(buffer);
  if (actualSha256 !== expectedSha256) {
    throw new AppError(
      'Hash diff import tidak cocok dengan pratinjau yang telah ditinjau.',
      409,
      null,
      'IMPORT_HASH_MISMATCH'
    );
  }

  let report;
  try {
    report = JSON.parse(buffer.toString('utf8'));
  } catch (_error) {
    throw new AppError(
      'Diff import yang telah ditinjau tidak valid.',
      409,
      null,
      'IMPORT_DIFF_INVALID',
    );
  }
  if (report?.version !== 1 || report.kind !== expectedKind || !Array.isArray(report.rows)) {
    throw new AppError(
      'Diff import yang telah ditinjau tidak valid.',
      409,
      null,
      'IMPORT_DIFF_INVALID',
    );
  }
  return report;
}

function buildResolvedMapping(header) {
  const resolved = {};
  for (const [field, columnIndex] of Object.entries(header.mapping || {})) {
    if (!Number.isInteger(columnIndex) || columnIndex < 0) continue;
    const sourceHeader = header.headers?.[columnIndex];
    if (sourceHeader) resolved[field] = sourceHeader;
  }
  return Object.keys(resolved).length > 0 ? resolved : null;
}

class ImportService {
  async parseFile(buffer, filename, kind = 'transformer', options = {}) {
    const normalizedOptions =
      typeof options === 'string' ? { format: options } : options || {};
    const declaredFormat = normalizedOptions.format || null;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new AppError('File tidak ditemukan atau kosong.', 400);
    }
    if (buffer.length > MAX_IMPORT_FILE_SIZE) {
      throw new AppError(`Ukuran file melebihi batas ${MAX_IMPORT_FILE_SIZE} byte.`, 413);
    }

    const normalizedKind = normalizeKind(kind);
    const cleanFilename = safeFilename(filename);
    const extension = path.extname(cleanFilename).toLowerCase();

    if (!['.csv', '.xlsx'].includes(extension)) {
      throw new AppError('Ekstensi file harus .csv atau .xlsx.', 415);
    }

    const detectedFormat = extension === '.csv' ? 'csv' : 'xlsx';
    if (declaredFormat) {
      const normalizedDeclared = String(declaredFormat).trim().toLowerCase();
      if (!['csv', 'xlsx'].includes(normalizedDeclared)) {
        throw new AppError('Format file harus csv atau xlsx.', 415);
      }
      if (normalizedDeclared !== detectedFormat) {
        throw new AppError('Format yang diminta tidak cocok dengan ekstensi file.', 415);
      }
    }

    if (detectedFormat === 'csv') {
      if (!looksLikeCsv(buffer)) {
        throw new AppError('Konten file tidak valid untuk CSV.', 415);
      }
      return parseCsvRows(
        buffer,
        normalizedKind,
        normalizedOptions.encoding || null,
      );
    }

    const requestedSheet =
      normalizedOptions.sheet === undefined || normalizedOptions.sheet === null
        ? null
        : String(normalizedOptions.sheet).trim();
    return parseXlsxRows(
      buffer,
      requestedSheet || null,
      normalizedKind,
      normalizedOptions.mapping || null,
    );
  }

  detectHeader(rows, kind, explicitMapping = null) {
    const normalizedKind = normalizeKind(kind);
    const aliases =
      normalizedKind === 'transformer' ? TRANSFORMER_HEADER_ALIASES : CUSTOMER_HEADER_ALIASES;
    const requiredFields = normalizedKind === 'transformer' ? ['name'] : ['customerId', 'name'];

    let selected = null;
    let selectedScore = -1;
    const foundExplicitHeaders = new Set();

    for (let index = 0; index < Math.min(rows.length, HEADER_SEARCH_ROWS); index += 1) {
      const row = rows[index];
      const headers = row.values.map((value) => String(value ?? '').trim());
      const normalizedHeaders = headers.map((value) => normalizeHeader(value));
      const mapping = applyExplicitHeaderMapping(
        normalizedHeaders,
        aliases,
        explicitMapping,
      );
      const explicitFieldsPresent = explicitMapping
        ? Object.keys(explicitMapping).every((field) => mapping[field] >= 0)
        : true;
      if (explicitMapping) {
        for (const field of Object.keys(explicitMapping)) {
          if (mapping[field] >= 0) foundExplicitHeaders.add(field);
        }
      }
      const matchedFields = Object.values(mapping).filter((columnIndex) => columnIndex >= 0).length;
      const hasRequiredFields = requiredFields.every((field) => mapping[field] >= 0);

      if (hasRequiredFields && explicitFieldsPresent && matchedFields > selectedScore) {
        selected = { index, mapping, normalizedHeaders, headers };
        selectedScore = matchedFields;
      }
    }

    if (explicitMapping) {
      const missingExplicitHeaders = Object.keys(explicitMapping).filter(
        (field) => !foundExplicitHeaders.has(field),
      );
      if (missingExplicitHeaders.length > 0) {
        throw new AppError(
          `Header sumber untuk mapping '${missingExplicitHeaders.join(', ')}' tidak ditemukan.`,
          422,
          null,
          'VALIDATION_ERROR'
        );
      }
    }

    if (!selected) {
      throw new AppError(
        normalizedKind === 'transformer'
          ? 'Header trafo tidak ditemukan. Pastikan kolom nama_trafo tersedia.'
          : 'Header pelanggan tidak ditemukan. Pastikan kolom IDPEL dan NAMA tersedia.',
        400,
        null,
        'SOURCE_PARSE_ERROR'
      );
    }

    const selectedHeaders = new Set(selected.normalizedHeaders);
    if (
      normalizedKind === 'transformer' &&
      (selectedHeaders.has('id_pelanggan') || selectedHeaders.has('idpel'))
    ) {
      throw new AppError(
        'File Seems customer data dan tidak boleh diimpor sebagai trafo.',
        400,
        null,
        'IMPORT_DATASET_MISMATCH'
      );
    }
    if (
      normalizedKind === 'customer' &&
      (selectedHeaders.has('nama_trafo') || selectedHeaders.has('titik_koordinat'))
    ) {
      throw new AppError(
        'File Seems transformer data dan tidak boleh diimpor sebagai pelanggan.',
        400,
        null,
        'IMPORT_DATASET_MISMATCH'
      );
    }

    return selected;
  }

  detectHeaderRow(rows, kind) {
    return this.detectHeader(rows, kind).index;
  }

  async generatePreview(file, kind, userId, options = {}) {
    if (!file || !file.buffer) throw new AppError('File tidak ditemukan dalam request.', 400);
    if (!userId) throw new AppError('Sesi pengguna tidak valid.', 401);

    const normalizedKind = normalizeKind(kind);
    const explicitMapping = parseExplicitMapping(
      options.mapping,
      normalizedKind,
    );
    const parsed = await this.parseFile(
      file.buffer,
      file.originalname,
      normalizedKind,
      { ...options, mapping: explicitMapping }
    );

    const header = this.detectHeader(
      parsed.rows,
      normalizedKind,
      explicitMapping,
    );
    const resolvedMapping = buildResolvedMapping(header);
    const dataRows = parsed.rows.slice(header.index + 1).filter((row) => !rowIsEmpty(row));
    if (dataRows.length === 0) {
      throw new AppError('File tidak memiliki baris data setelah header.', 400);
    }
    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new AppError(`Jumlah baris data melebihi batas ${MAX_IMPORT_ROWS}.`, 413);
    }

    const prepared =
      normalizedKind === 'transformer'
        ? this.prepareTransformerRows(dataRows, header.mapping)
        : this.prepareCustomerRows(dataRows, header.mapping);

    await this.applyExistingComparisons(prepared, normalizedKind);

    const summary = {
      totalRows: prepared.length,
      validRows: 0,
      insertCount: 0,
      updateCount: 0,
      unchangedCount: 0,
      rejectedCount: 0,
    };
    for (const record of prepared) {
      if (record.status === 'rejected') {
        summary.rejectedCount += 1;
      } else {
        summary.validRows += 1;
        summary[`${record.status}Count`] += 1;
      }
    }

    if (
      summary.totalRows !== summary.validRows + summary.rejectedCount ||
      summary.validRows !==
        summary.insertCount + summary.updateCount + summary.unchangedCount
    ) {
      throw new Error('Import summary invariants failed.');
    }

    await this.cleanupExpiredJobs();

    const token = randomToken();
    const jobId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + IMPORT_JOB_TTL_MS);
    const filename = safeFilename(file.originalname);
    const sourceSha256 = sha256(file.buffer);
    const diffReport = buildDiffReport(normalizedKind, prepared);
    const diffReportSha256 = sha256(diffReport);

    let stagedUploadId = null;
    let diffReportUploadId = null;
    let job = null;

    try {
      stagedUploadId = await importStagingService.uploadBuffer(file.buffer, filename, {
        jobId,
        kind: normalizedKind,
        format: parsed.format,
        sourceSha256,
        artifactType: 'source',
        expiresAt,
      });
      diffReportUploadId = await importStagingService.uploadBuffer(
        diffReport,
        `${jobId}.diff.json`,
        {
          jobId,
          kind: normalizedKind,
          format: 'json',
          sourceSha256: diffReportSha256,
          artifactType: 'diff_report',
          expiresAt,
        },
      );

      job = await ImportJob.create({
        jobId,
        kind: normalizedKind,
        origin: 'api_import',
        format: parsed.format,
        sourceEncoding: parsed.encoding || null,
        sourceWorksheetName: parsed.worksheetName || null,
        sourceFilename: filename,
        sourceSizeBytes: file.buffer.length,
        sourceSha256,
        stagedUploadId,
        diffReportUploadId,
        diffReportSha256,
        previewTokenHash: tokenDigest(token),
        actorUserId: userId,
        status: 'previewed',
        summary,
        issueCount: prepared.reduce((total, record) => total + record.errors.length, 0),
        mapping: explicitMapping,
        resolvedMapping,
        expiresAt,
      });

      const issueRows = prepared.flatMap((record) =>
        record.errors.map((issue) => {
          const normalizedIssue = normalizeIssueForStorage(issue, record.data);
          return {
            jobId: job._id,
            rowNumber: record.rowNumber,
            field: normalizedIssue.field,
            code: normalizedIssue.code,
            message: normalizedIssue.message,
            rawValue: normalizedIssue.rawValue,
            action: normalizedIssue.action,
            expiresAt,
          };
        }),
      );
      if (issueRows.length > 0) {
        await ImportJobIssue.insertMany(issueRows, { ordered: false });
      }
    } catch (error) {
      if (job) {
        await ImportJobIssue.deleteMany({ jobId: job._id }).catch(() => undefined);
        await ImportJob.deleteOne({ _id: job._id }).catch(() => undefined);
      }
      await importStagingService.deleteArtifacts([stagedUploadId, diffReportUploadId]);
      throw error;
    }

    const allIssues = prepared.flatMap((record) =>
      record.errors.map((issue) => ({
        rowNumber: record.rowNumber,
        ...normalizeIssueForStorage(issue, record.data),
      })),
    );

    return {
      importJobId: jobId,
      previewToken: token,
      kind: normalizedKind,
      format: parsed.format,
      sourceEncoding: parsed.encoding || null,
      sourceWorksheetName: parsed.worksheetName || null,
      sourceFilename: filename,
      sourceSha256,
      expiresAt: expiresAt.toISOString(),
      summary,
      issueCount: allIssues.length,
      issues: allIssues.slice(0, MAX_INLINE_ISSUES),
      issuesTruncated: allIssues.length > MAX_INLINE_ISSUES,
    };
  }

  prepareCustomerRows(dataRows, mapping) {
    const prepared = [];
    const seenIds = new Map();

    for (const row of dataRows) {
      const customerId = cellText(row, mapping.customerId);
      const name = cellText(row, mapping.name);
      const tariff = cellText(row, mapping.tariff);
      const powerRaw = cellText(row, mapping.power);
      const address = cellText(row, mapping.address);
      const errors = [];

      const data = {
        customerId: customerId || null,
        name: name || null,
      };

      // Optional columns are represented only when the uploaded file actually
      // contains them. A missing column must not erase an existing value.
      if (mapping.tariff >= 0) data.tariff = tariff || null;
      if (mapping.power >= 0) {
        data.power = powerRaw || null;
        data.powerVa = null;
      }
      if (mapping.address >= 0) data.address = address || null;

      if (!customerId) {
        errors.push(makeIssue('customerId', 'REQUIRED', 'ID Pelanggan wajib diisi.'));
      } else if (isPlaceholder(customerId)) {
        errors.push(
          makeIssue('customerId', 'INVALID_CUSTOMER_ID', 'ID Pelanggan tidak valid.')
        );
      } else if (!/^\d{12}$/.test(customerId)) {
        errors.push(
          makeIssue(
            'customerId',
            'INVALID_CUSTOMER_ID',
            'ID Pelanggan harus terdiri dari tepat 12 digit.'
          )
        );
      } else if (seenIds.has(customerId)) {
        errors.push(
          makeIssue(
            'customerId',
            'DUPLICATE_IN_FILE',
            `ID Pelanggan duplikat dalam file; baris pertama ${seenIds.get(customerId)}.`
          )
        );
      } else {
        seenIds.set(customerId, row.rowNumber);
      }

      if (!name) {
        errors.push(makeIssue('name', 'REQUIRED', 'Nama pelanggan wajib diisi.'));
      } else if (isPlaceholder(name)) {
        errors.push(makeIssue('name', 'INVALID_NAME', 'Nama pelanggan tidak valid.'));
      } else if (name.length > CUSTOMER_NAME_MAX_LENGTH) {
        errors.push(
          makeIssue(
            'name',
            'INVALID_NAME',
            `Nama pelanggan maksimal ${CUSTOMER_NAME_MAX_LENGTH} karakter.`
          )
        );
      }

      if (mapping.power >= 0 && powerRaw) {
        const parsedPower = this.parsePowerVa(powerRaw);
        data.powerVa = parsedPower.value;
        if (parsedPower.error) {
          errors.push(makeIssue('power', 'INVALID_POWER_VALUE', parsedPower.error));
        }
      }

      // Import rows use the same canonical AJV constraints as direct writes.
      // Existing row-specific issues above take precedence so one invalid field
      // is reported once, while every other constrained field is still checked.
      appendCanonicalFieldIssues(CUSTOMER_WRITE_VALIDATOR, data, errors);

      prepared.push({
        rowNumber: row.rowNumber,
        status: 'rejected',
        valid: errors.length === 0,
        data,
        existingId: null,
        expectedUpdatedAt: null,
        existingFingerprint: null,
        errors,
      });
    }

    return prepared;
  }

  prepareTransformerRows(dataRows, mapping) {
    const prepared = [];
    const seenNames = new Map();

    for (const row of dataRows) {
      const name = cellText(row, mapping.name);
      const feeder = cellText(row, mapping.feeder);
      const capacity = cellText(row, mapping.capacity);
      const rawCoordinates = cellText(row, mapping.coordinates);
      const errors = [];

      const data = {
        name: name || null,
      };

      // Optional columns are represented only when the uploaded file actually
      // contains them. A missing column must not erase an existing value.
      if (mapping.feeder >= 0) data.feeder = feeder || null;
      if (mapping.capacity >= 0) {
        data.capacity = capacity || null;
        data.capacityKva = null;
      }
      if (mapping.coordinates >= 0) {
        data.rawCoordinates = rawCoordinates || null;
        data.location = null;
      }
      if (mapping.brand >= 0) data.brand = cellText(row, mapping.brand);
      if (mapping.grounding >= 0) data.grounding = cellText(row, mapping.grounding);

      if (!name) {
        errors.push(makeIssue('name', 'REQUIRED', 'Nama trafo wajib diisi.'));
      } else if (isPlaceholder(name)) {
        errors.push(makeIssue('name', 'INVALID_NAME', 'Nama trafo tidak valid.'));
      } else if (name.length > TRANSFORMER_NAME_MAX_LENGTH) {
        errors.push(
          makeIssue(
            'name',
            'INVALID_NAME',
            `Nama trafo maksimal ${TRANSFORMER_NAME_MAX_LENGTH} karakter.`
          )
        );
      } else {
        // Duplicate detection uses the canonical identity key so that names
        // that differ only by case or Unicode composition are one transformer.
        const nameKey = normalizeNameKey(name);
        if (seenNames.has(nameKey)) {
          errors.push(
            makeIssue(
              'name',
              'DUPLICATE_IN_FILE',
              `Nama trafo duplikat dalam file; baris pertama ${seenNames.get(nameKey)}.`
            )
          );
        } else {
          seenNames.set(nameKey, row.rowNumber);
        }
      }

      if (mapping.capacity >= 0 && capacity) {
        const parsedCapacity = this.parseCapacityKva(capacity);
        // The raw label remains authoritative. A multi-valued label is kept
        // verbatim with capacityKva=null pending operator review; it is not
        // rejected merely because it contains more than one candidate value.
        data.capacityKva = parsedCapacity.value;
        if (parsedCapacity.error && !parsedCapacity.ambiguous) {
          errors.push(makeIssue('capacity', 'INVALID_CAPACITY', parsedCapacity.error));
        }
      }

      if (mapping.coordinates >= 0 && rawCoordinates) {
        const parsedCoordinates = this.parseWktPoint(rawCoordinates);
        data.location = parsedCoordinates.location;
        if (parsedCoordinates.error) {
          errors.push(
            makeIssue('coordinates', 'INVALID_COORDINATES', parsedCoordinates.error)
          );
        }
      }

      // Apply the exact direct-write transformer constraints to imported rows.
      // This prevents an import from bypassing field bounds enforced by the
      // public API and Mongoose models.
      appendCanonicalFieldIssues(TRANSFORMER_WRITE_VALIDATOR, data, errors);

      prepared.push({
        rowNumber: row.rowNumber,
        status: 'rejected',
        valid: errors.length === 0,
        data,
        existingId: null,
        expectedUpdatedAt: null,
        existingFingerprint: null,
        errors,
      });
    }

    return prepared;
  }

  parsePowerVa(rawValue) {
    let value = String(rawValue).trim();
    value = value.replace(/\s*(VA|Volt.?)\s*$/i, '').trim();
    value = value.replace(/\s/g, '');

    let numericText = value;
    if (/^\d{1,3}(?:\.\d{3})+$/.test(numericText)) {
      numericText = numericText.replace(/\./g, '');
    } else if (/^\d+$/.test(numericText)) {
      // Plain integer VA is already in the canonical numeric representation.
    } else {
      return {
        value: null,
        error: 'Nilai daya harus berupa bilangan VA bulat yang tidak ambigu.',
      };
    }

    const numericValue = Number(numericText);
    if (!Number.isSafeInteger(numericValue) || numericValue < 0) {
      return {
        value: null,
        error: 'Nilai daya harus berupa bilangan VA bulat yang nonnegatif.',
      };
    }

    return { value: numericValue, error: null };
  }

  parseCapacityKva(rawValue) {
    return parseCapacityKva(rawValue);
  }

  parseWktPoint(rawValue) {
    const value = String(rawValue).trim();
    const match = value.match(
      /^POINT\s*\(\s*([-+]?\d+(?:[.,]\d+)?)\s*[, ]\s*([-+]?\d+(?:[.,]\d+)?)\s*\)$/i
    );

    if (!match) {
      return {
        location: null,
        error: 'Koordinat harus berupa WKT POINT (longitude latitude).',
      };
    }

    const longitude = Number(match[1].replace(',', '.'));
    const latitude = Number(match[2].replace(',', '.'));
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      return { location: null, error: 'Koordinat longitude/latitude tidak valid.' };
    }

    return {
      location: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
      error: null,
    };
  }

  async applyExistingComparisons(prepared, kind) {
    if (kind === 'customer') {
      const uniqueIds = new Set(
        prepared
          .map((record) => record.data.customerId)
          .filter((customerId) => typeof customerId === 'string' && customerId.length > 0)
      );
      const existingMap = await this.findExistingCustomers(Array.from(uniqueIds));

      for (const record of prepared) {
        if (!record.valid) continue;
        const existing = existingMap.get(record.data.customerId);
        if (!existing) {
          record.status = 'insert';
          continue;
        }

        record.existingId = existing._id;
        record.expectedUpdatedAt = existing.updatedAt
          ? new Date(existing.updatedAt).toISOString()
          : null;
        record.existingFingerprint = this.customerFingerprint(existing, record.data);
        record.status = this.customerIsSame(existing, record.data) ? 'unchanged' : 'update';
      }
      return;
    }

    const uniqueNames = new Set(
      prepared
        .map((record) => record.data.name)
        .filter((name) => typeof name === 'string' && name.length > 0)
    );
    const existingMap = await this.findExistingTransformers(Array.from(uniqueNames));

    for (const record of prepared) {
      if (!record.valid) continue;
      const existing = existingMap.get(normalizeNameKey(record.data.name));
      if (!existing) {
        record.status = 'insert';
        continue;
      }

      record.existingId = existing._id;
      record.expectedUpdatedAt = existing.updatedAt
        ? new Date(existing.updatedAt).toISOString()
        : null;
      record.existingFingerprint = this.transformerFingerprint(existing, record.data);
      record.status = this.transformerIsSame(existing, record.data) ? 'unchanged' : 'update';
    }
  }

  async findExistingCustomers(customerIds) {
    const result = new Map();

    for (let offset = 0; offset < customerIds.length; offset += DATABASE_BATCH_SIZE) {
      const batch = customerIds.slice(offset, offset + DATABASE_BATCH_SIZE);
      const customers = await Customer.find({ customerId: { $in: batch } }).lean();
      for (const customer of customers) {
        result.set(customer.customerId, customer);
      }
    }

    return result;
  }

  /**
   * Resolves existing transformers by their canonical identity key. The
   * document name is always re-normalized here, so legacy records that still
   * miss a nameKey are matched by the same rule as migrated records.
   */
  async findExistingTransformers(names) {
    const result = new Map();
    const uniqueNames = [];
    const uniqueKeys = new Set();

    for (const name of names) {
      if (typeof name !== 'string' || name.length === 0) continue;
      const nameKey = normalizeNameKey(name);
      if (!nameKey || uniqueKeys.has(nameKey)) continue;
      uniqueKeys.add(nameKey);
      uniqueNames.push(name);
    }

    for (let offset = 0; offset < uniqueNames.length; offset += DATABASE_BATCH_SIZE) {
      const batch = uniqueNames.slice(offset, offset + DATABASE_BATCH_SIZE);
      const batchKeys = batch.map((name) => normalizeNameKey(name));
      const transformers = await Transformer.find({
        $or: [{ nameKey: { $in: batchKeys } }, { name: { $in: batch } }],
      })
        .collation(CASE_INSENSITIVE_COLLATION)
        .lean();
      for (const transformer of transformers) {
        const nameKey = normalizeNameKey(transformer.name);
        if (!nameKey || result.has(nameKey)) continue;
        result.set(nameKey, transformer);
      }
    }

    return result;
  }

  customerFingerprint(existing, incoming) {
    const fingerprint = {};
    const fields = ['name', 'tariff', 'power', 'powerVa', 'address'];
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(incoming, field)) continue;
      if (field === 'power') {
        fingerprint.power = normalizeNullable(
          existing.powerRaw !== undefined ? existing.powerRaw : existing.power,
        );
      } else if (field === 'powerVa') {
        fingerprint.powerVa =
          existing.powerVa === undefined || existing.powerVa === null
            ? null
            : Number(existing.powerVa);
      } else {
        fingerprint[field] = normalizeNullable(existing[field]);
      }
    }
    return fingerprint;
  }

  customerIsSame(existing, incoming) {
    if (normalizeNullable(existing.name) !== normalizeNullable(incoming.name)) return false;

    if (
      Object.prototype.hasOwnProperty.call(incoming, 'tariff') &&
      normalizeNullable(existing.tariff) !== normalizeNullable(incoming.tariff)
    ) {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'power')) {
      const existingPowerRaw =
        existing.powerRaw !== undefined ? existing.powerRaw : existing.power;
      if (normalizeNullable(existingPowerRaw) !== normalizeNullable(incoming.power)) {
        return false;
      }

      const existingPowerVa =
        existing.powerVa === undefined || existing.powerVa === null
          ? null
          : Number(existing.powerVa);
      const incomingPowerVa =
        incoming.powerVa === undefined || incoming.powerVa === null
          ? null
          : Number(incoming.powerVa);
      if (existingPowerVa !== incomingPowerVa) return false;
    }

    if (
      Object.prototype.hasOwnProperty.call(incoming, 'address') &&
      normalizeNullable(existing.address) !== normalizeNullable(incoming.address)
    ) {
      return false;
    }

    return true;
  }

  transformerFingerprint(existing, incoming) {
    const fingerprint = {};
    const fields = [
      'name',
      'feeder',
      'capacity',
      'capacityKva',
      'rawCoordinates',
      'brand',
      'grounding',
    ];
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(incoming, field)) continue;
      fingerprint[field] =
        field === 'capacityKva'
          ? existing.capacityKva === undefined || existing.capacityKva === null
            ? null
            : Number(existing.capacityKva)
          : normalizeNullable(existing[field]);
    }
    if (Object.prototype.hasOwnProperty.call(incoming, 'rawCoordinates')) {
      fingerprint.location = this.getCoordinates(existing.location);
    }
    return fingerprint;
  }

  transformerIsSame(existing, incoming) {
    if (normalizeNullable(existing.name) !== normalizeNullable(incoming.name)) return false;

    if (
      Object.prototype.hasOwnProperty.call(incoming, 'feeder') &&
      normalizeNullable(existing.feeder) !== normalizeNullable(incoming.feeder)
    ) {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'capacity')) {
      if (normalizeNullable(existing.capacity) !== normalizeNullable(incoming.capacity)) {
        return false;
      }

      const existingCapacityKva =
        existing.capacityKva === undefined || existing.capacityKva === null
          ? null
          : Number(existing.capacityKva);
      const incomingCapacityKva =
        incoming.capacityKva === undefined || incoming.capacityKva === null
          ? null
          : Number(incoming.capacityKva);
      if (existingCapacityKva !== incomingCapacityKva) return false;
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'rawCoordinates')) {
      if (
        normalizeNullable(existing.rawCoordinates) !==
        normalizeNullable(incoming.rawCoordinates)
      ) {
        return false;
      }

      const existingCoordinates = this.getCoordinates(existing.location);
      const incomingCoordinates = this.getCoordinates(incoming.location);
      if (!this.coordinatesEqual(existingCoordinates, incomingCoordinates)) return false;
    }

    if (
      Object.prototype.hasOwnProperty.call(incoming, 'brand') &&
      normalizeNullable(existing.brand) !== normalizeNullable(incoming.brand)
    ) {
      return false;
    }

    if (
      Object.prototype.hasOwnProperty.call(incoming, 'grounding') &&
      normalizeNullable(existing.grounding) !== normalizeNullable(incoming.grounding)
    ) {
      return false;
    }

    return true;
  }

  getCoordinates(location) {
    if (Array.isArray(location)) return location;
    if (Array.isArray(location?.coordinates)) return location.coordinates;
    return null;
  }

  coordinatesEqual(first, second) {
    if (!first && !second) return true;
    if (!first || !second || first.length !== 2 || second.length !== 2) return false;
    return Number(first[0]) === Number(second[0]) && Number(first[1]) === Number(second[1]);
  }

  parsePagination(options = {}) {
    const parseValue = (name, fallback, maximum) => {
      const raw = options[name];
      if (raw === undefined || raw === null || raw === '') return fallback;
      const text = String(raw).trim();
      if (!/^\d+$/.test(text)) {
        throw new AppError(`${name} harus berupa bilangan bulat positif.`, 422);
      }
      const value = Number(text);
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new AppError(`${name} harus berada antara 1 dan ${maximum}.`, 422);
      }
      return value;
    };

    return {
      page: parseValue('page', 1, 1_000_000),
      pageSize: parseValue('pageSize', 20, 100),
    };
  }

  async cleanupExpiredJobs() {
    const now = new Date();
    const expiredJobs = await ImportJob.find({ expiresAt: { $lte: now } })
      .select('_id jobId stagedUploadId diffReportUploadId')
      .lean();

    const artifactCleanup = await importStagingService.cleanupExpiredArtifacts(now);
    if (artifactCleanup.failures.length > 0) {
      console.error('[Import] Some expired staging artifacts could not be deleted.', {
        failures: artifactCleanup.failures,
      });
    }

    for (const job of expiredJobs) {
      const deletion = await importStagingService.deleteArtifacts([
        job.stagedUploadId,
        job.diffReportUploadId,
      ]);
      if (deletion.failed.length > 0) {
        // Keep the job metadata so a later sweep can retry the PII deletion.
        console.error('[Import] Expired import artifacts remain; cleanup will be retried.', {
          importJobId: job.jobId,
          failures: deletion.failed,
        });
        continue;
      }

      await Promise.all([
        ImportJobIssue.deleteMany({ jobId: job._id }),
        ImportJob.deleteOne({ _id: job._id }),
      ]);
    }
  }

  startImportCleanupScheduler() {
    if (this.cleanupTimer) return this.cleanupTimer;

    const runCleanup = () => {
      this.cleanupExpiredJobs().catch((error) => {
        console.error('[Import] Scheduled cleanup failed.', {
          message: error.message,
          stack: error.stack,
        });
      });
    };

    runCleanup();
    this.cleanupTimer = setInterval(runCleanup, IMPORT_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
    return this.cleanupTimer;
  }

  stopImportCleanupScheduler() {
    if (!this.cleanupTimer) return;
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  async markJobFailed(jobId, code, message) {
    await ImportJob.updateOne(
      { _id: jobId, status: { $in: ['previewed', 'failed'] } },
      {
        $set: {
          status: 'failed',
          commitError: {
            code,
            message,
            occurredAt: new Date(),
          },
        },
      },
    );
  }

  async findAccessibleJob(importJobId, userId, isSuperadmin = false) {
    if (!importJobId || !userId) {
      throw new AppError('importJobId tidak valid.', 400);
    }
    const job = await ImportJob.findOne({ jobId: String(importJobId) }).lean();
    if (!job) throw new AppError('Import job tidak ditemukan.', 404);
    if (!isSuperadmin && String(job.actorUserId) !== String(userId)) {
      throw new AppError(
        'Import job tidak dimiliki oleh pengguna saat ini.',
        403,
        null,
        'IMPORT_JOB_OWNER_MISMATCH'
      );
    }
    if (job.expiresAt <= new Date()) {
      if (job.status !== 'committed' && job.status !== 'expired') {
        await ImportJob.updateOne(
          { _id: job._id },
          { $set: { status: 'expired', commitError: { code: 'IMPORT_PREVIEW_EXPIRED' } } }
        );
      }
      throw new AppError(
        'Import job telah kedaluwarsa.',
        410,
        null,
        'IMPORT_PREVIEW_EXPIRED'
      );
    }
    return job;
  }

  async getImportJob(importJobId, userId, isSuperadmin = false) {
    const job = await this.findAccessibleJob(importJobId, userId, isSuperadmin);
    return {
      importJobId: job.jobId,
      kind: job.kind,
      origin: job.origin,
      format: job.format,
      sourceEncoding: job.sourceEncoding || null,
      sourceWorksheetName: job.sourceWorksheetName || null,
      sourceFilename: job.sourceFilename,
      sourceSizeBytes: job.sourceSizeBytes,
      sourceSha256: job.sourceSha256,
      status: job.status,
      summary: job.summary,
      issueCount: job.issueCount || 0,
      mapping: job.mapping || null,
      resolvedMapping: job.resolvedMapping || null,
      createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      expiresAt: job.expiresAt ? new Date(job.expiresAt).toISOString() : null,
      committedAt: job.committedAt ? new Date(job.committedAt).toISOString() : null,
      result: job.commitResult || null,
    };
  }

  async getImportIssues(importJobId, userId, isSuperadmin = false, options = {}) {
    const job = await this.findAccessibleJob(importJobId, userId, isSuperadmin);
    const { page, pageSize } = this.parsePagination(options);
    const code = String(options.code || '').trim();
    const query = { jobId: job._id };
    if (code) query.code = code;

    const [documents, total] = await Promise.all([
      ImportJobIssue.find(query)
        .sort({ rowNumber: 1, field: 1, _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      ImportJobIssue.countDocuments(query),
    ]);
    const items = documents.map((issue) => ({
      rowNumber: issue.rowNumber,
      field: issue.field ?? null,
      code: issue.code,
      message: issue.message,
      rawValue: issue.rawValue ?? null,
      action: issue.action,
    }));

    return {
      items,
      meta: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async getImportRows(importJobId, userId, isSuperadmin = false, options = {}) {
    const job = await this.findAccessibleJob(importJobId, userId, isSuperadmin);
    const { page, pageSize } = this.parsePagination(options);
    const diffBuffer = await importStagingService.downloadBuffer(job.diffReportUploadId);
    const report = parseDiffReport(diffBuffer, job.diffReportSha256, job.kind);
    const total = report.rows.length;
    const items = report.rows
      .slice((page - 1) * pageSize, page * pageSize)
      .map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        data: row.data || {},
        issues: Array.isArray(row.issues) ? row.issues : [],
      }));

    return {
      items,
      meta: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async commitImport({ importJobId, previewToken }, userId) {
    if (!userId) throw new AppError('Sesi pengguna tidak valid.', 401);
    if (typeof importJobId !== 'string' || !importJobId.trim()) {
      throw new AppError('importJobId tidak valid.', 422);
    }
    if (typeof previewToken !== 'string' || previewToken.trim().length < 32) {
      throw new AppError('previewToken tidak valid.', 422);
    }

    const now = new Date();
    const job = await ImportJob.findOne({
      jobId: importJobId.trim(),
      previewTokenHash: tokenDigest(previewToken.trim()),
    }).lean();
    if (!job) {
      throw new AppError(
        'Import job atau preview token tidak valid.',
        404,
        null,
        'IMPORT_PREVIEW_NOT_FOUND'
      );
    }
    if (String(job.actorUserId) !== String(userId)) {
      throw new AppError(
        'Import job tidak dimiliki oleh pengguna saat ini.',
        403,
        null,
        'IMPORT_JOB_OWNER_MISMATCH'
      );
    }
    // A successful commit is idempotent even after the preview TTL has elapsed;
    // the stored result remains the authoritative response until the job is
    // physically removed by MongoDB's TTL monitor.
    if (job.status === 'committed') {
      return {
        importJobId: job.jobId,
        status: 'committed',
        committedAt: job.committedAt
          ? new Date(job.committedAt).toISOString()
          : null,
        result: job.commitResult,
      };
    }
    if (job.expiresAt <= now) {
      await ImportJob.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'expired',
            commitError: { code: 'IMPORT_PREVIEW_EXPIRED' },
            commitLeaseUntil: null,
          },
        }
      );
      throw new AppError(
        'Import preview telah kedaluwarsa.',
        410,
        null,
        'IMPORT_PREVIEW_EXPIRED'
      );
    }
    if (
      !['previewed', 'failed', 'committing'].includes(job.status)
    ) {
      throw new AppError(
        'Import job tidak berada dalam status yang dapat dikomit.',
        409,
        null,
        'IMPORT_JOB_STATE_CONFLICT'
      );
    }
    if (
      job.status === 'committing' &&
      job.commitLeaseUntil &&
      new Date(job.commitLeaseUntil) > new Date()
    ) {
      throw new AppError(
        'Import job sedang diproses.',
        409,
        null,
        'IMPORT_JOB_STATE_CONFLICT'
      );
    }
    if (
      job.status === 'failed' &&
      job.commitError?.code === 'IMPORT_TARGET_CONFLICT'
    ) {
      throw new AppError(
        'Target import berubah setelah pratinjau. Buat pratinjau baru sebelum mencoba kembali.',
        409,
        null,
        'IMPORT_TARGET_CONFLICT'
      );
    }

    const sourceBuffer = await importStagingService.downloadBuffer(job.stagedUploadId);
    if (!sourceBuffer) {
      await this.markJobFailed(
        job._id,
        'IMPORT_SOURCE_NOT_FOUND',
        'Sumber import yang telah ditinjau tidak tersedia.',
      );
      throw new AppError(
        'Sumber import yang telah ditinjau tidak tersedia.',
        409,
        null,
        'IMPORT_SOURCE_NOT_FOUND'
      );
    }
    if (sha256(sourceBuffer) !== job.sourceSha256) {
      await this.markJobFailed(
        job._id,
        'IMPORT_HASH_MISMATCH',
        'Hash sumber import tidak cocok dengan pratinjau yang telah ditinjau.',
      );
      throw new AppError(
        'Hash sumber import tidak cocok dengan pratinjau yang telah ditinjau.',
        409,
        null,
        'IMPORT_HASH_MISMATCH'
      );
    }

    const diffBuffer = await importStagingService.downloadBuffer(job.diffReportUploadId);
    let report;
    try {
      report = parseDiffReport(diffBuffer, job.diffReportSha256, job.kind);
    } catch (error) {
      await this.markJobFailed(
        job._id,
        error.code || 'IMPORT_DIFF_INVALID',
        error.message,
      );
      throw error;
    }
    const actionableRows = report.rows.filter((row) =>
      ['insert', 'update'].includes(row.status)
    );
    const unchangedRows = report.rows.filter((row) => row.status === 'unchanged');

    try {
      await this.assertUnchangedTargets(job.kind, unchangedRows);
    } catch (error) {
      if (error?.code === 'IMPORT_TARGET_CONFLICT') {
        await this.markJobFailed(
          job._id,
          'IMPORT_TARGET_CONFLICT',
          error.message,
        );
      }
      throw error;
    }

    const claimNow = new Date();
    if (job.expiresAt <= claimNow) {
      await ImportJob.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'expired',
            commitError: { code: 'IMPORT_PREVIEW_EXPIRED' },
            commitLeaseUntil: null,
          },
        }
      );
      throw new AppError(
        'Import preview telah kedaluwarsa.',
        410,
        null,
        'IMPORT_PREVIEW_EXPIRED'
      );
    }

    const commitLeaseUntil = new Date(claimNow.getTime() + IMPORT_COMMIT_LEASE_MS);
    const claimedJob = await ImportJob.findOneAndUpdate(
      {
        _id: job._id,
        $or: [
          { status: { $in: ['previewed', 'failed'] } },
          {
            status: 'committing',
            $or: [
              { commitLeaseUntil: { $lte: claimNow } },
              { commitLeaseUntil: null },
              { commitLeaseUntil: { $exists: false } },
            ],
          },
        ],
        expiresAt: { $gt: claimNow },
      },
      {
        $set: {
          status: 'committing',
          commitError: null,
          commitLeaseUntil,
        },
      },
      { returnDocument: 'after' }
    );

    if (!claimedJob) {
      throw new AppError(
        'Import job sedang diproses atau kedaluwarsa.',
        409,
        null,
        'IMPORT_JOB_STATE_CONFLICT'
      );
    }

    let insertedCount = 0;
    let updatedCount = 0;
    let processedRows = 0;

    const saveProgress = async () => {
      await ImportJob.updateOne(
        { _id: claimedJob._id },
        {
          $set: {
            commitLeaseUntil: new Date(Date.now() + IMPORT_COMMIT_LEASE_MS),
            commitProgress: {
              insertedCount,
              updatedCount,
              processedRows,
              totalActionableRows: actionableRows.length,
              updatedAt: new Date(),
            },
          },
        }
      );
    };

    try {
      for (let offset = 0; offset < actionableRows.length; offset += DATABASE_BATCH_SIZE) {
        const chunk = actionableRows.slice(offset, offset + DATABASE_BATCH_SIZE);
        const result = await this.commitChunk(claimedJob.kind, chunk, claimedJob);
        insertedCount += result.insertedCount;
        updatedCount += result.updatedCount;
        processedRows += chunk.length;
        await saveProgress();
      }
    } catch (error) {
      const isConflict = error?.code === 'IMPORT_TARGET_CONFLICT';
      const errorCode = isConflict ? 'IMPORT_TARGET_CONFLICT' : 'IMPORT_COMMIT_INTERRUPTED';
      await ImportJob.updateOne(
        { _id: claimedJob._id },
        {
          $set: {
            status: 'failed',
            commitLeaseUntil: null,
            commitProgress: {
              insertedCount,
              updatedCount,
              processedRows,
              totalActionableRows: actionableRows.length,
              failedCount: 1,
              updatedAt: new Date(),
            },
            commitError: {
              code: errorCode,
              message: error.message,
              occurredAt: new Date(),
            },
          },
        }
      );

      if (isConflict) throw error;
      console.error('[Import] Commit batch failed; the idempotent preview can be retried.', {
        importJobId: claimedJob.jobId,
        error: error.message,
      });
      throw new AppError(
        'Commit import terhenti. Simpanan yang sudah selesai aman dan commit dapat diulang dengan token yang sama.',
        500,
        null,
        'IMPORT_COMMIT_INTERRUPTED'
      );
    }

    const committedAt = new Date();
    const summary = claimedJob.summary || {};
    const commitResult = {
      insertedCount,
      updatedCount,
      unchangedCount: summary.unchangedCount || 0,
      rejectedCount: summary.rejectedCount || 0,
      failedCount: 0,
    };

    try {
      await ImportJob.updateOne(
        { _id: claimedJob._id },
        {
          $set: {
            status: 'committed',
            committedAt,
            commitResult,
            commitLeaseUntil: null,
            commitProgress: {
              insertedCount,
              updatedCount,
              processedRows: actionableRows.length,
              totalActionableRows: actionableRows.length,
              updatedAt: new Date(),
            },
          },
        }
      );
    } catch (error) {
      console.error('[Import] Failed to persist the committed result.', {
        importJobId: claimedJob.jobId,
        error: error.message,
      });
      await ImportJob.updateOne(
        { _id: claimedJob._id },
        {
          $set: {
            status: 'failed',
            commitLeaseUntil: null,
            commitError: {
              code: 'IMPORT_COMMIT_INTERRUPTED',
              message: error.message,
              occurredAt: new Date(),
            },
          },
        }
      ).catch(() => undefined);
      throw new AppError(
        'Commit import terhenti. Simpanan yang sudah selesai aman dan commit dapat diulang dengan token yang sama.',
        500,
        null,
        'IMPORT_COMMIT_INTERRUPTED'
      );
    }

    return {
      importJobId: claimedJob.jobId,
      status: 'committed',
      committedAt: committedAt.toISOString(),
      result: commitResult,
    };
  }

  async assertUnchangedTargets(kind, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const targets = await this.findCurrentTargets(kind, rows);

    for (const record of rows) {
      const current = this.getCurrentTarget(kind, targets, record);
      if (!current) {
        throw new AppError(
          `Target import baris ${record.rowNumber} tidak ditemukan setelah pratinjau.`,
          409,
          null,
          'IMPORT_TARGET_CONFLICT'
        );
      }

      const expectedUpdatedAt = record.expectedUpdatedAt
        ? new Date(record.expectedUpdatedAt)
        : null;
      const currentUpdatedAt = current.updatedAt ? new Date(current.updatedAt) : null;
      const updatedAtMatches =
        (!expectedUpdatedAt && !currentUpdatedAt) ||
        (expectedUpdatedAt &&
          currentUpdatedAt &&
          expectedUpdatedAt.getTime() === currentUpdatedAt.getTime());
      if (
        !updatedAtMatches ||
        !this.expectedFingerprintMatches(
          kind,
          current,
          record.data,
          record.existingFingerprint
        ) ||
        !this.resourceIsSame(kind, current, record.data)
      ) {
        throw new AppError(
          `Target import baris ${record.rowNumber} berubah setelah pratinjau.`,
          409,
          null,
          'IMPORT_TARGET_CONFLICT'
        );
      }
    }
  }

  targetKey(kind, record) {
    if (kind === 'customer') return `customer:${record.data.customerId}`;
    return `transformer:${normalizeNameKey(record.data.name)}`;
  }

  async findCurrentTargets(kind, rows) {
    const targets = new Map();
    if (kind === 'customer') {
      const customerIds = Array.from(
        new Set(rows.map((row) => row.data.customerId).filter(Boolean))
      );
      for (let offset = 0; offset < customerIds.length; offset += DATABASE_BATCH_SIZE) {
        const batch = customerIds.slice(offset, offset + DATABASE_BATCH_SIZE);
        const customers = await Customer.find({ customerId: { $in: batch } }).lean();
        for (const customer of customers) {
          targets.set(`customer:${customer.customerId}`, customer);
        }
      }
      return targets;
    }

    const names = [];
    const nameKeys = new Set();
    for (const row of rows) {
      const name = row.data.name;
      if (typeof name !== 'string' || name.length === 0) continue;
      const nameKey = normalizeNameKey(name);
      if (!nameKey || nameKeys.has(nameKey)) continue;
      nameKeys.add(nameKey);
      names.push(name);
    }
    const objectIds = rows
      .map((row) => row.existingId)
      .filter(Boolean)
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    const clauses = [];
    if (nameKeys.size > 0) clauses.push({ nameKey: { $in: Array.from(nameKeys) } });
    if (names.length > 0) clauses.push({ name: { $in: names } });
    if (objectIds.length > 0) clauses.push({ _id: { $in: objectIds } });
    if (clauses.length === 0) return targets;

    const transformers = await Transformer.find({ $or: clauses })
      .collation(CASE_INSENSITIVE_COLLATION)
      .lean();
    for (const transformer of transformers) {
      const nameKey = normalizeNameKey(transformer.name);
      if (nameKey) targets.set(`transformer:${nameKey}`, transformer);
      targets.set(`transformer-id:${String(transformer._id)}`, transformer);
    }
    return targets;
  }

  getCurrentTarget(kind, targets, record) {
    if (kind === 'customer') return targets.get(this.targetKey(kind, record)) || null;
    return (
      targets.get(`transformer-id:${String(record.existingId)}`) ||
      targets.get(this.targetKey(kind, record)) ||
      null
    );
  }

  expectedFingerprintMatches(kind, current, desired, expectedFingerprint) {
    const actualFingerprint =
      kind === 'customer'
        ? this.customerFingerprint(current, desired)
        : this.transformerFingerprint(current, desired);
    return stableJson(actualFingerprint) === stableJson(expectedFingerprint || {});
  }

  resourceIsSame(kind, current, desired) {
    return kind === 'customer'
      ? this.customerIsSame(current, desired)
      : this.transformerIsSame(current, desired);
  }

  buildCommitFields(kind, record, job) {
    const data = record.data;
    const provenance = {
      source: 'operator_import',
      sourceFile: job.sourceFilename,
      sourceRow: record.rowNumber,
      sourceMetadata: {
        importJobId: job.jobId,
      },
    };
    if (kind === 'customer') {
      const fields = {
        customerId: data.customerId,
        name: data.name,
        ...provenance,
      };
      for (const field of ['tariff', 'powerVa', 'address']) {
        if (Object.prototype.hasOwnProperty.call(data, field)) fields[field] = data[field];
      }
      if (Object.prototype.hasOwnProperty.call(data, 'power')) {
        fields.powerRaw = data.power;
      }
      return fields;
    }

    const fields = {
      name: data.name,
      nameKey: normalizeNameKey(data.name),
      ...provenance,
    };
    for (const field of [
      'feeder',
      'capacity',
      'capacityKva',
      'rawCoordinates',
      'location',
      'brand',
      'grounding',
    ]) {
      if (Object.prototype.hasOwnProperty.call(data, field)) fields[field] = data[field];
    }
    return fields;
  }

  async commitChunk(kind, rows, job) {
    const targets = await this.findCurrentTargets(kind, rows);
    const insertOperations = [];
    const updateOperations = [];
    let alreadyAppliedInsertCount = 0;
    let alreadyAppliedUpdateCount = 0;

    for (const record of rows) {
      const current = this.getCurrentTarget(kind, targets, record);
      const desired = record.data;
      const appliedByThisJob =
        Boolean(current) &&
        String(current.sourceMetadata?.importJobId || '') === String(job.jobId);

      if (record.status === 'insert') {
        if (!current) {
          insertOperations.push({
            insertOne: {
              document: this.buildCommitFields(kind, record, job),
            },
          });
          continue;
        }
        if (appliedByThisJob && this.resourceIsSame(kind, current, desired)) {
          alreadyAppliedInsertCount += 1;
          continue;
        }
        throw new AppError(
          `Target import baris ${record.rowNumber} berubah setelah pratinjau.`,
          409,
          null,
          'IMPORT_TARGET_CONFLICT'
        );
      }

      if (!current) {
        throw new AppError(
          `Target import baris ${record.rowNumber} tidak ditemukan setelah pratinjau.`,
          409,
          null,
          'IMPORT_TARGET_CONFLICT'
        );
      }
      if (appliedByThisJob && this.resourceIsSame(kind, current, desired)) {
        alreadyAppliedUpdateCount += 1;
        continue;
      }

      const expectedUpdatedAt = record.expectedUpdatedAt
        ? new Date(record.expectedUpdatedAt)
        : null;
      const currentUpdatedAt = current.updatedAt ? new Date(current.updatedAt) : null;
      const updatedAtMatches =
        (!expectedUpdatedAt && !currentUpdatedAt) ||
        (expectedUpdatedAt &&
          currentUpdatedAt &&
          expectedUpdatedAt.getTime() === currentUpdatedAt.getTime());
      if (
        !updatedAtMatches ||
        !this.expectedFingerprintMatches(
          kind,
          current,
          desired,
          record.existingFingerprint
        )
      ) {
        throw new AppError(
          `Target import baris ${record.rowNumber} berubah setelah pratinjau.`,
          409,
          null,
          'IMPORT_TARGET_CONFLICT'
        );
      }

      const filter = { _id: current._id };
      if (expectedUpdatedAt) filter.updatedAt = expectedUpdatedAt;
      updateOperations.push({
        updateOne: {
          filter,
          update: { $set: this.buildCommitFields(kind, record, job) },
          upsert: false,
        },
      });
    }

    let insertedCount = alreadyAppliedInsertCount;
    let updatedCount = alreadyAppliedUpdateCount;
    if (insertOperations.length > 0) {
      const result = await this.writeBatch(kind, insertOperations);
      const duplicateWrite = (result.writeErrors || []).some(
        (writeError) => writeError?.code === 11000,
      );
      if (duplicateWrite || result.insertedCount !== insertOperations.length) {
        throw new AppError(
          'Target import berubah ketika commit sedang dijalankan.',
          409,
          null,
          'IMPORT_TARGET_CONFLICT'
        );
      }
      insertedCount += result.insertedCount;
    }
    if (updateOperations.length > 0) {
      const result = await this.writeBatch(kind, updateOperations);
      if (result.matchedCount !== updateOperations.length) {
        throw new AppError(
          'Target import berubah ketika commit sedang dijalankan.',
          409,
          null,
          'IMPORT_TARGET_CONFLICT'
        );
      }
      updatedCount += result.matchedCount;
    }

    return { insertedCount, updatedCount };
  }

  async writeBatch(kind, operations) {
    const model = kind === 'customer' ? Customer : Transformer;
    try {
      return await model.bulkWrite(operations, {
        ordered: false,
        runValidators: true,
      });
    } catch (error) {
      if (
        error?.code === 11000 ||
        (error?.writeErrors || []).some((writeError) => writeError?.code === 11000)
      ) {
        throw new AppError(
          'Target import berubah ketika commit sedang dijalankan.',
          409,
          null,
          'IMPORT_TARGET_CONFLICT'
        );
      }
      throw error;
    }
  }
}

module.exports = new ImportService();
