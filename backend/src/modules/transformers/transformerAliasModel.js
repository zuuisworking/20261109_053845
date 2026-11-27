const mongoose = require('mongoose');
const { normalizeDisplayName, normalizeNameKey } = require('../../shared/utils/nameKey');
const {
  TRANSFORMER_ALIAS_NAME_MAX_LENGTH,
  TRANSFORMER_ALIAS_KEY_MAX_LENGTH,
  TRANSFORMER_ALIAS_REASON_MAX_LENGTH,
  TRANSFORMER_ALIAS_SOURCE_MAX_LENGTH,
  TRANSFORMER_ALIAS_SOURCE_VERSION_MAX_LENGTH,
} = require('../../shared/constants/domainLimits');

const transformerAliasSchema = new mongoose.Schema(
  {
    aliasName: {
      type: String,
      required: [true, 'Nama alias wajib diisi'],
      trim: true,
      maxlength: [
        TRANSFORMER_ALIAS_NAME_MAX_LENGTH,
        `Nama alias maksimal ${TRANSFORMER_ALIAS_NAME_MAX_LENGTH} karakter`,
      ],
    },
    aliasKey: {
      type: String,
      required: [true, 'Kunci alias wajib diisi'],
      unique: true,
      trim: true,
      // No lowercase transform here: the server-owned key is the shared
      // Unicode full-fold output, which must not be rewritten by a
      // locale-sensitive lowercasing rule (for example sharp s -> ss).
      maxlength: [
        TRANSFORMER_ALIAS_KEY_MAX_LENGTH,
        `Kunci alias maksimal ${TRANSFORMER_ALIAS_KEY_MAX_LENGTH} karakter`,
      ],
    },
    transformerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transformer',
      required: [true, 'Trafo target wajib diisi'],
      index: true,
    },
    reason: {
      type: String,
      required: [true, 'Alasan persetujuan wajib diisi'],
      trim: true,
      maxlength: [
        TRANSFORMER_ALIAS_REASON_MAX_LENGTH,
        `Alasan maksimal ${TRANSFORMER_ALIAS_REASON_MAX_LENGTH} karakter`,
      ],
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    approvedAt: {
      type: Date,
      required: true,
    },
    source: {
      type: String,
      required: true,
      trim: true,
      default: 'static-html',
      maxlength: [
        TRANSFORMER_ALIAS_SOURCE_MAX_LENGTH,
        `Sumber maksimal ${TRANSFORMER_ALIAS_SOURCE_MAX_LENGTH} karakter`,
      ],
    },
    sourceVersion: {
      type: String,
      required: true,
      trim: true,
      maxlength: [
        TRANSFORMER_ALIAS_SOURCE_VERSION_MAX_LENGTH,
        `Versi sumber maksimal ${TRANSFORMER_ALIAS_SOURCE_VERSION_MAX_LENGTH} karakter`,
      ],
    },
  },
  {
    timestamps: true,
    collection: 'transformer_aliases',
  },
);

/**
 * Keeps the alias identity on the shared canonical Unicode path for every
 * write path: the display name is NFC-normalized and the server-owned key is
 * always derived from that display name.
 */
transformerAliasSchema.pre('validate', function normalizeAliasIdentity() {
  if (typeof this.aliasName === 'string') {
    this.aliasName = normalizeDisplayName(this.aliasName);
    this.aliasKey = normalizeNameKey(this.aliasName);
  }
});

module.exports =
  mongoose.models.TransformerAlias ||
  mongoose.model('TransformerAlias', transformerAliasSchema);
