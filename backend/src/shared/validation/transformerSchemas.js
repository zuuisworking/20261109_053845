const {
  TRANSFORMER_NAME_MAX_LENGTH,
  TRANSFORMER_FEEDER_MAX_LENGTH,
  TRANSFORMER_CAPACITY_MAX_LENGTH,
  TRANSFORMER_BRAND_MAX_LENGTH,
  TRANSFORMER_GROUNDING_MAX_LENGTH,
  TRANSFORMER_RAW_COORDINATES_MAX_LENGTH,
  MAX_CAPACITY_KVA,
} = require('../constants/domainLimits');

const nullableStringSchema = (maxLength) => ({
  anyOf: [
    { type: 'string', maxLength },
    { type: 'null' },
  ],
});

const nullableLocationSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'coordinates'],
      properties: {
        type: { type: 'string', enum: ['Point'] },
        coordinates: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: { type: 'number' },
        },
      },
    },
    { type: 'null' },
  ],
};

const transformerWriteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: TRANSFORMER_NAME_MAX_LENGTH,
      pattern: '.*\\S.*',
    },
    feeder: nullableStringSchema(TRANSFORMER_FEEDER_MAX_LENGTH),
    capacity: nullableStringSchema(TRANSFORMER_CAPACITY_MAX_LENGTH),
    capacityKva: {
      anyOf: [
        {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: MAX_CAPACITY_KVA,
        },
        { type: 'null' },
      ],
    },
    brand: nullableStringSchema(TRANSFORMER_BRAND_MAX_LENGTH),
    grounding: nullableStringSchema(TRANSFORMER_GROUNDING_MAX_LENGTH),
    location: nullableLocationSchema,
    rawCoordinates: nullableStringSchema(TRANSFORMER_RAW_COORDINATES_MAX_LENGTH),
  },
};

module.exports = {
  transformerWriteSchema,
};
