const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';
const { connectDatabase, disconnectDatabase } = require('./connection');
const Transformer = require('../modules/transformers/transformerModel');
const {
  TransformerIdentityError,
  migrateTransformerNameKeys,
} = require('./transformerNameKeyMigration');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

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

function parseCliOptions(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
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

function createReport(options) {
  return {
    migration: 'transformer-name-keys',
    status: 'pending',
    mode: options.apply ? 'apply' : 'dry-run',
    database: {
      connected: false,
      writesPerformed: false,
    },
    analysis: null,
    indexPlan: null,
    backfill: null,
    indexes: null,
    mismatches: [],
    errors: [],
    fatal: false,
  };
}

function writeJsonReport(reportPath, report) {
  if (!reportPath) return;
  assertSafeReportPath(reportPath);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(reportPath),
    `.${path.basename(reportPath)}.${process.pid}.${Date.now()}.tmp`,
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
    'Usage: node backend/src/database/migrateTransformerNameKeys.js [options]',
    '',
    'Purpose:',
    '  Backfill the canonical transformer nameKey on existing volumes and reconcile the',
    '  known nameKey indexes. Duplicate canonical keys abort the run without merging',
    '  or deleting any record. Unrelated indexes are never dropped.',
    '',
    'Options:',
    '  --report <path>  Write the JSON report atomically',
    '  --apply          Write to MongoDB (default: dry-run)',
    '  --dry-run        Explicitly select dry-run mode',
  ].join('\n');
}

async function migrateTransformerNameKeysCommand(options = {}) {
  const normalizedOptions = {
    apply: options.apply === true,
    report: options.report ? path.resolve(process.cwd(), options.report) : null,
  };
  const report = createReport(normalizedOptions);

  try {
    assertSafeReportPath(normalizedOptions.report);
    await connectDatabase();
    report.database.connected = true;

    try {
      const collection = mongooseCollection();
      const result = await migrateTransformerNameKeys(collection, {
        apply: normalizedOptions.apply,
      });

      report.analysis = result.analysis;
      report.indexPlan = result.indexPlan;
      report.backfill = result.backfill;
      report.indexes = result.indexes;
      report.database.writesPerformed = Boolean(normalizedOptions.apply);
      report.status = result.status;

      if (result.analysis) {
        for (const duplicate of result.analysis.duplicateKeys || []) {
          report.mismatches.push({
            type: 'duplicate_name_key',
            nameKey: duplicate.nameKey,
            count: duplicate.count,
          });
        }
      }
    } finally {
      await disconnectDatabase();
      report.database.connected = false;
    }

    return report;
  } catch (error) {
    const message = error?.message || String(error);
    report.fatal = true;
    report.status = 'failed';
    report.errors.push({
      type: error?.code || error?.name || 'error',
      message,
    });
    if (error instanceof TransformerIdentityError && error.details) {
      report.details = error.details;
    }
    throw new MigrationFailure(message, report);
  }
}

function mongooseCollection() {
  // The transformer collection name is owned by the model, not by this script.
  const collectionName = Transformer.collection?.collectionName || 'transformers';
  return mongoose.connection.db.collection(collectionName);
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
      const report = await migrateTransformerNameKeysCommand(options);
      writeJsonReport(options.report, report);
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      const report =
        error instanceof MigrationFailure && error.report
          ? error.report
          : {
              migration: 'transformer-name-keys',
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

module.exports = migrateTransformerNameKeysCommand;
module.exports.MigrationFailure = MigrationFailure;
module.exports.assertSafeReportPath = assertSafeReportPath;
module.exports.createReport = createReport;
module.exports.helpText = helpText;
module.exports.parseCliOptions = parseCliOptions;
module.exports.writeJsonReport = writeJsonReport;
