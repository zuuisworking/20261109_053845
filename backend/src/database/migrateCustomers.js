const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const iconv = require('iconv-lite');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';
const { connectDatabase, disconnectDatabase } = require('./connection');
const Customer = require('../modules/customers/customerModel');
const { verifyCustomerSources } = require('./customerSourceVerifier');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_SOURCE = path.join(
  PROJECT_ROOT,
  '.temp',
  'sigap',
  'Data Pelanggan (SupaBase).csv'
);
const DEFAULT_XLSX_SOURCE = path.join(
  PROJECT_ROOT,
  '.temp',
  'sigap',
  'Data Pelanggan.xlsx'
);
const EXPECTED_SCHEMA = ['id_pelanggan', 'nama', 'tarif', 'daya', 'alamat'];
const EXPECTED_CANONICAL_ROWS = 68742;
const CUSTOMER_ID_PATTERN = /^\d{12}$/;
const POWER_PATTERN = /^\d+(?:\.\d{3})*$/;
const BATCH_SIZE = 1000;

class MigrationFailure extends Error {
  constructor(message, report = null, details = []) {
    super(message);
    this.name = 'MigrationFailure';
    this.report = report;
    this.details = details;
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function decodeUtf8Strict(buffer) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = decoder.decode(buffer);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function decodeCustomerSource(buffer) {
  try {
    return { text: decodeUtf8Strict(buffer), encoding: 'utf-8' };
  } catch (_utf8Error) {
    try {
      return { text: iconv.decode(buffer, 'cp1252'), encoding: 'cp1252' };
    } catch (cp1252Error) {
      throw new MigrationFailure(
        `Customer CSV is neither valid UTF-8 nor decodable as CP1252: ${cp1252Error.message}`
      );
    }
  }
}

function resolveSourcePath(source) {
  if (!source) return DEFAULT_SOURCE;
  return path.resolve(process.cwd(), source);
}

function isPathInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafeReportPath(reportPath, sourcePath = null) {
  if (!reportPath) return;
  const resolved = path.resolve(process.cwd(), reportPath);
  const protectedTemp = path.join(PROJECT_ROOT, '.temp');
  if (isPathInside(resolved, protectedTemp)) {
    throw new MigrationFailure(`Report path is inside protected .temp directory: ${resolved}`);
  }
  if (sourcePath && path.resolve(resolved) === path.resolve(sourcePath)) {
    throw new MigrationFailure(`Report path must not overwrite the source file: ${resolved}`);
  }
}

function parseLimit(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) throw new MigrationFailure(`Invalid --limit value: ${value}`);
  const limit = Number(text);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new MigrationFailure(`Invalid --limit value: ${value}`);
  }
  return limit;
}

function parseCliOptions(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
    source: DEFAULT_SOURCE,
    xlsxSource: DEFAULT_XLSX_SOURCE,
    limit: null,
    report: null,
    help: false,
  };
  let sawApply = false;
  let sawDryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = (name) => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new MigrationFailure(`${name} requires a path or value`);
      }
      index += 1;
      return value;
    };

    if (argument === '--apply') {
      sawApply = true;
    } else if (argument === '--dry-run') {
      sawDryRun = true;
    } else if (argument === '--source') {
      options.source = resolveSourcePath(readValue('--source'));
    } else if (argument.startsWith('--source=')) {
      options.source = resolveSourcePath(argument.slice('--source='.length));
    } else if (argument === '--xlsx-source') {
      options.xlsxSource = resolveSourcePath(readValue('--xlsx-source'));
    } else if (argument.startsWith('--xlsx-source=')) {
      options.xlsxSource = resolveSourcePath(argument.slice('--xlsx-source='.length));
    } else if (argument === '--limit') {
      options.limit = parseLimit(readValue('--limit'));
    } else if (argument.startsWith('--limit=')) {
      options.limit = parseLimit(argument.slice('--limit='.length));
    } else if (argument === '--report') {
      options.report = path.resolve(process.cwd(), readValue('--report'));
    } else if (argument.startsWith('--report=')) {
      options.report = path.resolve(process.cwd(), argument.slice('--report='.length));
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (/^\d+$/.test(argument)) {
      options.limit = parseLimit(argument);
    } else {
      throw new MigrationFailure(`Unknown argument: ${argument}`);
    }
  }

  if (sawApply && sawDryRun) {
    throw new MigrationFailure('--apply and --dry-run cannot be used together');
  }
  options.apply = sawApply;
  return options;
}

