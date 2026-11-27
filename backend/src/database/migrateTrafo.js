const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';
const { connectDatabase, disconnectDatabase } = require('./connection');
const Transformer = require('../modules/transformers/transformerModel');
const { parseCapacityKva: parseCapacityKvaValue } = require('../shared/utils/capacityParser');
const { normalizeDisplayName, normalizeNameKey } = require('../shared/utils/nameKey');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_SOURCE = path.join(
  PROJECT_ROOT,
  '.temp',
  'sigap',
  'Manajemen Trafo (SupaBase).csv'
);
const EXPECTED_SCHEMA = ['nama_trafo', 'penyulang', 'kapasitas', 'titik_koordinat'];
const EXPECTED_CANONICAL_ROWS = 1238;
const STRICT_POINT_PATTERN = /^POINT\s*\(\s*([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*\)$/i;
const CANONICAL_COORDINATE_BOUNDS = Object.freeze({
  minLongitude: 98.63159,
  maxLongitude: 98.731016,
  minLatitude: 3.639622,
  maxLatitude: 3.735425,
});

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
    migration: 'transformers',
    status: 'pending',
    mode: options.apply ? 'apply' : 'dry-run',
    source: sourcePath,
    sourceHash: null,
    sourceHashAlgorithm: 'sha256',
    encoding: null,
    bom: false,
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

function parseStrictPoint(rawCoordinate) {
  if (typeof rawCoordinate !== 'string') return null;
  const match = rawCoordinate.trim().match(STRICT_POINT_PATTERN);
  if (!match) return null;

  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (
    longitude < CANONICAL_COORDINATE_BOUNDS.minLongitude ||
    longitude > CANONICAL_COORDINATE_BOUNDS.maxLongitude ||
    latitude < CANONICAL_COORDINATE_BOUNDS.minLatitude ||
    latitude > CANONICAL_COORDINATE_BOUNDS.maxLatitude
  ) {
    return null;
  }

  return {
    longitude,
    latitude,
    coordinates: [longitude, latitude],
  };
}

function parseCapacityKva(capacity) {
  return parseCapacityKvaValue(capacity).value;
}

function parseTransformerSource(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    throw new MigrationFailure(`Ground truth file not found: ${sourcePath}`);
  }

  const buffer = fs.readFileSync(sourcePath);
  const sourceHash = sha256(buffer);
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;

  let text;
  try {
    text = decodeUtf8Strict(buffer);
  } catch (error) {
    throw new MigrationFailure(`Transformer CSV is not valid UTF-8: ${error.message}`);
  }

  let matrix;
  try {
    matrix = parse(text, {
      bom: true,
      delimiter: ';',
      skip_empty_lines: true,
      relax_column_count: false,
      relax_column_count_less: false,
      relax_column_count_more: false,
    });
  } catch (error) {
    throw new MigrationFailure(`Transformer CSV parse failed: ${error.message}`);
  }

  if (!matrix.length) throw new MigrationFailure('Transformer CSV is empty');
  const header = matrix[0].map((value) => String(value));
  if (header.length !== EXPECTED_SCHEMA.length || header.some((value, index) => value !== EXPECTED_SCHEMA[index])) {
    throw new MigrationFailure(
      `Transformer CSV schema mismatch. Expected ${EXPECTED_SCHEMA.join(';')}, received ${header.join(';')}`
    );
  }

  const rows = matrix.slice(1);
  const isCanonicalSource = path.resolve(sourcePath) === path.resolve(DEFAULT_SOURCE);
  if (isCanonicalSource && rows.length !== EXPECTED_CANONICAL_ROWS) {
    throw new MigrationFailure(
      `Transformer CSV row count mismatch. Expected ${EXPECTED_CANONICAL_ROWS}, received ${rows.length}`
    );
  }

  const nameCounts = new Map();
  for (const row of rows) {
    const name = normalizeDisplayName(row[0]);
    const key = normalizeNameKey(name);
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  const records = [];
  const invalid = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = normalizeDisplayName(row[0]);
    const feederValue = String(row[1] || '').trim();
    const capacityValue = String(row[2] || '').trim();
    const feeder = feederValue || null;
    const capacity = capacityValue || null;
    const rawCoordinates = String(row[3] || '').trim();
    const point = parseStrictPoint(rawCoordinates);

    if (!name) {
      invalid.push({
        type: 'missing_name',
        row: rowNumber,
        value: name,
        expected: 'non-empty nama_trafo',
      });
      return;
    }
    if (nameCounts.get(normalizeNameKey(name)) > 1) {
      invalid.push({
        type: 'duplicate_name',
        row: rowNumber,
        value: name,
        expected: 'case-insensitively unique nama_trafo',
      });
      return;
    }
    if (!point) {
      invalid.push({
        type: 'invalid_wkt_point',
        row: rowNumber,
        name,
        value: rawCoordinates,
        expected: 'POINT (longitude latitude) within the audited ULP Labuhan coordinate envelope',
      });
      return;
    }

    records.push({
      name,
      nameKey: normalizeNameKey(name),
      feeder,
      capacity,
      capacityKva: parseCapacityKva(capacity),
      rawCoordinates,
      location: {
        type: 'Point',
        coordinates: point.coordinates,
      },
    });
  });

  return {
    sourceHash,
    encoding: 'utf-8',
    bom,
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

/**
 * Indexes the existing transformer volume by its canonical identity key.
 * Legacy documents that still miss a nameKey are matched by the same rule,
 * because the key is always derived from the stored display name.
 */
async function buildExistingTransformerIndex(model) {
  const documents = await executeQuery(model.find({}).select({ name: 1, nameKey: 1 }));
  const byKey = new Map();
  const duplicates = [];

  for (const document of documents) {
    const plain = toPlainObject(document);
    if (!plain) continue;
    const nameKey = normalizeNameKey(plain.name);
    if (!nameKey) continue;

    const existing = byKey.get(nameKey);
    if (existing) {
      duplicates.push({
        nameKey,
        existing: { id: String(existing._id), name: existing.name },
        duplicate: { id: String(plain._id), name: plain.name },
      });
      continue;
    }
    byKey.set(nameKey, plain);
  }

  return { byKey, duplicates };
}

function sameCoordinates(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => Number(value) === Number(right[index]));
}

function transformerNeedsUpdate(existing, desired) {
  if (!existing) return true;
  if (String(existing.name || '').trim() !== desired.name) return true;
  if (normalizeNameKey(existing.name) !== desired.nameKey) return true;
  if (String(existing.nameKey || '') !== desired.nameKey) return true;
  const existingFeeder = existing.feeder === null || existing.feeder === undefined
    ? null
    : String(existing.feeder).trim() || null;
  const existingCapacityText = existing.capacity === null || existing.capacity === undefined
    ? null
    : String(existing.capacity).trim() || null;
  if (existingFeeder !== desired.feeder) return true;
  if (existingCapacityText !== desired.capacity) return true;

  const existingCapacityKva = existing.capacityKva === undefined ? null : existing.capacityKva;
  if (existingCapacityKva !== desired.capacityKva) return true;
  if (String(existing.rawCoordinates || '') !== desired.rawCoordinates) return true;

  const existingCoordinates = existing.location && existing.location.coordinates;
  return !sameCoordinates(existingCoordinates, desired.location.coordinates);
}

async function buildTransformerPlan(records, model) {
  const inserts = [];
  const updates = [];
  let skipped = 0;
  const { byKey, duplicates } = await buildExistingTransformerIndex(model);

  if (duplicates.length > 0) {
    // Ambiguous identity: the plan stays empty so no caller can write while
    // duplicate canonical keys are unresolved.
    return { inserts, updates, skipped, duplicates };
  }

  for (const record of records) {
    const existing = byKey.get(record.nameKey);
    if (!existing) {
      inserts.push({
        filter: { nameKey: record.nameKey },
        document: record,
      });
      continue;
    }

    if (!transformerNeedsUpdate(existing, record)) {
      skipped += 1;
      continue;
    }

    updates.push({
      filter: existing._id ? { _id: existing._id } : { nameKey: record.nameKey },
      document: record,
    });
  }

  return { inserts, updates, skipped, duplicates };
}

async function applyTransformerPlan(plan, model) {
  let inserted = 0;
  let updated = 0;

  for (const operation of plan.inserts) {
    await model.updateOne(
      operation.filter,
      { $set: operation.document },
      { upsert: true, runValidators: false }
    );
    inserted += 1;
  }
  for (const operation of plan.updates) {
    await model.updateOne(
      operation.filter,
      { $set: operation.document },
      { upsert: false, runValidators: false }
    );
    updated += 1;
  }

  return { inserted, updated };
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
    'Usage: node backend/src/database/migrateTrafo.js [options]',
    '',
    'Options:',
    '  --source <path>  Transformer CSV (default: canonical .temp/sigap file)',
    '  --limit <count>  Process at most this many valid source rows',
    '  --report <path>  Write the JSON report atomically',
    '  --apply          Write to MongoDB (default: dry-run)',
    '  --dry-run        Explicitly select dry-run mode',
  ].join('\n');
}

