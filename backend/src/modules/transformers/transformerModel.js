const mongoose = require('mongoose');
const { normalizeDisplayName, normalizeNameKey } = require('../../shared/utils/nameKey');
const {
  TRANSFORMER_NAME_MAX_LENGTH,
  TRANSFORMER_NAME_KEY_MAX_LENGTH,
  TRANSFORMER_FEEDER_MAX_LENGTH,
  TRANSFORMER_CAPACITY_MAX_LENGTH,
  TRANSFORMER_BRAND_MAX_LENGTH,
  TRANSFORMER_GROUNDING_MAX_LENGTH,
  TRANSFORMER_RAW_COORDINATES_MAX_LENGTH,
  MAX_CAPACITY_KVA,
} = require('../../shared/constants/domainLimits');

const CASE_INSENSITIVE_COLLATION = Object.freeze({
  locale: 'en',
  strength: 2,
});

function normalizeTransformerName(value) {
  return String(value ?? '').trim();
}

const pointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: [true, 'Lokasi harus berupa GeoJSON Point'],
    },
    coordinates: {
      type: [Number],
      required: [true, 'Koordinat lokasi wajib diisi'],
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length === 2 &&
            value.every((coordinate) => Number.isFinite(coordinate)) &&
            value[0] >= -180 &&
            value[0] <= 180 &&
            value[1] >= -90 &&
            value[1] <= 90
          );
        },
        message: 'Koordinat GeoJSON harus berupa [longitude, latitude]',
      },
    },
  },
  { _id: false },
);

const transformerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Nama trafo wajib diisi'],
      trim: true,
      maxlength: [TRANSFORMER_NAME_MAX_LENGTH, `Nama trafo maksimal ${TRANSFORMER_NAME_MAX_LENGTH} karakter`],
    },
    nameKey: {
      type: String,
      required: [true, 'Kunci nama trafo wajib diisi'],
      maxlength: [
        TRANSFORMER_NAME_KEY_MAX_LENGTH,
        `Kunci nama trafo maksimal ${TRANSFORMER_NAME_KEY_MAX_LENGTH} karakter`,
      ],
      index: {
        unique: true,
        name: 'transformer_name_key_unique',
      },
    },
    feeder: {
      type: String,
      trim: true,
      maxlength: [
        TRANSFORMER_FEEDER_MAX_LENGTH,
        `Penyulang maksimal ${TRANSFORMER_FEEDER_MAX_LENGTH} karakter`,
      ],
    },
    capacity: {
      type: String,
      trim: true,
      maxlength: [
        TRANSFORMER_CAPACITY_MAX_LENGTH,
        `Kapasitas maksimal ${TRANSFORMER_CAPACITY_MAX_LENGTH} karakter`,
      ],
    },
    capacityKva: {
      type: Number,
      validate: {
        validator(value) {
          return (
            value === null ||
            value === undefined ||
            (Number.isFinite(value) && value > 0 && value <= MAX_CAPACITY_KVA)
          );
        },
        message: `Kapasitas trafo harus berupa angka lebih besar dari 0 dan maksimal ${MAX_CAPACITY_KVA} kVA`,
      },
    },
    brand: {
      type: String,
      trim: true,
      maxlength: [
        TRANSFORMER_BRAND_MAX_LENGTH,
        `Merek maksimal ${TRANSFORMER_BRAND_MAX_LENGTH} karakter`,
      ],
    },
    grounding: {
      type: String,
      trim: true,
      maxlength: [
        TRANSFORMER_GROUNDING_MAX_LENGTH,
        `Grounding maksimal ${TRANSFORMER_GROUNDING_MAX_LENGTH} karakter`,
      ],
    },
    location: pointSchema,
    rawCoordinates: {
      type: String,
      trim: true,
      maxlength: [
        TRANSFORMER_RAW_COORDINATES_MAX_LENGTH,
        `Koordinat mentah maksimal ${TRANSFORMER_RAW_COORDINATES_MAX_LENGTH} karakter`,
      ],
    },
    source: {
      type: String,
      trim: true,
    },
    sourceFile: {
      type: String,
      trim: true,
      maxlength: 255,
    },
    sourceRow: {
      type: Number,
      min: 1,
    },
    sourceMetadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

