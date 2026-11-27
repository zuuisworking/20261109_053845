const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const Transformer = require('../../backend/src/modules/transformers/transformerModel');
const {
  TRANSFORMER_NAME_KEY_INDEX_NAME,
  TransformerIdentityError,
  analyzeTransformerNameKeys,
  assertTransformerIdentityReady,
  migrateTransformerNameKeys,
  planTransformerNameKeyIndexReconciliation,
} = require('../../backend/src/database/transformerNameKeyMigration');
const {
  applyTransformerPlan,
  buildTransformerPlan,
  parseTransformerSource,
} = require('../../backend/src/database/migrateTrafo');
const {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} = require('../helpers/database');

const LEGACY_MISSING_KEY = 'Trafo Tanpa Key';
const LEGACY_MISMATCHED_KEY = 'Trafo Key Rusak';
const LEGACY_UNTRIMMED_NAME = '  Trafo Spasi  ';
const CANONICAL_TRANSFORMER = 'Caf\u00e9 Trafo';

function transformerCollection() {
  const collectionName = Transformer.collection?.collectionName || 'transformers';
  return mongoose.connection.db.collection(collectionName);
}

// Mongoose builds the schema indexes when the connection opens. Each test
// starts from a known index state so the reconciliation behaviour is explicit.
async function resetTransformerIndexes() {
  const collection = transformerCollection();
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (error) {
    // NamespaceNotFound: the collection does not exist yet.
    if (error?.code !== 26) throw error;
    return;
  }
  for (const index of indexes) {
    if (index.name === '_id_') continue;
    await collection.dropIndex(index.name);
  }
}

beforeAll(async () => {
  await connectTestDatabase();
  await Transformer.init();
});

