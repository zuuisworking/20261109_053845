const { normalizeDisplayName, normalizeNameKey } = require('../shared/utils/nameKey');

const TRANSFORMER_COLLECTION_NAME = 'transformers';
const TRANSFORMER_NAME_KEY_INDEX_NAME = 'transformer_name_key_unique';
const TRANSFORMER_NAME_KEY_INDEX_SPEC = Object.freeze({ nameKey: 1 });

// Indexes owned by this reconciliation. Every other index on the collection is
// preserved: the migration never calls syncIndexes() and never drops an index
// it does not recognise.
const MANAGED_NAME_KEY_INDEX_NAMES = Object.freeze([
  TRANSFORMER_NAME_KEY_INDEX_NAME,
  'nameKey_1',
]);

const DEFAULT_BATCH_SIZE = 500;
const MAX_REPORTED_DOCUMENTS_PER_KEY = 10;
const MONGO_INDEX_OPTIONS_CONFLICT = 85;

class TransformerIdentityError extends Error {
  constructor(message, { code = 'TRANSFORMER_IDENTITY_ERROR', details = {} } = {}) {
    super(message);
    this.name = 'TransformerIdentityError';
    this.code = code;
    this.details = details;
  }
}

function canonicalTransformerName(value) {
  return normalizeDisplayName(value);
}

function canonicalTransformerNameKey(value) {
  return normalizeNameKey(value);
}

function isNameKeyIndex(index) {
  if (!index || typeof index !== 'object' || !index.key || typeof index.key !== 'object') {
    return false;
  }
  const entries = Object.entries(index.key);
  return entries.length === 1 && entries[0][0] === 'nameKey' && entries[0][1] === 1;
}

function describeDocument(document) {
  return {
    id: String(document?._id ?? ''),
    name: document?.name ?? null,
    storedNameKey: typeof document?.nameKey === 'string' ? document.nameKey : null,
  };
}

/**
 * Scans the transformer collection and reports how far it is from the
 * canonical identity contract. Nothing is written by this function.
 */
async function analyzeTransformerNameKeys(collection) {
  const summary = {
    total: 0,
    canonical: 0,
    missingNameKey: 0,
    mismatchedNameKey: 0,
    nonCanonicalDisplayName: 0,
    pendingUpdates: 0,
    invalidDocumentCount: 0,
    invalidDocuments: [],
    duplicateKeys: [],
  };

  const documentsByKey = new Map();
  const cursor = collection.find({}, { projection: { name: 1, nameKey: 1 } });

  for await (const document of cursor) {
    summary.total += 1;

    const storedName = typeof document?.name === 'string' ? document.name : null;
    const canonicalName = canonicalTransformerName(storedName);
    const canonicalKey = canonicalTransformerNameKey(storedName);
    const storedKey = typeof document?.nameKey === 'string' ? document.nameKey : null;

    if (!canonicalName) {
      summary.invalidDocumentCount += 1;
      if (summary.invalidDocuments.length < MAX_REPORTED_DOCUMENTS_PER_KEY) {
        summary.invalidDocuments.push({
          ...describeDocument(document),
          reason: 'missing_name',
        });
      }
      continue;
    }

    if (storedKey === null) summary.missingNameKey += 1;
    else if (storedKey !== canonicalKey) summary.mismatchedNameKey += 1;
    else summary.canonical += 1;

    if (storedName !== canonicalName) summary.nonCanonicalDisplayName += 1;

    if (storedKey !== canonicalKey || storedName !== canonicalName) {
      summary.pendingUpdates += 1;
    }

    const bucket = documentsByKey.get(canonicalKey);
    if (bucket) {
      bucket.count += 1;
      if (bucket.documents.length < MAX_REPORTED_DOCUMENTS_PER_KEY) {
        bucket.documents.push(describeDocument(document));
      }
    } else {
      documentsByKey.set(canonicalKey, {
        nameKey: canonicalKey,
        count: 1,
        documents: [describeDocument(document)],
      });
    }
  }

  for (const bucket of documentsByKey.values()) {
    if (bucket.count > 1) summary.duplicateKeys.push(bucket);
  }
  summary.duplicateKeys.sort((left, right) => left.nameKey.localeCompare(right.nameKey));

  return summary;
}

