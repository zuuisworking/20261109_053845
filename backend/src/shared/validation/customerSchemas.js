const {
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_TARIFF_MAX_LENGTH,
  CUSTOMER_POWER_RAW_MAX_LENGTH,
  CUSTOMER_ADDRESS_MAX_LENGTH,
  MAX_POWER_VA,
} = require('../constants/domainLimits');

const nullableStringSchema = (maxLength) => ({
  anyOf: [
    { type: 'string', maxLength },
    { type: 'null' },
  ],
});

const customerWriteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['customerId', 'name'],
  properties: {
    customerId: {
      type: 'string',
      pattern: '^\\d{12}$',
      minLength: 12,
      maxLength: 12,
    },
    name: {
      type: 'string',
      minLength: 1,
      maxLength: CUSTOMER_NAME_MAX_LENGTH,
      pattern: '.*\\S.*',
    },
    tariff: nullableStringSchema(CUSTOMER_TARIFF_MAX_LENGTH),
    power: nullableStringSchema(CUSTOMER_POWER_RAW_MAX_LENGTH),
    powerVa: {
      anyOf: [
        { type: 'integer', minimum: 0, maximum: MAX_POWER_VA },
        { type: 'null' },
      ],
    },
    address: nullableStringSchema(CUSTOMER_ADDRESS_MAX_LENGTH),
  },
};

module.exports = {
  customerWriteSchema,
};
