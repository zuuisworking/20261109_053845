const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';
const migrateTrafo = require('./migrateTrafo');
const migrateCustomers = require('./migrateCustomers');
const migrateMeasurements = require('./migrateMeasurements');
const migrateTransformerNameKeys = require('./migrateTransformerNameKeys');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_SOURCE_DIR = path.join(PROJECT_ROOT, '.temp', 'sigap');
const DEFAULT_TRANSFORMER_SOURCE = path.join(DEFAULT_SOURCE_DIR, 'Manajemen Trafo (SupaBase).csv');
const DEFAULT_CUSTOMER_SOURCE = path.join(DEFAULT_SOURCE_DIR, 'Data Pelanggan (SupaBase).csv');
const DEFAULT_MEASUREMENT_SOURCE = path.join(DEFAULT_SOURCE_DIR, 'SIGAP ULP LABUHAN.html');

class MigrationFailure extends Error {
  constructor(message, report = null, details = []) {
    super(message);
    this.name = 'MigrationFailure';
    this.report = report;
    this.details = details;
  }
}

function isPathInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafeReportPath(reportPath) {
  if (!reportPath) return;
  const resolved = path.resolve(process.cwd(), reportPath);
  const protectedTemp = path.join(PROJECT_ROOT, '.temp');
  if (isPathInside(resolved, protectedTemp)) {
    throw new MigrationFailure(`Report path is inside protected .temp directory: ${resolved}`);
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
    sourceDirectory: null,
    transformerSource: DEFAULT_TRANSFORMER_SOURCE,
    customerSource: DEFAULT_CUSTOMER_SOURCE,
    measurementSource: DEFAULT_MEASUREMENT_SOURCE,
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
      options.sourceDirectory = path.resolve(process.cwd(), readValue('--source'));
    } else if (argument.startsWith('--source=')) {
      options.sourceDirectory = path.resolve(process.cwd(), argument.slice('--source='.length));
    } else if (argument === '--transformer-source') {
      options.transformerSource = path.resolve(process.cwd(), readValue('--transformer-source'));
    } else if (argument.startsWith('--transformer-source=')) {
      options.transformerSource = path.resolve(
        process.cwd(),
        argument.slice('--transformer-source='.length)
      );
    } else if (argument === '--customer-source') {
      options.customerSource = path.resolve(process.cwd(), readValue('--customer-source'));
    } else if (argument.startsWith('--customer-source=')) {
      options.customerSource = path.resolve(
        process.cwd(),
        argument.slice('--customer-source='.length)
      );
    } else if (argument === '--measurement-source') {
      options.measurementSource = path.resolve(process.cwd(), readValue('--measurement-source'));
    } else if (argument.startsWith('--measurement-source=')) {
      options.measurementSource = path.resolve(
        process.cwd(),
        argument.slice('--measurement-source='.length)
      );
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

  if (options.sourceDirectory) {
    const genericSource = options.sourceDirectory;
    if (!fs.existsSync(genericSource)) {
      throw new MigrationFailure(`Source path not found: ${genericSource}`);
    }
    const stat = fs.statSync(genericSource);
    if (stat.isDirectory()) {
      options.transformerSource = path.join(genericSource, path.basename(DEFAULT_TRANSFORMER_SOURCE));
      options.customerSource = path.join(genericSource, path.basename(DEFAULT_CUSTOMER_SOURCE));
      options.measurementSource = path.join(genericSource, path.basename(DEFAULT_MEASUREMENT_SOURCE));
    } else {
      const sourceDirectory = path.dirname(genericSource);
      options.transformerSource = path.join(sourceDirectory, path.basename(DEFAULT_TRANSFORMER_SOURCE));
      options.customerSource = path.join(sourceDirectory, path.basename(DEFAULT_CUSTOMER_SOURCE));
      options.measurementSource = path.join(sourceDirectory, path.basename(DEFAULT_MEASUREMENT_SOURCE));
      const filename = path.basename(genericSource);
      if (filename === path.basename(DEFAULT_TRANSFORMER_SOURCE)) {
        options.transformerSource = genericSource;
      } else if (filename === path.basename(DEFAULT_CUSTOMER_SOURCE)) {
        options.customerSource = genericSource;
      } else if (filename === path.basename(DEFAULT_MEASUREMENT_SOURCE)) {
        options.measurementSource = genericSource;
      }
    }
  }

  return options;
}

function createReport(options) {
  return {
    migration: 'all',
    status: 'pending',
    mode: options.apply ? 'apply' : 'dry-run',
    source: null,
    sourceHash: null,
    sourceHashAlgorithm: 'sha256',
    sources: {
      transformers: {
        path: options.transformerSource,
        hash: null,
      },
      customers: {
        path: options.customerSource,
        hash: null,
      },
      measurements: {
        path: options.measurementSource,
        hash: null,
        transformerSource: options.transformerSource,
        transformerHash: null,
      },
    },
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
    stages: {},
    mismatches: [],
    errors: [],
    fatal: false,
  };
}

function aggregateSourceHash(sources) {
  const material = [
    `transformers:${sources.transformers.hash || ''}`,
    `customers:${sources.customers.hash || ''}`,
    `measurements:${sources.measurements.hash || ''}`,
    `measurement-transformers:${sources.measurements.transformerHash || ''}`,
  ].join('\n');
  return crypto.createHash('sha256').update(material).digest('hex');
}

function combineReports(report, stageReports) {
  report.stages = stageReports;
  for (const [stage, stageReport] of Object.entries(stageReports)) {
    if (!stageReport) continue;
    report.total += Number(stageReport.total || 0);
    report.read += Number(stageReport.read || 0);
    report.inserted += Number(stageReport.inserted || 0);
    report.updated += Number(stageReport.updated || 0);
    report.skipped += Number(stageReport.skipped || 0);
    report.invalid += Number(stageReport.invalid || 0);
    if (stageReport.planned) {
      report.planned.upserts += Number(stageReport.planned.upserts || 0);
      report.planned.inserted += Number(stageReport.planned.inserted || 0);
      report.planned.updated += Number(stageReport.planned.updated || 0);
      report.planned.skipped += Number(stageReport.planned.skipped || 0);
    }
    for (const mismatch of stageReport.mismatches || []) {
      report.mismatches.push({ stage, ...mismatch });
    }
    for (const error of stageReport.errors || []) {
      report.errors.push({ stage, ...error });
    }
    if (stageReport.database && stageReport.database.writesPerformed) {
      report.database.writesPerformed = true;
    }
  }
  report.sourceHash = aggregateSourceHash(report.sources);
  return report;
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
    'Usage: node backend/src/database/migrateAll.js [options]',
    '',
    'Options:',
    '  --source <path>              Common source directory for all canonical files',
    '  --transformer-source <path>  Transformer CSV override',
    '  --customer-source <path>     Customer CSV override',
    '  --measurement-source <path>  Measurement HTML override',
    '  --limit <count>              Per-stage record limit',
    '  --report <path>              Write the combined JSON report atomically',
    '  --apply                      Write to MongoDB (default: dry-run)',
    '  --dry-run                    Explicitly select dry-run mode',
  ].join('\n');
}