function createReport(options, sourcePath) {
  return {
    migration: 'customers',
    status: 'pending',
    mode: options.apply ? 'apply' : 'dry-run',
    source: sourcePath,
    sourceHash: null,
    sourceHashAlgorithm: 'sha256',
    encoding: null,
    sourceVerification: null,
    expectedSchema: EXPECTED_SCHEMA,
    total: 0,
    read: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    invalid: 0,
    planned: {
      upserts: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
    },
    database: {
      connected: false,
      writesPerformed: false,
    },
    mismatches: [],
    errors: [],
    fatal: false,
  };
}

function parseIndonesianPower(powerText) {
  if (typeof powerText !== 'string' || !POWER_PATTERN.test(powerText)) return null;
  const va = Number(powerText.replace(/\./g, ''));
  if (!Number.isSafeInteger(va) || va < 0) return null;
  return va;
}

function parseCustomerSource(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    throw new MigrationFailure(`Ground truth file not found: ${sourcePath}`);
  }

  const buffer = fs.readFileSync(sourcePath);
  const sourceHash = sha256(buffer);
  const decoded = decodeCustomerSource(buffer);

  let matrix;
  try {
    matrix = parse(decoded.text, {
      bom: true,
      delimiter: ';',
      skip_empty_lines: true,
      relax_column_count: false,
      relax_column_count_less: false,
      relax_column_count_more: false,
    });
  } catch (error) {
    throw new MigrationFailure(`Customer CSV parse failed: ${error.message}`);
  }

  if (!matrix.length) throw new MigrationFailure('Customer CSV is empty');
  const header = matrix[0].map((value) => String(value));
  if (header.length !== EXPECTED_SCHEMA.length || header.some((value, index) => value !== EXPECTED_SCHEMA[index])) {
    throw new MigrationFailure(
      `Customer CSV schema mismatch. Expected ${EXPECTED_SCHEMA.join(';')}, received ${header.join(';')}`
    );
  }

  const rows = matrix.slice(1);
  const isCanonicalSource = path.resolve(sourcePath) === path.resolve(DEFAULT_SOURCE);
  if (isCanonicalSource && rows.length !== EXPECTED_CANONICAL_ROWS) {
    throw new MigrationFailure(
      `Customer CSV row count mismatch. Expected ${EXPECTED_CANONICAL_ROWS}, received ${rows.length}`
    );
  }

  const idRows = new Map();
  rows.forEach((row, index) => {
    const id = String(row[0] || '');
    if (!idRows.has(id)) idRows.set(id, []);
    idRows.get(id).push(index + 2);
  });

  const records = [];
  const invalid = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const customerId = String(row[0] || '');
    const name = String(row[1] || '').trim();
    const tariffValue = String(row[2] || '').trim();
    const tariff = tariffValue || null;
    const powerValue = String(row[3] || '').trim();
    const power = powerValue || null;
    const addressValue = String(row[4] || '').trim();
    const address = addressValue || null;
    let valid = true;

    if (!CUSTOMER_ID_PATTERN.test(customerId)) {
      valid = false;
      invalid.push({
        type: 'malformed_customer_id',
        row: rowNumber,
        value: customerId,
        expected: 'exactly 12 digits stored as a string',
      });
    } else if (idRows.get(customerId).length > 1) {
      valid = false;
      invalid.push({
        type: 'duplicate_customer_id',
        row: rowNumber,
        value: customerId,
        rows: idRows.get(customerId),
        expected: 'unique customer ID',
      });
    }

    if (!name) {
      valid = false;
      invalid.push({
        type: 'missing_customer_name',
        row: rowNumber,
        customerId,
        expected: 'non-empty nama',
      });
    }

    const powerVa = power === null ? null : parseIndonesianPower(power);
    if (power !== null && powerVa === null) {
      valid = false;
      invalid.push({
        type: 'invalid_power',
        row: rowNumber,
        customerId,
        value: power,
        expected: 'digits with optional Indonesian thousands groups, for example 900 or 1.300',
      });
    }

    if (!valid) return;

    records.push({
      customerId,
      name,
      tariff,
      power,
      powerVa,
      address,
    });
  });

  return {
    sourceHash,
    encoding: decoded.encoding,
    total: rows.length,
    records,
    invalid,
    isCanonicalSource,
  };
}

function toPlainObject(document) {
  if (!document) return null;
  if (typeof document.toObject === 'function') return document.toObject();
  return document;
}

async function executeQuery(query) {
  if (query && typeof query.lean === 'function') query = query.lean();
  if (query && typeof query.exec === 'function') return query.exec();
  return query;
}