async function migrateTrafo(options = {}) {
  const normalizedOptions = {
    apply: options.apply === true,
    source: resolveSourcePath(options.source),
    limit: options.limit === undefined ? null : parseLimit(options.limit),
    report: options.report ? path.resolve(process.cwd(), options.report) : null,
  };
  const sourcePath = normalizedOptions.source;
  const report = createReport(normalizedOptions, sourcePath);

  try {
    assertSafeReportPath(normalizedOptions.report, sourcePath);
    const parsed = parseTransformerSource(sourcePath);
    report.sourceHash = parsed.sourceHash;
    report.encoding = parsed.encoding;
    report.bom = parsed.bom;
    report.total = parsed.total;
    report.invalid = parsed.invalid.length;
    report.mismatches.push(...parsed.invalid);

    if (parsed.invalid.length > 0) {
      report.fatal = true;
      report.errors.push({
        type: 'invalid_transformer_records',
        message: `${parsed.invalid.length} transformer record(s) failed strict validation`,
        count: parsed.invalid.length,
      });
      throw new MigrationFailure('Transformer source contains invalid records', report);
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
      const plan = await buildTransformerPlan(selectedRecords, Transformer);
      if (plan.duplicates.length > 0) {
        // The canonical identity key must be unique. Duplicate legacy records
        // are reported as-is: the migration never merges or deletes them.
        for (const duplicate of plan.duplicates) {
          report.mismatches.push({ type: 'duplicate_name_key_in_database', ...duplicate });
        }
        report.fatal = true;
        report.errors.push({
          type: 'duplicate_canonical_name_keys',
          message:
            `The existing transformer volume contains ${plan.duplicates.length} duplicate canonical ` +
            'name key(s). No record was merged or deleted.',
          count: plan.duplicates.length,
        });
        throw new MigrationFailure(
          'Existing transformer volume contains duplicate canonical name keys',
          report,
        );
      }
      const result = await applyTransformerPlan(plan, Transformer);
      report.inserted = result.inserted;
      report.updated = result.updated;
      report.skipped = plan.skipped;
      report.planned.inserted = result.inserted;
      report.planned.updated = result.updated;
      report.planned.skipped = plan.skipped;
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
      const report = await migrateTrafo(options);
      writeJsonReport(options.report, report);
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      const report = error instanceof MigrationFailure && error.report
        ? error.report
        : {
            migration: 'transformers',
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

module.exports = migrateTrafo;
module.exports.MigrationFailure = MigrationFailure;
module.exports.applyTransformerPlan = applyTransformerPlan;
module.exports.assertSafeReportPath = assertSafeReportPath;
module.exports.buildExistingTransformerIndex = buildExistingTransformerIndex;
module.exports.buildTransformerPlan = buildTransformerPlan;
module.exports.createReport = createReport;
module.exports.parseCapacityKva = parseCapacityKva;
module.exports.parseCliOptions = parseCliOptions;
module.exports.parseStrictPoint = parseStrictPoint;
module.exports.parseTransformerSource = parseTransformerSource;
module.exports.writeJsonReport = writeJsonReport;