function assertNoBlockingIdentityConflicts(summary) {
  if (summary.invalidDocumentCount > 0) {
    throw new TransformerIdentityError(
      `${summary.invalidDocumentCount} transformer document(s) have no usable display name and cannot be ` +
        'migrated automatically.',
      {
        code: 'TRANSFORMER_IDENTITY_INVALID_DOCUMENTS',
        details: {
          invalidDocumentCount: summary.invalidDocumentCount,
          invalidDocuments: summary.invalidDocuments,
        },
      },
    );
  }

  if (summary.duplicateKeys.length > 0) {
    throw new TransformerIdentityError(
      `Found ${summary.duplicateKeys.length} duplicate canonical transformer name key(s). ` +
        'No record was merged or deleted; resolve the duplicates explicitly before migrating.',
      {
        code: 'TRANSFORMER_IDENTITY_DUPLICATE_KEYS',
        details: { duplicateKeys: summary.duplicateKeys },
      },
    );
  }
}

/**
 * Writes the canonical display name and nameKey on every legacy document.
 * The scan is streamed and the writes are batched; `updatedAt` is left
 * untouched so reviewed import previews keep their target fingerprint.
 */
async function applyTransformerNameKeyBackfill(collection, { batchSize = DEFAULT_BATCH_SIZE } = {}) {
  let scanned = 0;
  let updated = 0;
  let displayNameNormalized = 0;
  let operations = [];

  const flush = async () => {
    if (operations.length === 0) return;
    try {
      const result = await collection.bulkWrite(operations, { ordered: false });
      updated += result.modifiedCount ?? 0;
    } catch (error) {
      throw new TransformerIdentityError(
        `Transformer nameKey backfill failed while writing ${operations.length} document(s): ` +
          `${error?.message || error}`,
        {
          code: 'TRANSFORMER_NAME_KEY_BACKFILL_FAILED',
          details: { cause: error?.message || String(error), code: error?.code ?? null },
        },
      );
    }
    operations = [];
  };

  const cursor = collection.find({}, { projection: { name: 1, nameKey: 1 } });
  for await (const document of cursor) {
    scanned += 1;
    const storedName = typeof document?.name === 'string' ? document.name : null;
    const canonicalName = canonicalTransformerName(storedName);
    if (!canonicalName) continue;

    const canonicalKey = canonicalTransformerNameKey(storedName);
    const storedKey = typeof document?.nameKey === 'string' ? document.nameKey : null;
    if (storedKey === canonicalKey && storedName === canonicalName) continue;

    const fields = { nameKey: canonicalKey };
    if (storedName !== canonicalName) {
      fields.name = canonicalName;
      displayNameNormalized += 1;
    }

    operations.push({
      updateOne: {
        filter: { _id: document._id },
        update: { $set: fields },
      },
    });

    if (operations.length >= batchSize) await flush();
  }
  await flush();

  return { scanned, updated, displayNameNormalized };
}

async function readTransformerIndexes(collection) {
  const indexes = await collection.indexes();
  return indexes.map((index) => ({
    name: index.name,
    key: index.key,
    unique: index.unique === true,
    managed: MANAGED_NAME_KEY_INDEX_NAMES.includes(index.name),
    nameKey: isNameKeyIndex(index),
  }));
}

/**
 * Describes the index actions required to reach the canonical state without
 * touching unrelated indexes.
 */
async function planTransformerNameKeyIndexReconciliation(collection) {
  const indexes = await readTransformerIndexes(collection);
  const canonical =
    indexes.find((index) => index.name === TRANSFORMER_NAME_KEY_INDEX_NAME) || null;
  const managedLegacy = indexes.filter(
    (index) =>
      index.nameKey &&
      index.managed &&
      index.name !== TRANSFORMER_NAME_KEY_INDEX_NAME,
  );
  const unmanagedNameKey = indexes.filter((index) => index.nameKey && !index.managed);
  const unmanagedUniqueNameKey = unmanagedNameKey.filter((index) => index.unique);
  const canonicalInvalid = Boolean(canonical && (!canonical.nameKey || !canonical.unique));

  const actions = [];
  if (canonicalInvalid) {
    actions.push({
      action: 'fail',
      reason: 'canonical_index_conflict',
      message:
        `Index '${TRANSFORMER_NAME_KEY_INDEX_NAME}' exists but is not a unique index on nameKey. ` +
        'Review it manually; the migration does not drop or rewrite it.',
    });
  } else if (!canonical) {
    if (unmanagedUniqueNameKey.length > 0) {
      actions.push({
        action: 'fail',
        reason: 'unmanaged_unique_name_key_index',
        message:
          `A unique nameKey index that this migration does not manage already exists: ` +
          `${unmanagedUniqueNameKey.map((index) => index.name).join(', ')}. ` +
          'Resolve the index conflict explicitly before migrating.',
      });
    } else {
      actions.push({
        action: 'create',
        name: TRANSFORMER_NAME_KEY_INDEX_NAME,
        key: TRANSFORMER_NAME_KEY_INDEX_SPEC,
        unique: true,
      });
    }
  }

  for (const index of managedLegacy) {
    actions.push({ action: 'drop', name: index.name, reason: 'redundant_name_key_index' });
  }

  return {
    indexes,
    canonical,
    managedLegacy,
    unmanagedNameKey,
    unmanagedUniqueNameKey,
    canonicalInvalid,
    preserved: indexes.filter((index) => !index.nameKey),
    actions,
  };
}

