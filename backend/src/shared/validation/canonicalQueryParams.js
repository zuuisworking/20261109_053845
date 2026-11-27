// Canonical bounded pagination and search validation.
//
// The list endpoints of this API share one bounded contract: malformed
// pagination values are rejected with the canonical 422 validation envelope
// instead of being silently clamped, and search terms are limited to 100
// characters. Keeping the helpers in one module prevents a new endpoint from
// inventing a different pagination or search contract.
const AppError = require('../errors/AppError');

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_NUMBER = 1_000_000;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;

function validationDetails(path, code, message) {
  return [{ path, code, message }];
}

function semanticValidationError(message, details) {
  return new AppError(message, 422, details, 'VALIDATION_ERROR');
}

/**
 * Parses an integer query value that must stay inside the canonical bounds.
 * Absent values fall back to the endpoint default; malformed or out-of-range
 * values raise the canonical 422 validation error.
 */
function parseBoundedInteger(value, fallback, { min, max, path }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        path,
        'VALIDATION_ERROR',
        `${path} harus berupa bilangan bulat antara ${min} dan ${max}.`,
      ),
    );
  }
  return parsed;
}

/**
 * Normalizes a search term and enforces the canonical length bound.
 * Non-string input is treated as an absent search term, matching the other
 * list endpoints.
 */
function parseBoundedSearch(value, { maxLength = MAX_SEARCH_LENGTH, path = 'q' } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > maxLength) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        path,
        'VALIDATION_ERROR',
        `${path} maksimal ${maxLength} karakter.`,
      ),
    );
  }
  return text;
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  parseBoundedInteger,
  parseBoundedSearch,
  semanticValidationError,
  validationDetails,
};