async function migrateAll(options = {}) {
  const normalizedOptions = {
    apply: options.apply === true,
    transformerSource: path.resolve(
      process.cwd(),
      options.transformerSource || DEFAULT_TRANSFORMER_SOURCE
    ),
    customerSource: path.resolve(process.cwd(), options.customerSource || DEFAULT_CUSTOMER_SOURCE),
    measurementSource: path.resolve(
      process.cwd(),
      options.measurementSource || DEFAULT_MEASUREMENT_SOURCE
    ),
    limit: options.limit === undefined ? null : parseLimit(options.limit),
    report: options.report ? path.resolve(process.cwd(), options.report) : null,
  };
  const report = createReport(normalizedOptions);

  try {
    assertSafeReportPath(normalizedOptions.report);
    const stageReports = {};
    const stages = [
      {
        name: 'transformers',
        run: () => migrateTrafo({
          apply: normalizedOptions.apply,
          source: normalizedOptions.transformerSource,
          limit: normalizedOptions.limit,
        }),
      },
      {
        // The canonical transformer identity (nameKey) is reconciled right
        // after the transformer stage so the unique nameKey index can be
        // created on a migrated volume. The stage only reads the deployed
        // volume in apply mode.
        name: 'transformer-name-keys',
        run: () => {
          if (!normalizedOptions.apply) {
            return {
              status: 'dry-run-skipped',
              reason: 'The transformer nameKey reconciliation reads the deployed volume and runs with --apply.',
              total: 0,
              read: 0,
              inserted: 0,
              updated: 0,
              skipped: 0,
              invalid: 0,
              planned: { upserts: 0, inserted: 0, updated: 0, skipped: 0 },
              mismatches: [],
              errors: [],
              database: { connected: false, writesPerformed: false },
            };
          }
          return migrateTransformerNameKeys({ apply: true });
        },
      },
      {
        name: 'customers',
        run: () => migrateCustomers({
          apply: normalizedOptions.apply,
          source: normalizedOptions.customerSource,
          limit: normalizedOptions.limit,
        }),
      },
      {
        name: 'measurements',
        run: () => migrateMeasurements({
          apply: normalizedOptions.apply,
          source: normalizedOptions.measurementSource,
          transformerSource: normalizedOptions.transformerSource,
          limit: normalizedOptions.limit,
        }),
      },
    ];

    let fatalError = null;
    for (const stage of stages) {
      try {
        stageReports[stage.name] = await stage.run();
      } catch (error) {
        stageReports[stage.name] = error.report || {
          status: 'failed',
          fatal: true,
          total: 0,
          read: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          invalid: 0,
          planned: { upserts: 0, inserted: 0, updated: 0, skipped: 0 },
          mismatches: [],
          errors: [{ type: error.name || 'error', message: error.message || String(error) }],
          database: { connected: false, writesPerformed: false },
        };
        fatalError = error;
        break;
      }
    }

    if (stageReports.transformers) {
      report.sources.transformers.hash = stageReports.transformers.sourceHash || null;
    }
    if (stageReports.customers) {
      report.sources.customers.hash = stageReports.customers.sourceHash || null;
    }
    if (stageReports.measurements) {
      report.sources.measurements.hash = stageReports.measurements.sourceHash || null;
      report.sources.measurements.transformerHash =
        stageReports.measurements.transformerSourceHash || null;
    }
    report.source = {
      directory: path.dirname(normalizedOptions.transformerSource),
      transformer: normalizedOptions.transformerSource,
      customer: normalizedOptions.customerSource,
      measurement: normalizedOptions.measurementSource,
    };

    combineReports(report, stageReports);
    if (fatalError) {
      report.fatal = true;
      report.status = 'failed';
      throw new MigrationFailure(fatalError.message || String(fatalError), report);
    }

    report.status = normalizedOptions.apply ? 'complete' : 'dry-run-complete';
    return report;
  } catch (error) {
    if (error instanceof MigrationFailure && error.report) {
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
      const report = await migrateAll(options);
      writeJsonReport(options.report, report);
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      const report = error instanceof MigrationFailure && error.report
        ? error.report
        : {
            migration: 'all',
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

module.exports = migrateAll;
module.exports.MigrationFailure = MigrationFailure;
module.exports.assertSafeReportPath = assertSafeReportPath;
module.exports.createReport = createReport;
module.exports.parseCliOptions = parseCliOptions;
module.exports.writeJsonReport = writeJsonReport;
