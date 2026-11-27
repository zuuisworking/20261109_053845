const {
  MAX_CURRENT_AMPS,
  MEASUREMENT_TEXT_MAX_LENGTH,
} = require('../constants/domainLimits');

const nullableNonNegativeNumberSchema = {
  anyOf: [
    { type: 'number', minimum: 0, maximum: MAX_CURRENT_AMPS },
    { type: 'null' },
  ],
};

const nullableStringSchema = {
  anyOf: [
    { type: 'string', maxLength: MEASUREMENT_TEXT_MAX_LENGTH },
    { type: 'null' },
  ],
};

const measurementBranchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: nullableStringSchema,
    r: nullableNonNegativeNumberSchema,
    s: nullableNonNegativeNumberSchema,
    t: nullableNonNegativeNumberSchema,
    n: nullableNonNegativeNumberSchema,
    fuse: nullableStringSchema,
    note: nullableStringSchema,
  },
};

const measurementUpsertSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['period', 'voltage', 'incoming'],
  properties: {
    period: {
      type: 'string',
      enum: ['wbp', 'lwbp'],
    },
    voltage: {
      type: 'object',
      additionalProperties: false,
      required: ['r', 's', 't'],
      properties: {
        r: { type: 'number', minimum: 0, maximum: 500 },
        s: { type: 'number', minimum: 0, maximum: 500 },
        t: { type: 'number', minimum: 0, maximum: 500 },
      },
    },
    incoming: {
      type: 'object',
      additionalProperties: false,
      required: ['r', 's', 't', 'n'],
      properties: {
        r: { type: 'number', minimum: 0, maximum: MAX_CURRENT_AMPS },
        s: { type: 'number', minimum: 0, maximum: MAX_CURRENT_AMPS },
        t: { type: 'number', minimum: 0, maximum: MAX_CURRENT_AMPS },
        n: { type: 'number', minimum: 0, maximum: MAX_CURRENT_AMPS },
      },
    },
    branches: {
      type: 'array',
      maxItems: 500,
      items: measurementBranchSchema,
    },
    measurementDate: {
      anyOf: [
        { type: 'string', format: 'date-only' },
        { type: 'null' },
      ],
    },
    measurementTime: {
      anyOf: [
        { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
        { type: 'null' },
      ],
    },
  },
};

module.exports = {
  measurementBranchSchema,
  measurementUpsertSchema,
};
