const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';
const { connectDatabase, disconnectDatabase } = require('./connection');
const Transformer = require('../modules/transformers/transformerModel');
const TransformerAlias = require('../modules/transformers/transformerAliasModel');
const Measurement = require('../modules/measurements/measurementModel');
const { normalizeNameKey } = require('../shared/utils/nameKey');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_SOURCE = path.join(PROJECT_ROOT, '.temp', 'sigap', 'SIGAP ULP LABUHAN.html');
const DEFAULT_TRANSFORMER_SOURCE = path.join(
  PROJECT_ROOT,
  '.temp',
  'sigap',
  'Manajemen Trafo (SupaBase).csv'
);
const TRANSFORMER_SCHEMA = ['nama_trafo', 'penyulang', 'kapasitas', 'titik_koordinat'];
const EXPECTED_TRANSFORMER_ROWS = 1238;
const EXPECTED_SNAPSHOT_ROWS = 53;
const EXPECTED_MATCHED_TRANSFORMERS = 46;
const STRICT_POINT_PATTERN = /^POINT\s*\(\s*([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*\)$/i;
const KNOWN_UNMATCHED_NAMES = Object.freeze([
  'ML Pancing 1 6',
  'ML Pancing V 1',
  'ML Pancing V 2',
  'ML Pancing V 3',
  'ML Pancing V 4',
  'ML.592',
  'PDAM TIRTANADI',
]);

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

function resolveSourcePath(source, fallback) {
  if (!source) return fallback;
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
    transformerSource: DEFAULT_TRANSFORMER_SOURCE,
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
      options.source = resolveSourcePath(readValue('--source'), DEFAULT_SOURCE);
    } else if (argument.startsWith('--source=')) {
      options.source = resolveSourcePath(argument.slice('--source='.length), DEFAULT_SOURCE);
    } else if (argument === '--transformer-source') {
      options.transformerSource = resolveSourcePath(
        readValue('--transformer-source'),
        DEFAULT_TRANSFORMER_SOURCE
      );
    } else if (argument.startsWith('--transformer-source=')) {
      options.transformerSource = resolveSourcePath(
        argument.slice('--transformer-source='.length),
        DEFAULT_TRANSFORMER_SOURCE
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
  return options;
}

function createReport(options, sourcePath, transformerSourcePath) {
  return {
    migration: 'measurements',
    status: 'pending',
    mode: options.apply ? 'apply' : 'dry-run',
    source: sourcePath,
    sourceHash: null,
    sourceHashAlgorithm: 'sha256',
    transformerSource: transformerSourcePath,
    transformerSourceHash: null,
    total: 0,
    read: 0,
    matched: 0,
    unmatched: 0,
    processedMatched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    invalid: 0,
    planned: {
      snapshots: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      measurementRecords: 0,
    },
    measurementRecords: {
      inserted: 0,
      updated: 0,
      skipped: 0,
      total: 0,
    },
    transformerMetadata: {
      updated: 0,
      skipped: 0,
    },
    knownUnmatchedNames: [...KNOWN_UNMATCHED_NAMES],
    unmatchedNames: [],
    aliases: {
      available: 0,
      applied: 0,
      unresolved: [],
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

function parseTransformerNames(transformerSourcePath) {
  if (!fs.existsSync(transformerSourcePath)) {
    throw new MigrationFailure(`Transformer ground truth file not found: ${transformerSourcePath}`);
  }

  const buffer = fs.readFileSync(transformerSourcePath);
  const sourceHash = sha256(buffer);
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
  if (
    header.length !== TRANSFORMER_SCHEMA.length ||
    header.some((value, index) => value !== TRANSFORMER_SCHEMA[index])
  ) {
    throw new MigrationFailure(
      `Transformer CSV schema mismatch. Expected ${TRANSFORMER_SCHEMA.join(';')}, received ${header.join(';')}`
    );
  }

  const rows = matrix.slice(1);
  const isCanonicalSource = path.resolve(transformerSourcePath) === path.resolve(DEFAULT_TRANSFORMER_SOURCE);
  if (isCanonicalSource && rows.length !== EXPECTED_TRANSFORMER_ROWS) {
    throw new MigrationFailure(
      `Transformer CSV row count mismatch. Expected ${EXPECTED_TRANSFORMER_ROWS}, received ${rows.length}`
    );
  }

  const names = new Set();
  const seen = new Set();
  rows.forEach((row, index) => {
    const name = String(row[0] || '').trim();
    const coordinate = String(row[3] || '').trim();
    if (!name) {
      throw new MigrationFailure(`Transformer name is empty at CSV row ${index + 2}`);
    }
    const key = normalizeNameKey(name);
    if (seen.has(key)) {
      throw new MigrationFailure(`Transformer name is not case-insensitively unique at CSV row ${index + 2}: ${name}`);
    }
    if (!STRICT_POINT_PATTERN.test(coordinate)) {
      throw new MigrationFailure(
        `Transformer coordinate is not strict lon-lat WKT at CSV row ${index + 2}: ${coordinate}`
      );
    }
    seen.add(key);
    names.add(name);
  });

  return { names, sourceHash, total: rows.length, isCanonicalSource };
}

function findJsonObjectEnd(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function extractBebanDatabase(html) {
  const assignmentPattern = /\b(?:const|let|var)\s+bebanDatabase\s*=\s*/g;
  const assignments = [];
  let match;
  while ((match = assignmentPattern.exec(html)) !== null) {
    const objectStart = html.indexOf('{', match.index + match[0].length);
    if (objectStart === -1) {
      throw new MigrationFailure('bebanDatabase assignment does not contain a JSON object');
    }
    if (html.slice(match.index + match[0].length, objectStart).trim() !== '') {
      throw new MigrationFailure('bebanDatabase assignment has unexpected content before the JSON object');
    }
    const objectEnd = findJsonObjectEnd(html, objectStart);
    if (objectEnd === -1) {
      throw new MigrationFailure('bebanDatabase JSON object is not balanced');
    }
    const terminator = html.slice(objectEnd).match(/^\s*;/);
    if (!terminator) {
      throw new MigrationFailure('bebanDatabase JSON assignment is missing its semicolon terminator');
    }
    assignments.push({ objectStart, objectEnd });
  }

  if (assignments.length === 0) {
    throw new MigrationFailure('HTML does not contain a bebanDatabase JSON assignment');
  }
  if (assignments.length > 1) {
    throw new MigrationFailure(`HTML contains ${assignments.length} bebanDatabase assignments; expected exactly one`);
  }

  const assignment = assignments[0];
  const jsonText = html.slice(assignment.objectStart, assignment.objectEnd);
  let value;
  try {
    value = JSON.parse(jsonText);
  } catch (error) {
    throw new MigrationFailure(`bebanDatabase is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MigrationFailure('bebanDatabase JSON must be an object keyed by transformer name');
  }
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireFiniteNumber(value, label, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${label} must be a finite number`);
    return 0;
  }
  return value;
}

function validatePeriod(name, period, periodData, errors) {
  if (!isPlainObject(periodData)) {
    errors.push(`${period} payload is missing or is not an object`);
    return null;
  }

  const voltage = periodData.tegangan;
  const incoming = periodData.incoming;
  const branches = periodData.jurusan;
  if (!isPlainObject(voltage)) {
    errors.push(`${period}.tegangan is missing or is not an object`);
  } else {
    requireFiniteNumber(voltage.r, `${period}.tegangan.r`, errors);
    requireFiniteNumber(voltage.s, `${period}.tegangan.s`, errors);
    requireFiniteNumber(voltage.t, `${period}.tegangan.t`, errors);
  }
  if (!isPlainObject(incoming)) {
    errors.push(`${period}.incoming is missing or is not an object`);
  } else {
    requireFiniteNumber(incoming.r, `${period}.incoming.r`, errors);
    requireFiniteNumber(incoming.s, `${period}.incoming.s`, errors);
    requireFiniteNumber(incoming.t, `${period}.incoming.t`, errors);
    requireFiniteNumber(incoming.n, `${period}.incoming.n`, errors);
  }
  if (!Array.isArray(branches)) {
    errors.push(`${period}.jurusan is missing or is not an array`);
  } else {
    branches.forEach((branch, branchIndex) => {
      if (!isPlainObject(branch)) {
        errors.push(`${period}.jurusan[${branchIndex}] is not an object`);
        return;
      }
      requireFiniteNumber(branch.r, `${period}.jurusan[${branchIndex}].r`, errors);
      requireFiniteNumber(branch.s, `${period}.jurusan[${branchIndex}].s`, errors);
      requireFiniteNumber(branch.t, `${period}.jurusan[${branchIndex}].t`, errors);
      requireFiniteNumber(branch.n, `${period}.jurusan[${branchIndex}].n`, errors);
      if (typeof branch.nama !== 'string') {
        errors.push(`${period}.jurusan[${branchIndex}].nama must be a string`);
      }
      if (branch.fuse !== null && typeof branch.fuse !== 'string') {
        errors.push(`${period}.jurusan[${branchIndex}].fuse must be a string or null`);
      }
      if (branch.ket !== null && typeof branch.ket !== 'string') {
        errors.push(`${period}.jurusan[${branchIndex}].ket must be a string or null`);
      }
    });
  }

  if (periodData.updatedAt !== null && typeof periodData.updatedAt !== 'string') {
    errors.push(`${period}.updatedAt must be null or a date string`);
  } else if (typeof periodData.updatedAt === 'string') {
    const parsed = new Date(periodData.updatedAt);
    if (Number.isNaN(parsed.getTime())) errors.push(`${period}.updatedAt is not a valid date`);
  }
  if (periodData.updatedTime !== null && typeof periodData.updatedTime !== 'string') {
    errors.push(`${period}.updatedTime must be null or a string`);
  }

  if (errors.length > 0) return null;

  return {
    voltage: {
      r: voltage.r,
      s: voltage.s,
      t: voltage.t,
    },
    incoming: {
      r: incoming.r,
      s: incoming.s,
      t: incoming.t,
      n: incoming.n,
    },
    branches: branches.map((branch) => ({
      name: branch.nama,
      r: branch.r,
      s: branch.s,
      t: branch.t,
      n: branch.n,
      fuse: branch.fuse,
      note: branch.ket,
    })),
    measurementDate: periodData.updatedAt,
    measurementTime: periodData.updatedTime,
  };
}

function validateSnapshots(snapshotData) {
  const valid = new Map();
  const invalid = [];
  for (const [name, item] of Object.entries(snapshotData)) {
    const errors = [];
    if (!name.trim()) errors.push('transformer name is empty');
    if (!isPlainObject(item)) errors.push('snapshot payload is not an object');
    if (item && item.merek !== undefined && item.merek !== null && typeof item.merek !== 'string') {
      errors.push('merek must be a string or null');
    }
    if (
      item &&
      item.grounding !== undefined &&
      item.grounding !== null &&
      typeof item.grounding !== 'string'
    ) {
      errors.push('grounding must be a string or null');
    }

    let wbp = null;
    let lwbp = null;
    if (isPlainObject(item)) {
      wbp = validatePeriod(name, 'wbp', item.wbp, errors);
      lwbp = validatePeriod(name, 'lwbp', item.lwbp, errors);
    }

    if (errors.length > 0) {
      invalid.push({
        type: 'invalid_measurement_snapshot',
        name,
        errors,
      });
      continue;
    }

    valid.set(name, {
      name,
      brand: item.merek === undefined ? null : item.merek,
      grounding: item.grounding === undefined ? null : item.grounding,
      wbp,
      lwbp,
    });
  }
  return { valid, invalid };
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

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableJson(value[key]);
        return result;
      }, {});
  }
  return value;
}

function normalizedDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `invalid:${String(value)}`;
  return date.toISOString();
}

function measurementNeedsUpdate(existing, desired) {
  if (!existing) return true;
  for (const phase of ['r', 's', 't']) {
    if (Number(existing.voltage && existing.voltage[phase]) !== desired.voltage[phase]) return true;
  }
  for (const phase of ['r', 's', 't', 'n']) {
    if (Number(existing.incoming && existing.incoming[phase]) !== desired.incoming[phase]) return true;
  }
  if (
    JSON.stringify(stableJson(existing.branches || [])) !==
    JSON.stringify(stableJson(desired.branches || []))
  ) {
    return true;
  }
  if (normalizedDate(existing.measurementDate) !== normalizedDate(desired.measurementDate)) return true;
  if ((existing.measurementTime ?? null) !== desired.measurementTime) return true;
  if ((existing.source ?? null) !== desired.source) return true;
  if ((existing.sourceRecordKey ?? null) !== desired.sourceRecordKey) return true;
  return false;
}

function measurementKey(transformerId, period) {
  return `${String(transformerId)}|${period}`;
}

async function findTransformers(model, names) {
  if (!names.length) return [];
  const nameKeys = Array.from(
    new Set(names.map((name) => normalizeNameKey(name)).filter(Boolean)),
  );
  const clauses = [];
  if (nameKeys.length > 0) clauses.push({ nameKey: { $in: nameKeys } });
  // The exact-name fallback supports legacy documents that have not yet been
  // backfilled. The canonical nameKey branch is the identity match.
  clauses.push({ name: { $in: names } });
  const documents = await executeQuery(model.find({ $or: clauses }));
  if (!Array.isArray(documents)) return [];
  return documents.map(toPlainObject).filter(Boolean);
}

async function findApprovedAliasResolutions(aliasModel, transformerModel, unresolvedNames) {
  const resolutions = new Map();
  const unresolved = [];
  if (unresolvedNames.length === 0) {
    return { resolutions, available: 0, unresolved };
  }

  const unresolvedAliasKeys = Array.from(
    new Set(unresolvedNames.map((name) => normalizeNameKey(name)).filter(Boolean)),
  );
  const aliasClauses = [];
  if (unresolvedAliasKeys.length > 0) {
    aliasClauses.push({ aliasKey: { $in: unresolvedAliasKeys } });
  }
  aliasClauses.push({ aliasName: { $in: unresolvedNames } });
  const aliases = await executeQuery(aliasModel.find({ $or: aliasClauses }));
  const aliasRows = Array.isArray(aliases) ? aliases.map(toPlainObject).filter(Boolean) : [];
  const transformerIds = aliasRows
    .map((alias) => alias.transformerId)
    .filter(Boolean);
  const transformerDocuments = await executeQuery(
    transformerModel.find({ _id: { $in: transformerIds } }),
  );
  const transformersById = new Map(
    (Array.isArray(transformerDocuments) ? transformerDocuments : [])
      .map(toPlainObject)
      .filter(Boolean)
      .map((transformer) => [String(transformer._id), transformer]),
  );

  const targetByTransformerId = new Map();
  const unresolvedKeys = new Set(unresolvedNames.map(normalizeNameKey));
  for (const alias of aliasRows) {
    const aliasKey = normalizeNameKey(alias.aliasName);
    if (!unresolvedKeys.has(aliasKey)) continue;

    const transformer = transformersById.get(String(alias.transformerId));
    if (!transformer) {
      unresolved.push({
        aliasName: alias.aliasName,
        transformerId: String(alias.transformerId),
        reason: 'target_transformer_not_found',
      });
      continue;
    }

    const existingAlias = targetByTransformerId.get(String(transformer._id));
    if (existingAlias && normalizeNameKey(existingAlias.aliasName) !== aliasKey) {
      unresolved.push({
        aliasName: alias.aliasName,
        transformerId: String(transformer._id),
        reason: 'duplicate_alias_target',
      });
      continue;
    }

    targetByTransformerId.set(String(transformer._id), alias);
    resolutions.set(aliasKey, {
      aliasName: alias.aliasName,
      aliasId: alias._id,
      transformer,
    });
  }

  return {
    resolutions,
    available: aliasRows.length,
    unresolved,
  };
}

async function findMeasurements(model, transformerIds) {
  if (!transformerIds.length) return [];
  const documents = await executeQuery(
    model.find({
      transformerId: { $in: transformerIds },
      period: { $in: ['wbp', 'lwbp'] },
    })
  );
  if (!Array.isArray(documents)) return [];
  return documents.map(toPlainObject).filter(Boolean);
}

function buildMeasurementPlan(
  snapshots,
  transformerDocuments,
  measurementDocuments,
  aliasResolutions = new Map(),
) {
  const transformersByName = new Map(
    transformerDocuments.map((document) => [String(document.name || ''), document])
  );
  const transformersByNameKey = new Map();
  for (const document of transformerDocuments) {
    const nameKey = normalizeNameKey(document.name);
    if (!nameKey || transformersByNameKey.has(nameKey)) continue;
    transformersByNameKey.set(nameKey, document);
  }
  const measurementsByKey = new Map(
    measurementDocuments.map((document) => [
      measurementKey(document.transformerId, document.period),
      document,
    ])
  );
  const snapshotPlans = [];
  const missingTransformers = [];

  for (const snapshot of snapshots) {
    const transformer =
      transformersByName.get(snapshot.name) ||
      transformersByNameKey.get(normalizeNameKey(snapshot.name)) ||
      aliasResolutions.get(normalizeNameKey(snapshot.name))?.transformer ||
      null;
    if (!transformer) {
      missingTransformers.push(snapshot.name);
      continue;
    }

    const periodPlans = [];
    for (const period of ['wbp', 'lwbp']) {
      const desired = {
        ...snapshot[period],
        source: 'html_snapshot',
        sourceRecordKey: `${snapshot.name}|${period}`,
      };
      const existing = measurementsByKey.get(measurementKey(transformer._id, period));
      if (!existing) {
        periodPlans.push({
          kind: 'insert',
          filter: { transformerId: transformer._id, period },
          document: desired,
        });
      } else if (measurementNeedsUpdate(existing, desired)) {
        periodPlans.push({
          kind: 'update',
          filter: { transformerId: transformer._id, period },
          document: desired,
        });
      } else {
        periodPlans.push({
          kind: 'skip',
          filter: { transformerId: transformer._id, period },
          document: desired,
        });
      }
    }

    const metadataChanges = {};
    if (snapshot.brand !== null && snapshot.brand !== undefined) {
      if (String(transformer.brand ?? '') !== snapshot.brand) metadataChanges.brand = snapshot.brand;
    }
    if (snapshot.grounding !== null && snapshot.grounding !== undefined) {
      if (String(transformer.grounding ?? '') !== snapshot.grounding) {
        metadataChanges.grounding = snapshot.grounding;
      }
    }

    snapshotPlans.push({
      name: snapshot.name,
      transformer,
      periodPlans,
      metadataChanges,
    });
  }

  return { snapshotPlans, missingTransformers };
}

async function applyMeasurementPlan(plan, transformerModel, measurementModel) {
  let insertedSnapshots = 0;
  let updatedSnapshots = 0;
  let skippedSnapshots = 0;
  let insertedRecords = 0;
  let updatedRecords = 0;
  let skippedRecords = 0;
  let metadataUpdated = 0;
  let metadataSkipped = 0;

  for (const snapshotPlan of plan.snapshotPlans) {
    const kinds = new Set(snapshotPlan.periodPlans.map((operation) => operation.kind));
    for (const operation of snapshotPlan.periodPlans) {
      if (operation.kind === 'insert') {
        await measurementModel.updateOne(
          operation.filter,
          { $set: operation.document },
          { upsert: true, runValidators: false }
        );
        insertedRecords += 1;
      } else if (operation.kind === 'update') {
        await measurementModel.updateOne(
          operation.filter,
          { $set: operation.document },
          { upsert: false, runValidators: false }
        );
        updatedRecords += 1;
      } else {
        skippedRecords += 1;
      }
    }

    if (kinds.has('insert') && !kinds.has('update')) insertedSnapshots += 1;
    else if (kinds.has('update')) updatedSnapshots += 1;
    else skippedSnapshots += 1;

    if (Object.keys(snapshotPlan.metadataChanges).length > 0) {
      await transformerModel.updateOne(
        { _id: snapshotPlan.transformer._id },
        { $set: snapshotPlan.metadataChanges },
        { upsert: false, runValidators: false }
      );
      metadataUpdated += 1;
    } else {
      metadataSkipped += 1;
    }
  }

  return {
    insertedSnapshots,
    updatedSnapshots,
    skippedSnapshots,
    insertedRecords,
    updatedRecords,
    skippedRecords,
    metadataUpdated,
    metadataSkipped,
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
    'Usage: node backend/src/database/migrateMeasurements.js [options]',
    '',
    'Options:',
    '  --source <path>              HTML source (default: canonical .temp/sigap file)',
    '  --transformer-source <path>  Transformer CSV used for exact-name matching',
    '  --limit <count>              Process at most this many matched transformers',
    '  --report <path>              Write the JSON report atomically',
    '  --apply                      Write to MongoDB (default: dry-run)',
    '  --dry-run                    Explicitly select dry-run mode',
  ].join('\n');
}

async function migrateMeasurements(options = {}) {
  const normalizedOptions = {
    apply: options.apply === true,
    source: resolveSourcePath(options.source, DEFAULT_SOURCE),
    transformerSource: resolveSourcePath(options.transformerSource, DEFAULT_TRANSFORMER_SOURCE),
    limit: options.limit === undefined ? null : parseLimit(options.limit),
    report: options.report ? path.resolve(process.cwd(), options.report) : null,
  };
  const sourcePath = normalizedOptions.source;
  const transformerSourcePath = normalizedOptions.transformerSource;
  const report = createReport(normalizedOptions, sourcePath, transformerSourcePath);

  try {
    assertSafeReportPath(normalizedOptions.report, sourcePath);
    if (!fs.existsSync(sourcePath)) {
      throw new MigrationFailure(`Measurement HTML source not found: ${sourcePath}`);
    }

    const htmlBuffer = fs.readFileSync(sourcePath);
    report.sourceHash = sha256(htmlBuffer);
    let html;
    try {
      html = decodeUtf8Strict(htmlBuffer);
    } catch (error) {
      throw new MigrationFailure(`Measurement HTML is not valid UTF-8: ${error.message}`);
    }

    const snapshotData = extractBebanDatabase(html);
    const snapshotNames = Object.keys(snapshotData);
    report.total = snapshotNames.length;
    report.read = snapshotNames.length;

    const transformerSource = parseTransformerNames(transformerSourcePath);
    report.transformerSourceHash = transformerSource.sourceHash;

    const isCanonicalHtml = path.resolve(sourcePath) === path.resolve(DEFAULT_SOURCE);
    if (isCanonicalHtml && snapshotNames.length !== EXPECTED_SNAPSHOT_ROWS) {
      throw new MigrationFailure(
        `Measurement snapshot count mismatch. Expected ${EXPECTED_SNAPSHOT_ROWS}, received ${snapshotNames.length}`
      );
    }

    const validated = validateSnapshots(snapshotData);
    report.invalid = validated.invalid.length;
    report.mismatches.push(...validated.invalid);
    if (validated.invalid.length > 0) {
      report.fatal = true;
      report.errors.push({
        type: 'invalid_measurement_snapshots',
        message: `${validated.invalid.length} measurement snapshot(s) failed schema validation`,
        count: validated.invalid.length,
      });
      throw new MigrationFailure('Measurement source contains invalid snapshots', report);
    }

    const directMatchedNames = snapshotNames.filter((name) => transformerSource.names.has(name));
    const initiallyUnmatchedNames = snapshotNames.filter(
      (name) => !transformerSource.names.has(name),
    );

    if (
      transformerSource.isCanonicalSource &&
      directMatchedNames.length !== EXPECTED_MATCHED_TRANSFORMERS
    ) {
      throw new MigrationFailure(
        `Matched transformer count mismatch. Expected ${EXPECTED_MATCHED_TRANSFORMERS}, received ${directMatchedNames.length}`
      );
    }
    if (isCanonicalHtml && transformerSource.isCanonicalSource) {
      const knownUnmatched = new Set(KNOWN_UNMATCHED_NAMES);
      const unexpectedUnmatched = initiallyUnmatchedNames.filter(
        (name) => !knownUnmatched.has(name),
      );
      if (unexpectedUnmatched.length > 0) {
        throw new MigrationFailure(
          `Canonical unmatched-name set changed. Unexpected names: ${unexpectedUnmatched.join(', ')}`
        );
      }
    }

    await connectDatabase();
    report.database.connected = true;
    try {
      const aliasResult = await findApprovedAliasResolutions(
        TransformerAlias,
        Transformer,
        initiallyUnmatchedNames,
      );
      report.aliases.available = aliasResult.available;
      report.aliases.unresolved = aliasResult.unresolved;

      const aliasMatchedNames = initiallyUnmatchedNames.filter((name) =>
        aliasResult.resolutions.has(normalizeNameKey(name)),
      );
      const matchedNames = [...directMatchedNames, ...aliasMatchedNames];
      const unmatchedNames = initiallyUnmatchedNames.filter(
        (name) => !aliasResult.resolutions.has(normalizeNameKey(name)),
      );
      report.matched = matchedNames.length;
      report.unmatched = unmatchedNames.length;
      report.unmatchedNames = unmatchedNames;
      report.aliases.applied = aliasMatchedNames.length;

      for (const name of unmatchedNames) {
        report.mismatches.push({
          type: 'unmatched_transformer_name',
          name,
          action: 'Provide an explicit, reviewed alias mapping; no automatic link was created.',
        });
      }
      for (const issue of aliasResult.unresolved) {
        report.mismatches.push({
          type: 'invalid_transformer_alias',
          ...issue,
          action: 'Correct or remove the alias before applying measurements.',
        });
      }

      const selectedNames = normalizedOptions.limit
        ? matchedNames.slice(0, normalizedOptions.limit)
        : matchedNames;
      const snapshots = selectedNames.map((name) => validated.valid.get(name));
      report.processedMatched = selectedNames.length;
      report.planned.snapshots = selectedNames.length;
      report.planned.inserted = selectedNames.length;
      report.planned.measurementRecords = selectedNames.length * 2;
      report.measurementRecords.total = selectedNames.length * 2;
      report.skipped = unmatchedNames.length;

      if (!normalizedOptions.apply) {
        report.status = 'dry-run-complete';
        return report;
      }

      const transformerDocuments = await findTransformers(
        Transformer,
        directMatchedNames.filter((name) => selectedNames.includes(name)),
      );
      const aliasResolutions = new Map();
      for (const name of aliasMatchedNames) {
        if (!selectedNames.includes(name)) continue;
        const resolution = aliasResult.resolutions.get(normalizeNameKey(name));
        if (resolution) aliasResolutions.set(normalizeNameKey(name), resolution);
      }
      const transformerIds = [
        ...new Set([
          ...transformerDocuments.map((document) => String(document._id)),
          ...[...aliasResolutions.values()].map((resolution) =>
            String(resolution.transformer._id),
          ),
        ]),
      ];
      const measurementDocuments = await findMeasurements(Measurement, transformerIds);
      const plan = buildMeasurementPlan(
        snapshots,
        transformerDocuments,
        measurementDocuments,
        aliasResolutions,
      );

      if (plan.missingTransformers.length > 0) {
        for (const name of plan.missingTransformers) {
          report.mismatches.push({
            type: 'transformer_missing_in_database',
            name,
            action: 'Run the transformer migration first or create the exact canonical transformer name.',
          });
        }
        report.fatal = true;
        report.errors.push({
          type: 'missing_canonical_transformers',
          message: `${plan.missingTransformers.length} matched transformer(s) do not exist in MongoDB`,
          names: plan.missingTransformers,
        });
        throw new MigrationFailure('Matched canonical transformers are missing from MongoDB', report);
      }

      const result = await applyMeasurementPlan(plan, Transformer, Measurement);
      report.inserted = result.insertedSnapshots;
      report.updated = result.updatedSnapshots;
      report.skipped += result.skippedSnapshots;
      report.measurementRecords.inserted = result.insertedRecords;
      report.measurementRecords.updated = result.updatedRecords;
      report.measurementRecords.skipped = result.skippedRecords;
      report.transformerMetadata.updated = result.metadataUpdated;
      report.transformerMetadata.skipped = result.metadataSkipped;
      report.planned.inserted = result.insertedSnapshots;
      report.planned.updated = result.updatedSnapshots;
      report.planned.skipped = result.skippedSnapshots;
      report.database.writesPerformed =
        result.insertedRecords > 0 || result.updatedRecords > 0 || result.metadataUpdated > 0;
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
      const report = await migrateMeasurements(options);
      writeJsonReport(options.report, report);
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      const report = error instanceof MigrationFailure && error.report
        ? error.report
        : {
            migration: 'measurements',
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

module.exports = migrateMeasurements;
module.exports.MigrationFailure = MigrationFailure;
module.exports.assertSafeReportPath = assertSafeReportPath;
module.exports.createReport = createReport;
module.exports.extractBebanDatabase = extractBebanDatabase;
module.exports.findApprovedAliasResolutions = findApprovedAliasResolutions;
module.exports.buildMeasurementPlan = buildMeasurementPlan;
module.exports.parseCliOptions = parseCliOptions;
module.exports.validateSnapshots = validateSnapshots;
module.exports.writeJsonReport = writeJsonReport;
