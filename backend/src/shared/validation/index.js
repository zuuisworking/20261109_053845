const Ajv = require('ajv');
const AppError = require('../errors/AppError');
const schemas = require('./authSchemas');
const measurementSchemas = require('./measurementSchemas');
const transformerSchemas = require('./transformerSchemas');
const transformerAliasSchemas = require('./transformerAliasSchemas');
const customerSchemas = require('./customerSchemas');

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
  strictRequired: false,
  useDefaults: false,
  validateFormats: true,
});

const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

ajv.addFormat('email', {
  type: 'string',
  validate: (value) => EMAIL_PATTERN.test(value),
});

ajv.addFormat('date-only', {
  type: 'string',
  validate: (value) => {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  },
});

const compiledValidators = new WeakMap();

function getValidator(schema) {
  if (!schema || typeof schema !== 'object') {
    throw new Error('A valid JSON schema is required.');
  }

  if (!compiledValidators.has(schema)) {
    compiledValidators.set(schema, ajv.compile(schema));
  }

  return compiledValidators.get(schema);
}

function normalizeErrorPath(error) {
  const basePath = String(error.instancePath || '').replace(/^\//, '');
  const property = error.params?.additionalProperty || error.params?.missingProperty;
  if (!property) return basePath;
  return basePath ? `${basePath}.${property}` : property;
}

function formatValidationErrors(errors) {
  return (errors || []).map((error) => ({
    path: normalizeErrorPath(error),
    code: error.keyword === 'additionalProperties' ? 'UNEXPECTED_FIELD' : error.keyword.toUpperCase(),
    message: error.message || 'Value is invalid.',
  }));
}

function validationErrorCode(errors) {
  return (errors || []).some((error) => error.keyword === 'additionalProperties')
    ? 'UNEXPECTED_FIELD'
    : 'VALIDATION_ERROR';
}

function assertValid(schema, data) {
  const validator = getValidator(schema);
  if (validator(data)) {
    return data;
  }

  throw new AppError(
    'Permintaan tidak valid.',
    422,
    formatValidationErrors(validator.errors),
    validationErrorCode(validator.errors)
  );
}

function validateRequest(schema, source = 'body') {
  const validator = getValidator(schema);

  return function requestValidationMiddleware(req, res, next) {
    const value = req[source];
    if (validator(value)) {
      return next();
    }

    return next(
      new AppError(
        'Permintaan tidak valid.',
        422,
        formatValidationErrors(validator.errors),
        validationErrorCode(validator.errors)
      )
    );
  };
}

module.exports = {
  ...schemas,
  ...measurementSchemas,
  ...transformerSchemas,
  ...transformerAliasSchemas,
  ...customerSchemas,
  ajv,
  assertValid,
  formatValidationErrors,
  getValidator,
  validateRequest,
};