transformerSchema.index({ location: '2dsphere' }, { sparse: true });
transformerSchema.index({ feeder: 1 });

function normalizeExactNameFilter(filter) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    return { filter, hasExactName: false };
  }

  const rewritten = { ...filter };
  let hasExactName = false;
  if (typeof rewritten.name === 'string') {
    rewritten.name = normalizeTransformerName(rewritten.name);
    hasExactName = true;
  } else if (rewritten.name && Array.isArray(rewritten.name.$in)) {
    rewritten.name = {
      ...rewritten.name,
      $in: rewritten.name.$in.map((name) =>
        typeof name === 'string' ? normalizeTransformerName(name) : name,
      ),
    };
    hasExactName = rewritten.name.$in.every((name) => typeof name === 'string');
  }
  return { filter: rewritten, hasExactName };
}

transformerSchema.pre('validate', function normalizeTransformerIdentity() {
  if (typeof this.name === 'string') {
    this.name = normalizeDisplayName(this.name);
    this.nameKey = normalizeNameKey(this.name);
  }
});

/**
 * Keeps the canonical identity pair consistent for every write path that
 * changes the display name: the nameKey is always derived from the stored
 * NFC-normalized display name.
 */
function applyCanonicalIdentityToUpdate(update) {
  if (!update || typeof update !== 'object') return;

  if (update.$set && typeof update.$set.name === 'string') {
    update.$set.name = normalizeDisplayName(update.$set.name);
    update.$set.nameKey = normalizeNameKey(update.$set.name);
    return;
  }

  const isReplacement = !Object.keys(update).some((key) => key.startsWith('$'));
  if (isReplacement && typeof update.name === 'string') {
    update.name = normalizeDisplayName(update.name);
    update.nameKey = normalizeNameKey(update.name);
  }
}

transformerSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'],
  function keepTransformerIdentityInSync() {
    applyCanonicalIdentityToUpdate(this.getUpdate());
  },
);

transformerSchema.pre(
  ['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'deleteOne', 'deleteMany', 'countDocuments'],
  function normalizeExactNameQuery() {
    const normalized = normalizeExactNameFilter(this.getFilter());
    this.setQuery(normalized.filter);
    if (normalized.hasExactName) this.collation(CASE_INSENSITIVE_COLLATION);
  },
);

transformerSchema.pre('bulkWrite', function normalizeBulkWrites(ops) {
  for (const operation of ops) {
    if (operation.updateOne || operation.updateMany) {
      const op = operation.updateOne || operation.updateMany;
      const normalized = normalizeExactNameFilter(op.filter);
      op.filter = normalized.filter;
      if (normalized.hasExactName) op.collation = { ...CASE_INSENSITIVE_COLLATION };
      applyCanonicalIdentityToUpdate(op.update);
    } else if (operation.replaceOne) {
      const normalized = normalizeExactNameFilter(operation.replaceOne.filter);
      operation.replaceOne.filter = normalized.filter;
      if (normalized.hasExactName) {
        operation.replaceOne.collation = { ...CASE_INSENSITIVE_COLLATION };
      }
      applyCanonicalIdentityToUpdate(operation.replaceOne.replacement);
    } else if (operation.insertOne?.document) {
      const document = operation.insertOne.document;
      if (typeof document.name === 'string') {
        document.name = normalizeDisplayName(document.name);
        document.nameKey = normalizeNameKey(document.name);
      }
    }
  }
  return ops;
});

transformerSchema.statics.normalizeName = normalizeTransformerName;

module.exports = mongoose.model('Transformer', transformerSchema);