async function findExistingCustomers(model, customerIds) {
  if (!customerIds.length) return [];
  const query = model.find({ customerId: { $in: customerIds } });
  const documents = await executeQuery(query);
  if (!Array.isArray(documents)) return [];
  return documents.map(toPlainObject).filter(Boolean);
}

function customerNeedsUpdate(existing, desired) {
  if (!existing) return true;
  if (String(existing.customerId || '') !== desired.customerId) return true;
  if (String(existing.name || '') !== desired.name) return true;
  const existingTariff = existing.tariff === null || existing.tariff === undefined
    ? null
    : String(existing.tariff).trim() || null;
  const existingPowerRaw = existing.powerRaw === null || existing.powerRaw === undefined
    ? null
    : String(existing.powerRaw).trim() || null;
  const existingAddress = existing.address === null || existing.address === undefined
    ? null
    : String(existing.address).trim() || null;
  if (existingTariff !== desired.tariff) return true;
  if (existingPowerRaw !== desired.power) return true;
  const existingPowerVa =
    existing.powerVa === null || existing.powerVa === undefined || existing.powerVa === ''
      ? null
      : Number(existing.powerVa);
  if (existingPowerVa !== desired.powerVa) return true;
  if (existingAddress !== desired.address) return true;
  return false;
}

function buildCustomerOperations(records, existingDocuments) {
  const existingById = new Map(
    existingDocuments.map((document) => [String(document.customerId || ''), document])
  );
  const inserts = [];
  const updates = [];
  let skipped = 0;

  for (const record of records) {
    const existing = existingById.get(record.customerId);
    if (!existing) {
      inserts.push({
        filter: { customerId: record.customerId },
        document: record,
      });
      continue;
    }
    if (!customerNeedsUpdate(existing, record)) {
      skipped += 1;
      continue;
    }
    updates.push({
      filter: existing._id ? { _id: existing._id } : { customerId: existing.customerId },
      document: record,
    });
  }

  return { inserts, updates, skipped };
}

async function applyCustomerBatch(records, model) {
  const customerIds = records.map((record) => record.customerId);
  const existingDocuments = await findExistingCustomers(model, customerIds);
  const plan = buildCustomerOperations(records, existingDocuments);
  const operations = [];

  for (const operation of plan.inserts) {
    operations.push({
      updateOne: {
        filter: operation.filter,
        update: { $set: operation.document },
        upsert: true,
      },
    });
  }
  for (const operation of plan.updates) {
    operations.push({
      updateOne: {
        filter: operation.filter,
        update: { $set: operation.document },
        upsert: false,
      },
    });
  }

  let inserted = plan.inserts.length;
  if (operations.length > 0) {
    const result = await model.bulkWrite(operations, { ordered: false });
    if (result && Number.isInteger(result.upsertedCount)) inserted = result.upsertedCount;
  }

  return {
    inserted,
    updated: plan.updates.length,
    skipped: plan.skipped,
  };
}

