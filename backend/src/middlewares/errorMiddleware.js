const AppError = require('../shared/errors/AppError');

const DEFAULT_ERROR_CODES = new Map([
  [400, 'VALIDATION_ERROR'],
  [401, 'UNAUTHENTICATED'],
  [403, 'FORBIDDEN'],
  [404, 'RESOURCE_NOT_FOUND'],
  [405, 'METHOD_NOT_ALLOWED'],
  [409, 'DUPLICATE_RESOURCE'],
  [413, 'PAYLOAD_TOO_LARGE'],
  [415, 'UNSUPPORTED_MEDIA_TYPE'],
  [422, 'VALIDATION_ERROR'],
  [429, 'RATE_LIMITED'],
  [500, 'INTERNAL_ERROR'],
  [502, 'UPSTREAM_INVALID_RESPONSE'],
  [503, 'DEPENDENCY_UNAVAILABLE'],
  [504, 'UPSTREAM_TIMEOUT'],
]);

function resolveErrorCode(normalized, statusCode) {
  if (normalized?.code) return normalized.code;
  return DEFAULT_ERROR_CODES.get(statusCode) || 'REQUEST_FAILED';
}

function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error?.code === 11000) {
    const field = Object.keys(error.keyValue || {})[0] || 'field';
    return new AppError(
      `Nilai untuk field '${field}' sudah digunakan dalam database.`,
      409,
      null,
      'DUPLICATE_RESOURCE'
    );
  }

  if (error?.name === 'ValidationError' && error.errors) {
    const messages = Object.values(error.errors).map((item) => item.message);
    return new AppError(
      `Validasi gagal: ${messages.join(', ')}`,
      400,
      null,
      'DATABASE_VALIDATION_ERROR'
    );
  }

  if (error?.name === 'CastError') {
    return new AppError(
      'Format identifier tidak valid.',
      400,
      null,
      'INVALID_IDENTIFIER'
    );
  }

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return new AppError(
      'Ukuran file melebihi batas yang diizinkan.',
      413,
      null,
      'PAYLOAD_TOO_LARGE'
    );
  }

  if (error?.code === 'LIMIT_UNEXPECTED_FILE' || error?.code === 'LIMIT_FILE_COUNT') {
    return new AppError(
      'Permintaan file tidak valid.',
      400,
      null,
      'MALFORMED_MULTIPART'
    );
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return new AppError(
      'Format JSON tidak valid.',
      400,
      null,
      'MALFORMED_JSON'
    );
  }

  return null;
}

function errorMiddleware(error, req, res, _next) {
  const normalized = normalizeError(error);
  const isOperational = normalized?.isOperational === true;
  const statusCode = normalized?.statusCode || error.statusCode || 500;

  if (!normalized || statusCode >= 500) {
    console.error('[API Error]', {
      method: req.method,
      path: req.originalUrl,
      message: error.message,
      stack: error.stack,
    });
  }

  const message = isOperational
    ? normalized.message
    : 'Terjadi kesalahan internal pada server.';
  const code = resolveErrorCode(normalized, statusCode);

  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(normalized?.details && { details: normalized.details }),
    },
  });
}

module.exports = errorMiddleware;