beforeEach(async () => {
  await clearTestDatabase();
  await resetTransformerIndexes();
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('transformer nameKey backfill', () => {
  it('writes the canonical nameKey and display name on legacy documents', async () => {
    const collection = transformerCollection();
    await collection.insertMany([
      { name: LEGACY_MISSING_KEY },
      { name: LEGACY_MISMATCHED_KEY, nameKey: 'trafo-key-rusak' },
      { name: LEGACY_UNTRIMMED_NAME, nameKey: 'trafo spasi' },
      { name: CANONICAL_TRANSFORMER, nameKey: 'caf\u00e9 trafo' },
    ]);

    const analysis = await analyzeTransformerNameKeys(collection);
    expect(analysis.total).toBe(4);
    expect(analysis.missingNameKey).toBe(1);
    expect(analysis.mismatchedNameKey).toBe(1);
    expect(analysis.nonCanonicalDisplayName).toBe(1);
    expect(analysis.pendingUpdates).toBe(3);
    expect(analysis.duplicateKeys).toEqual([]);

    const result = await migrateTransformerNameKeys(collection, { apply: true });
    expect(result.status).toBe('complete');
    expect(result.backfill.updated).toBe(3);
    expect(result.backfill.displayNameNormalized).toBe(1);

    const documents = await collection.find({}).sort({ name: 1 }).toArray();
    const byName = new Map(documents.map((document) => [document.name, document]));

    expect(byName.get(LEGACY_MISSING_KEY).nameKey).toBe('trafo tanpa key');
    expect(byName.get(LEGACY_MISMATCHED_KEY).nameKey).toBe('trafo key rusak');
    expect(byName.get(LEGACY_UNTRIMMED_NAME)).toBeUndefined();
    expect(byName.get('Trafo Spasi').nameKey).toBe('trafo spasi');
    expect(byName.get(CANONICAL_TRANSFORMER).nameKey).toBe('caf\u00e9 trafo');
  });

  it('fails on duplicate canonical keys without merging or deleting records', async () => {
    const collection = transformerCollection();
    await collection.insertMany([
      { name: 'Trafo Kembar' },
      { name: 'TRAFO KEMBAR' },
      { name: 'Trafo Unik' },
    ]);

    await expect(migrateTransformerNameKeys(collection, { apply: true })).rejects.toMatchObject({
      code: 'TRANSFORMER_IDENTITY_DUPLICATE_KEYS',
    });

    const documents = await collection.find({}).sort({ name: 1 }).toArray();
    expect(documents).toHaveLength(3);
    expect(documents.every((document) => document.nameKey === undefined)).toBe(true);
  });

  it('detects duplicate canonical keys across Unicode full case folding', async () => {
    const collection = transformerCollection();
    await collection.insertMany([
      { name: '\u039f\u03a3' },
      { name: '\u03bf\u03c3' },
      { name: 'Stra\u00dfe' },
      { name: 'strasse' },
    ]);

    const analysis = await analyzeTransformerNameKeys(collection);
    expect(analysis.duplicateKeys).toHaveLength(2);
    expect(analysis.duplicateKeys.map((entry) => entry.count)).toEqual([2, 2]);
    expect(analysis.duplicateKeys.map((entry) => entry.nameKey)).toEqual(
      expect.arrayContaining(['οσ', 'strasse']),
    );

    await expect(migrateTransformerNameKeys(collection, { apply: true })).rejects.toMatchObject({
      code: 'TRANSFORMER_IDENTITY_DUPLICATE_KEYS',
    });
    expect(await collection.countDocuments({})).toBe(4);
  });

  it('detects duplicate canonical keys across Unicode composition', async () => {
    const collection = transformerCollection();
    await collection.insertMany([
      { name: 'Caf\u00e9 Kembar' },
      { name: 'Cafe\u0301 Kembar' },
    ]);

    const analysis = await analyzeTransformerNameKeys(collection);
    expect(analysis.duplicateKeys).toHaveLength(1);
    expect(analysis.duplicateKeys[0].nameKey).toBe('caf\u00e9 kembar');
    expect(analysis.duplicateKeys[0].count).toBe(2);
  });
});

describe('transformer nameKey index reconciliation', () => {
  it('creates the canonical unique index and keeps unrelated indexes', async () => {
    const collection = transformerCollection();
    await collection.insertOne({ name: 'Trafo Indeks', nameKey: 'trafo indeks' });
    await collection.createIndex({ source: 1 }, { name: 'custom_source_index' });
    await collection.createIndex({ nameKey: 1 }, { name: 'nameKey_1' });

    const plan = await planTransformerNameKeyIndexReconciliation(collection);
    expect(plan.preserved.map((index) => index.name)).toContain('custom_source_index');
    expect(plan.actions.map((action) => action.action)).toContain('create');

    const result = await migrateTransformerNameKeys(collection, { apply: true });
    expect(result.indexes.created).toContain(TRANSFORMER_NAME_KEY_INDEX_NAME);
    expect(result.indexes.dropped).toContain('nameKey_1');
    expect(result.indexes.preserved).toContain('custom_source_index');

    const indexes = await collection.indexes();
    const names = indexes.map((index) => index.name);
    expect(names).toContain(TRANSFORMER_NAME_KEY_INDEX_NAME);
    expect(names).not.toContain('nameKey_1');
    expect(names).toContain('custom_source_index');

    const canonical = indexes.find((index) => index.name === TRANSFORMER_NAME_KEY_INDEX_NAME);
    expect(canonical.unique).toBe(true);
    expect(canonical.key).toEqual({ nameKey: 1 });
  });

  it('enforces one record per canonical key once the unique index exists', async () => {
    const collection = transformerCollection();
    await collection.insertOne({ name: 'Trafo Unik', nameKey: 'trafo unik' });
    await migrateTransformerNameKeys(collection, { apply: true });

    await expect(
      collection.insertOne({ name: 'TRAFO UNIK', nameKey: 'trafo unik' }),
    ).rejects.toMatchObject({ code: 11000 });

    expect(await collection.countDocuments({})).toBe(1);
  });

  it('refuses to touch an unmanaged unique nameKey index', async () => {
    const collection = transformerCollection();
    await collection.insertOne({ name: 'Trafo Konflik', nameKey: 'trafo konflik' });
    await collection.createIndex({ nameKey: 1 }, { name: 'legacy_unique_name_key', unique: true });

    await expect(migrateTransformerNameKeys(collection, { apply: true })).rejects.toMatchObject({
      code: 'TRANSFORMER_NAME_KEY_INDEX_CONFLICT',
    });

    const indexes = await collection.indexes();
    expect(indexes.map((index) => index.name)).toContain('legacy_unique_name_key');
    expect(indexes.map((index) => index.name)).not.toContain(TRANSFORMER_NAME_KEY_INDEX_NAME);
  });
});

describe('transformer identity startup gate', () => {
  it('refuses to start while legacy documents are not migrated', async () => {
    const collection = transformerCollection();
    await collection.insertOne({ name: 'Trafo Legacy' });

    await expect(assertTransformerIdentityReady(collection)).rejects.toMatchObject({
      code: 'TRANSFORMER_NAME_KEY_BACKFILL_REQUIRED',
    });
  });

  it('accepts a migrated volume and guarantees the unique index exists', async () => {
    const collection = transformerCollection();
    await collection.insertOne({ name: 'Trafo Siap', nameKey: 'trafo siap' });

    const result = await assertTransformerIdentityReady(collection);
    expect(result.analysis.pendingUpdates).toBe(0);

    const indexes = await collection.indexes();
    expect(indexes.map((index) => index.name)).toContain(TRANSFORMER_NAME_KEY_INDEX_NAME);
  });

  it('accepts a volume that is protected by an unmanaged unique nameKey index', async () => {
    const collection = transformerCollection();
    await collection.insertOne({ name: 'Trafo Terlindungi', nameKey: 'trafo terlindungi' });
    await collection.createIndex(
      { nameKey: 1 },
      { name: 'legacy_unique_name_key', unique: true },
    );

    const result = await assertTransformerIdentityReady(collection);
    expect(result.protected).toBe(true);
    expect(result.warning).toMatch(/legacy_unique_name_key/);

    const indexes = await collection.indexes();
    expect(indexes.map((index) => index.name)).toContain('legacy_unique_name_key');
  });

  it('surfaces duplicate canonical keys as a blocking identity error', async () => {
    const collection = transformerCollection();
    await collection.insertMany([{ name: 'Trafo A' }, { name: 'trafo a' }]);

    await expect(assertTransformerIdentityReady(collection)).rejects.toBeInstanceOf(
      TransformerIdentityError,
    );
  });
});

describe('canonical transformer migration writes nameKey', () => {
  const temporaryDirectories = [];

  afterAll(() => {
    for (const directory of temporaryDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function writeSourceCsv() {
    const baseDir =
      process.env.TEMP && fs.existsSync(process.env.TEMP)
        ? path.join(process.env.TEMP, 'opencode')
        : os.tmpdir();
    fs.mkdirSync(baseDir, { recursive: true });
    const directory = fs.mkdtempSync(path.join(baseDir, 'sigap-trafo-'));
    temporaryDirectories.push(directory);
    const sourcePath = path.join(directory, 'transformers.csv');
    const csv = [
      'nama_trafo;penyulang;kapasitas;titik_koordinat',
      'Trafo Migrasi;FEEDER-MIG;100 kVA;POINT (98.676652 3.666219)',
      '',
    ].join('\n');
    fs.writeFileSync(sourcePath, csv, 'utf8');
    return sourcePath;
  }

  it('stores the canonical nameKey when the canonical migration applies', async () => {
    const sourcePath = writeSourceCsv();
    const parsed = parseTransformerSource(sourcePath);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].nameKey).toBe('trafo migrasi');

    const plan = await buildTransformerPlan(parsed.records, Transformer);
    expect(plan.duplicates).toEqual([]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].filter).toEqual({ nameKey: 'trafo migrasi' });
    expect(plan.inserts[0].document.nameKey).toBe('trafo migrasi');

    await applyTransformerPlan(plan, Transformer);

    const stored = await Transformer.findOne({ name: 'Trafo Migrasi' }).lean();
    expect(stored).not.toBeNull();
    expect(stored.nameKey).toBe('trafo migrasi');
  });

  it('adopts a legacy record that has no nameKey instead of duplicating it', async () => {
    const collection = transformerCollection();
    await collection.insertOne({ name: 'Trafo Migrasi' });

    const sourcePath = writeSourceCsv();
    const parsed = parseTransformerSource(sourcePath);
    const plan = await buildTransformerPlan(parsed.records, Transformer);

    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    await applyTransformerPlan(plan, Transformer);

    expect(await collection.countDocuments({})).toBe(1);
    const stored = await collection.findOne({});
    expect(stored.nameKey).toBe('trafo migrasi');
  });

  it('reports duplicate canonical keys in the existing volume without writing', async () => {
    const collection = transformerCollection();
    await collection.insertMany([{ name: 'Trafo Migrasi' }, { name: 'TRAFO MIGRASI' }]);

    const sourcePath = writeSourceCsv();
    const parsed = parseTransformerSource(sourcePath);
    const plan = await buildTransformerPlan(parsed.records, Transformer);

    expect(plan.duplicates).toHaveLength(1);
    expect(plan.duplicates[0].nameKey).toBe('trafo migrasi');
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(await collection.countDocuments({})).toBe(2);
  });
});
