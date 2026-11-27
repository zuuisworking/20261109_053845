// Strict request schema for the transformer alias registry.
//
// The alias registry is server-owned: clients may only propose an alias
// display name, the target transformer, the approval reason, and the
// protected-page revision. Every other field (identity key, provenance kind,
// approver, approval timestamp) is derived by the server, so unknown fields
// are rejected instead of being persisted.
const {
  TRANSFORMER_ALIAS_NAME_MAX_LENGTH,
  TRANSFORMER_ALIAS_REASON_MAX_LENGTH,
  TRANSFORMER_ALIAS_SOURCE_VERSION_MAX_LENGTH,
} = require('../constants/domainLimits');

const objectIdSchema = {
  type: 'string',
  minLength: 24,
  maxLength: 24,
  pattern: '^[0-9a-fA-F]{24}$',
};

const transformerAliasWriteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['aliasName', 'transformerId', 'reason'],
  properties: {
    aliasName: {
      type: 'string',
      minLength: 1,
      maxLength: TRANSFORMER_ALIAS_NAME_MAX_LENGTH,
      pattern: '.*\\S.*',
    },
    transformerId: objectIdSchema,
    reason: {
      type: 'string',
      minLength: 1,
      maxLength: TRANSFORMER_ALIAS_REASON_MAX_LENGTH,
      pattern: '.*\\S.*',
    },
    sourceVersion: {
      type: 'string',
      minLength: 1,
      maxLength: TRANSFORMER_ALIAS_SOURCE_VERSION_MAX_LENGTH,
      pattern: '.*\\S.*',
    },
  },
};

module.exports = {
  transformerAliasWriteSchema,
};
