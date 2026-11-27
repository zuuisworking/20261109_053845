const mongoose = require('mongoose');
const TransformerAlias = require('./transformerAliasModel');
const Transformer = require('./transformerModel');
const AppError = require('../../shared/errors/AppError');
const { normalizeDisplayName, normalizeNameKey } = require('../../shared/utils/nameKey');
const {
  TRANSFORMER_ALIAS_NAME_MAX_LENGTH,
  TRANSFORMER_ALIAS_REASON_MAX_LENGTH,
  TRANSFORMER_ALIAS_SOURCE_VERSION_MAX_LENGTH,
} = require('../../shared/constants/domainLimits');
const {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  MAX_PAGE_SIZE,
  parseBoundedInteger,
  parseBoundedSearch,
  semanticValidationError,
  validationDetails,
} = require('../../shared/validation/canonicalQueryParams');

const DEFAULT_ALIAS_SOURCE = 'static-html';
const DEFAULT_SOURCE_VERSION = 'protected-html-v1';

function normalizeAliasKey(value) {
  return normalizeNameKey(value);
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes the client-proposed alias display name on the shared canonical
 * Unicode path and rejects values outside the canonical bounds.
 */
function normalizeAliasName(value) {
  if (typeof value !== 'string') {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('aliasName', 'VALIDATION_ERROR', 'aliasName harus berupa string.'),
    );
  }
  const name = normalizeDisplayName(value);
  if (!name) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('aliasName', 'REQUIRED', 'Nama alias wajib diisi.'),
    );
  }
  if (name.length > TRANSFORMER_ALIAS_NAME_MAX_LENGTH) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        'aliasName',
        'VALIDATION_ERROR',
        `aliasName maksimal ${TRANSFORMER_ALIAS_NAME_MAX_LENGTH} karakter.`,
      ),
    );
  }
  return name;
}

function normalizeAliasReason(value) {
  if (typeof value !== 'string') {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('reason', 'VALIDATION_ERROR', 'reason harus berupa string.'),
    );
  }
  const reason = value.trim();
  if (!reason) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('reason', 'REQUIRED', 'Alasan persetujuan wajib diisi.'),
    );
  }
  if (reason.length > TRANSFORMER_ALIAS_REASON_MAX_LENGTH) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        'reason',
        'VALIDATION_ERROR',
        `reason maksimal ${TRANSFORMER_ALIAS_REASON_MAX_LENGTH} karakter.`,
      ),
    );
  }
  return reason;
}

function normalizeTargetTransformerId(value) {
  if (typeof value !== 'string' || !mongoose.Types.ObjectId.isValid(value)) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('transformerId', 'VALIDATION_ERROR', 'transformerId harus berupa ObjectId yang valid.'),
    );
  }
  return value;
}

/**
 * Accepts only a bounded string revision marker. Anything else (for example an
 * object) is rejected instead of being stringified into a persisted value.
 */
function normalizeSourceVersion(value) {
  if (value === undefined || value === null) return DEFAULT_SOURCE_VERSION;
  if (typeof value !== 'string') {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('sourceVersion', 'VALIDATION_ERROR', 'sourceVersion harus berupa string.'),
    );
  }
  const version = value.trim();
  if (!version) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('sourceVersion', 'REQUIRED', 'sourceVersion wajib diisi.'),
    );
  }
  if (version.length > TRANSFORMER_ALIAS_SOURCE_VERSION_MAX_LENGTH) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        'sourceVersion',
        'VALIDATION_ERROR',
        `sourceVersion maksimal ${TRANSFORMER_ALIAS_SOURCE_VERSION_MAX_LENGTH} karakter.`,
      ),
    );
  }
  return version;
}

class TransformerAliasService {
  async list({ page = DEFAULT_PAGE, limit, pageSize, search = '', q = '' } = {}) {
    const pageNumber = parseBoundedInteger(page, DEFAULT_PAGE, {
      min: 1,
      max: MAX_PAGE_NUMBER,
      path: 'page',
    });
    const pageSizeValue = parseBoundedInteger(
      pageSize ?? limit,
      DEFAULT_PAGE_SIZE,
      { min: 1, max: MAX_PAGE_SIZE, path: 'pageSize' },
    );
    const cleanSearch = parseBoundedSearch(q || search);
    const query = {};
    if (cleanSearch) {
      const pattern = new RegExp(escapeRegexLiteral(cleanSearch), 'i');
      query.$or = [{ aliasName: pattern }, { reason: pattern }];
    }

    const [items, totalItems] = await Promise.all([
      TransformerAlias.find(query)
        .sort({ aliasKey: 1, _id: 1 })
        .skip((pageNumber - 1) * pageSizeValue)
        .limit(pageSizeValue)
        .lean(),
      TransformerAlias.countDocuments(query),
    ]);

    return {
      items,
      meta: {
        page: pageNumber,
        pageSize: pageSizeValue,
        total: totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSizeValue),
      },
    };
  }

  async create({ aliasName, transformerId, reason, approvedBy, sourceVersion } = {}) {
    const name = normalizeAliasName(aliasName);
    const approvalReason = normalizeAliasReason(reason);
    const targetTransformerId = normalizeTargetTransformerId(transformerId);
    const version = normalizeSourceVersion(sourceVersion);

    const transformer = await Transformer.findById(targetTransformerId).select('_id name').lean();
    if (!transformer) throw new AppError('Trafo target tidak ditemukan.', 404);

    const aliasKey = normalizeAliasKey(name);
    const existing = await TransformerAlias.findOne({ aliasKey }).lean();
    if (existing) {
      throw new AppError(`Alias '${name}' sudah terdaftar.`, 409);
    }

    return TransformerAlias.create({
      aliasName: name,
      aliasKey,
      transformerId: transformer._id,
      reason: approvalReason,
      approvedBy,
      approvedAt: new Date(),
      source: DEFAULT_ALIAS_SOURCE,
      sourceVersion: version,
    });
  }

  async delete(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('ID alias tidak valid.', 400);
    }
    const deleted = await TransformerAlias.findByIdAndDelete(id).lean();
    if (!deleted) throw new AppError('Alias tidak ditemukan.', 404);
    return deleted;
  }
}

module.exports = new TransformerAliasService();
module.exports.normalizeAliasKey = normalizeAliasKey;
module.exports.normalizeAliasName = normalizeAliasName;
module.exports.normalizeAliasReason = normalizeAliasReason;
module.exports.normalizeSourceVersion = normalizeSourceVersion;
module.exports.DEFAULT_ALIAS_SOURCE = DEFAULT_ALIAS_SOURCE;
module.exports.DEFAULT_SOURCE_VERSION = DEFAULT_SOURCE_VERSION;