function writeJsonReport(reportPath, report) {
  if (!reportPath) return;
  assertSafeReportPath(reportPath);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(reportPath),
    `.${path.basename(reportPath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, reportPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function helpText() {
  return [
    'Usage: node backend/src/database/migrateCustomers.js [options]',
    '',
    'Options:',
    '  --source <path>  Customer CSV (default: canonical .temp/sigap file)',
    '  --xlsx-source <path>  Customer XLSX used for equivalence verification',
    '  --limit <count>  Process at most this many valid source rows (dry-run only)',
    '  --report <path>  Write the JSON report atomically',
    '  --apply          Write to MongoDB (default: dry-run)',
    '  --dry-run        Explicitly select dry-run mode',
  ].join('\n');
}

async function migrateCustomers(options = {}) {
  const normalizedOptions = {
    apply: options.apply === true,
    source: resolveSourcePath(options.source),
    xlsxSource: resolveSourcePath(options.xlsxSource || DEFAULT_XLSX_SOURCE),
    limit: options.limit === undefined ? null : parseLimit(options.limit),
    report: options.report ? path.resolve(process.cwd(), options.report) : null,
  };
  const sourcePath = normalizedOptions.source;
  const report = createReport(normalizedOptions, sourcePath);

  try {
    assertSafeReportPath(normalizedOptions.report, sourcePath);
    if (normalizedOptions.apply && normalizedOptions.limit) {
      throw new MigrationFailure(
        'Penerapan pelanggan dengan --limit tidak diizinkan; gunakan dry-run untuk rehearsals.',
        report
      );
    }

    const parsed = parseCustomerSource(sourcePath);
    report.sourceHash = parsed.sourceHash;
    report.encoding = parsed.encoding;
    report.total = parsed.total;
    report.invalid = parsed.invalid.length;
    report.mismatches.push(...parsed.invalid);

    if (parsed.invalid.length > 0) {
      report.fatal = true;
      report.errors.push({
        type: 'invalid_customer_records',
        message: `${parsed.invalid.length} customer record(s) failed ID, uniqueness, or power validation`,
        count: parsed.invalid.length,
      });
      throw new MigrationFailure('Customer source contains invalid records', report);
    }

    const xlsxPath = normalizedOptions.xlsxSource;
    if (fs.existsSync(xlsxPath)) {
      const verification = await verifyCustomerSources(sourcePath, xlsxPath);
      report.sourceVerification = verification;
      if (!verification.valid) {
        report.fatal = true;
        report.errors.push({
          type: 'source_equivalence_mismatch',
          message: `${verification.mismatchCount} perbedaan CSV/XLSX harus ditinjau`,
          count: verification.mismatchCount,
        });
        throw new MigrationFailure(
          'Customer CSV and XLSX sources do not reconcile.',
          report
        );
      }
    } else if (path.resolve(sourcePath) === path.resolve(DEFAULT_SOURCE)) {
      throw new MigrationFailure(
        `Canonical customer XLSX source not found: ${xlsxPath}`,
        report
      );
    } else {
      report.sourceVerification = {
        valid: null,
        status: 'not-provided',
        mismatchCount: 0,
        mismatches: [],
      };
    }

    const selectedRecords = normalizedOptions.limit
      ? parsed.records.slice(0, normalizedOptions.limit)
      : parsed.records;
    report.read = selectedRecords.length;
    report.planned.upserts = selectedRecords.length;
    report.planned.inserted = selectedRecords.length;

    if (!normalizedOptions.apply) {
      report.status = 'dry-run-complete';
      return report;
    }

    await connectDatabase();
    report.database.connected = true;
    try {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      for (let offset = 0; offset < selectedRecords.length; offset += BATCH_SIZE) {
        const batch = selectedRecords.slice(offset, offset + BATCH_SIZE);
        const result = await applyCustomerBatch(batch, Customer);
        inserted += result.inserted;
        updated += result.updated;
        skipped += result.skipped;
      }
      report.inserted = inserted;
      report.updated = updated;
      report.skipped = skipped;
      report.planned.inserted = inserted;
      report.planned.updated = updated;
      report.planned.skipped = skipped;
      report.database.writesPerformed = true;
      report.status = 'complete';
    } finally {
      await disconnectDatabase();
      report.database.connected = false;
    }

    return report;
  } catch (error) {
    if (error instanceof MigrationFailure && error.report) {
      if (!error.report.errors.length && error.message) {
        error.report.errors.push({ type: 'migration_failure', message: error.message });
      }
      error.report.fatal = true;
      error.report.status = 'failed';
      throw error;
    }
    report.fatal = true;
    report.status = 'failed';
    report.errors.push({
      type: error.name || 'error',
      message: error.message || String(error),
    });
    throw new MigrationFailure(error.message || String(error), report);
  }
}

if (require.main === module) {
  void (async () => {
    let options;
    try {
      options = parseCliOptions();
      if (options.help) {
        console.log(helpText());
        process.exit(0);
      }
      const report = await migrateCustomers(options);
      writeJsonReport(options.report, report);
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      const report = error instanceof MigrationFailure && error.report
        ? error.report
        : {
            migration: 'customers',
            status: 'failed',
            mode: options && options.apply ? 'apply' : 'dry-run',
            fatal: true,
            errors: [{ type: error.name || 'error', message: error.message || String(error) }],
          };
      if (options && options.report) {
        try {
          writeJsonReport(options.report, report);
        } catch (reportError) {
          report.errors.push({
            type: 'report_write_failed',
            message: reportError.message || String(reportError),
          });
        }
      }
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = 1;
    }
  })();
}

module.exports = migrateCustomers;
module.exports.MigrationFailure = MigrationFailure;
module.exports.assertSafeReportPath = assertSafeReportPath;
module.exports.createReport = createReport;
module.exports.parseCliOptions = parseCliOptions;
module.exports.parseCustomerSource = parseCustomerSource;
module.exports.parseIndonesianPower = parseIndonesianPower;
module.exports.writeJsonReport = writeJsonReport;