/**
 * Creates the canonical unique nameKey index and removes only the managed
 * legacy nameKey indexes. Unrelated indexes are always preserved.
 */
async function applyTransformerNameKeyIndexReconciliation(collection) {
  const plan = await planTransformerNameKeyIndexReconciliation(collection);
  const created = [];
  const dropped = [];

  const failingAction = plan.actions.find((action) => action.action === 'fail');
  if (failingAction) {
    throw new TransformerIdentityError(failingAction.message, {
      code:
        failingAction.reason === 'unmanaged_unique_name_key_index'
          ? 'TRANSFORMER_NAME_KEY_INDEX_CONFLICT'
          : 'TRANSFORMER_NAME_KEY_INDEX_INVALID',
      details: { action: failingAction },
    });
  }

  if (!plan.canonical) {
    const createOptions = { unique: true, name: TRANSFORMER_NAME_KEY_INDEX_NAME };
    try {
      await collection.createIndex(TRANSFORMER_NAME_KEY_INDEX_SPEC, createOptions);
      created.push(TRANSFORMER_NAME_KEY_INDEX_NAME);
    } catch (error) {
      const canDropManagedLegacy =
        error?.code === MONGO_INDEX_OPTIONS_CONFLICT && plan.managedLegacy.length > 0;
      if (!canDropManagedLegacy) {
        throw new TransformerIdentityError(
          `Could not create the unique transformer nameKey index: ${error?.message || error}`,
          {
            code: 'TRANSFORMER_NAME_KEY_INDEX_FAILED',
            details: { cause: error?.message || String(error), code: error?.code ?? null },
          },
        );
      }

      // Older MongoDB versions refuse a unique index while a non-unique index
      // with the same key pattern exists. Only the managed legacy indexes are
      // removed, and only to make room for the canonical unique index.
      for (const index of plan.managedLegacy) {
        await collection.dropIndex(index.name);
        dropped.push(index.name);
      }
      await collection.createIndex(TRANSFORMER_NAME_KEY_INDEX_SPEC, createOptions);
      created.push(TRANSFORMER_NAME_KEY_INDEX_NAME);
    }
  }

  const remaining = await readTransformerIndexes(collection);
  for (const index of remaining) {
    if (
      index.nameKey &&
      index.managed &&
      index.name !== TRANSFORMER_NAME_KEY_INDEX_NAME &&
      !dropped.includes(index.name)
    ) {
      await collection.dropIndex(index.name);
      dropped.push(index.name);
    }
  }

  const finalIndexes = await readTransformerIndexes(collection);
  const preservedNames = new Set(plan.preserved.map((index) => index.name));
  const lostIndexes = [...preservedNames].filter(
    (name) => !finalIndexes.some((index) => index.name === name),
  );
  if (lostIndexes.length > 0) {
    throw new TransformerIdentityError(
      `Unrelated transformer indexes were lost during reconciliation: ${lostIndexes.join(', ')}.`,
      {
        code: 'TRANSFORMER_NAME_KEY_INDEX_REGRESSION',
        details: { lostIndexes },
      },
    );
  }

  return {
    created,
    dropped,
    preserved: finalIndexes.filter((index) => !index.nameKey).map((index) => index.name),
    indexes: finalIndexes,
  };
}

/**
 * Full reconciliation: analyse, fail on duplicates, backfill, then reconcile
 * the known nameKey indexes.
 */
async function migrateTransformerNameKeys(collection, { apply = false, batchSize } = {}) {
  const analysis = await analyzeTransformerNameKeys(collection);
  assertNoBlockingIdentityConflicts(analysis);

  const indexPlan = await planTransformerNameKeyIndexReconciliation(collection);
  const blockingIndexAction = indexPlan.actions.find((action) => action.action === 'fail');
  if (blockingIndexAction) {
    // A blocking index conflict is reported before any document is written.
    throw new TransformerIdentityError(blockingIndexAction.message, {
      code:
        blockingIndexAction.reason === 'unmanaged_unique_name_key_index'
          ? 'TRANSFORMER_NAME_KEY_INDEX_CONFLICT'
          : 'TRANSFORMER_NAME_KEY_INDEX_INVALID',
      details: { action: blockingIndexAction },
    });
  }

  if (!apply) {
    return {
      status: 'dry-run-complete',
      apply: false,
      analysis,
      indexPlan,
      backfill: null,
      indexes: null,
    };
  }

  const backfill = await applyTransformerNameKeyBackfill(collection, { batchSize });
  const postAnalysis = await analyzeTransformerNameKeys(collection);
  assertNoBlockingIdentityConflicts(postAnalysis);
  if (postAnalysis.pendingUpdates > 0) {
    throw new TransformerIdentityError(
      `Transformer nameKey backfill did not converge: ${postAnalysis.pendingUpdates} document(s) still differ.`,
      {
        code: 'TRANSFORMER_NAME_KEY_BACKFILL_INCOMPLETE',
        details: { analysis: postAnalysis },
      },
    );
  }

  const indexes = await applyTransformerNameKeyIndexReconciliation(collection);

  return {
    status: 'complete',
    apply: true,
    analysis,
    postAnalysis,
    indexPlan,
    backfill,
    indexes,
  };
}

/**
 * Startup gate. Verifies that the deployed volume already satisfies the
 * canonical identity contract and that a unique nameKey index protects it.
 *
 * The gate never merges, deletes, or rewrites a transformer record, and it
 * never drops an index it does not manage.
 */
async function assertTransformerIdentityReady(collection) {
  const analysis = await analyzeTransformerNameKeys(collection);
  assertNoBlockingIdentityConflicts(analysis);

  if (analysis.pendingUpdates > 0) {
    throw new TransformerIdentityError(
      `Transformer identity is not migrated: ${analysis.pendingUpdates} document(s) are missing or ` +
        'mismatch the canonical nameKey. Run the transformer nameKey migration before starting the service.',
      {
        code: 'TRANSFORMER_NAME_KEY_BACKFILL_REQUIRED',
        details: { analysis },
      },
    );
  }

  const plan = await planTransformerNameKeyIndexReconciliation(collection);

  if (plan.canonicalInvalid) {
    throw new TransformerIdentityError(
      `Index '${TRANSFORMER_NAME_KEY_INDEX_NAME}' exists but is not a unique index on nameKey.`,
      {
        code: 'TRANSFORMER_NAME_KEY_INDEX_INVALID',
        details: { indexPlan: plan },
      },
    );
  }

  if (plan.canonical) {
    return { analysis, indexPlan: plan, indexes: null, protected: true };
  }

  if (plan.unmanagedUniqueNameKey.length > 0) {
    // The identity is protected by a unique nameKey index that this
    // migration does not manage. It is reported, never dropped.
    return {
      analysis,
      indexPlan: plan,
      indexes: null,
      protected: true,
      warning:
        `A unique nameKey index that this migration does not manage already exists: ` +
        `${plan.unmanagedUniqueNameKey.map((index) => index.name).join(', ')}.`,
    };
  }

  const indexes = await applyTransformerNameKeyIndexReconciliation(collection);
  return { analysis, indexPlan: plan, indexes, protected: true };
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  MANAGED_NAME_KEY_INDEX_NAMES,
  MONGO_INDEX_OPTIONS_CONFLICT,
  TRANSFORMER_COLLECTION_NAME,
  TRANSFORMER_NAME_KEY_INDEX_NAME,
  TRANSFORMER_NAME_KEY_INDEX_SPEC,
  TransformerIdentityError,
  analyzeTransformerNameKeys,
  applyTransformerNameKeyBackfill,
  applyTransformerNameKeyIndexReconciliation,
  assertNoBlockingIdentityConflicts,
  assertTransformerIdentityReady,
  canonicalTransformerName,
  canonicalTransformerNameKey,
  isNameKeyIndex,
  migrateTransformerNameKeys,
  planTransformerNameKeyIndexReconciliation,
  readTransformerIndexes,
};
