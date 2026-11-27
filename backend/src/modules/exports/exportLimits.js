const { Transform } = require('stream');
const AppError = require('../../shared/errors/AppError');

/**
 * Resource guards for the export endpoints.
 *
 * Exports are generated into a bounded temporary file and then streamed to the
 * client, so neither the row ceiling nor the byte ceiling can be bypassed by
 * wide rows. The byte ceiling is enforced while the file is written, which
 * keeps both process memory and temporary-disk usage bounded.
 */

const DEFAULT_MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const MAX_ALLOWED_EXPORT_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_EXPORTS = 2;
const MAX_ALLOWED_CONCURRENT_EXPORTS = 64;

const EXPORT_TOO_LARGE_CODE = 'EXPORT_TOO_LARGE';
const EXPORT_CONCURRENCY_CODE = 'RATE_LIMITED';

function formatByteLimit(bytes) {
  if (bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0) {
    return `${bytes} byte (${bytes / (1024 * 1024)} MiB)`;
  }
  if (bytes >= 1024 && bytes % 1024 === 0) {
    return `${bytes} byte (${bytes / 1024} KiB)`;
  }
  return `${bytes} byte`;
}

function resolveMaxExportBytes(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_EXPORT_BYTES;
  }
  return Math.min(parsed, MAX_ALLOWED_EXPORT_BYTES);
}

function resolveMaxConcurrentExports(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_CONCURRENT_EXPORTS;
  }
  return Math.min(parsed, MAX_ALLOWED_CONCURRENT_EXPORTS);
}

/**
 * Pass-through transform that fails the export as soon as the produced byte
 * count exceeds the configured ceiling. It never buffers the whole payload.
 */
class ByteLimitTransform extends Transform {
  constructor(maxBytes) {
    super();
    this.maxBytes = maxBytes;
    this.bytesWritten = 0;
  }

  _transform(chunk, encoding, callback) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    const nextTotal = this.bytesWritten + buffer.length;

    if (nextTotal > this.maxBytes) {
      callback(
        new AppError(
          `Ukuran file ekspor melebihi batas ${formatByteLimit(this.maxBytes)}. Ekspor dibatalkan tanpa pemotongan data.`,
          422,
          { maxBytes: this.maxBytes },
          EXPORT_TOO_LARGE_CODE
        )
      );
      return;
    }

    this.bytesWritten = nextTotal;
    callback(null, buffer);
  }
}

/**
 * Fail-fast guard for concurrent export generation. The limit is read per
 * request so operators can tune it without restarting the process.
 */
class ExportConcurrencyLimiter {
  constructor() {
    this.active = 0;
    this.peak = 0;
  }

  get activeCount() {
    return this.active;
  }

  get peakActiveCount() {
    return this.peak;
  }

  tryAcquire(limit) {
    const max = resolveMaxConcurrentExports(limit);
    if (this.active >= max) {
      return false;
    }
    this.active += 1;
    if (this.active > this.peak) {
      this.peak = this.active;
    }
    return true;
  }

  release() {
    if (this.active > 0) {
      this.active -= 1;
    }
  }
}

module.exports = {
  ByteLimitTransform,
  ExportConcurrencyLimiter,
  DEFAULT_MAX_EXPORT_BYTES,
  MAX_ALLOWED_EXPORT_BYTES,
  DEFAULT_MAX_CONCURRENT_EXPORTS,
  MAX_ALLOWED_CONCURRENT_EXPORTS,
  EXPORT_TOO_LARGE_CODE,
  EXPORT_CONCURRENCY_CODE,
  formatByteLimit,
  resolveMaxExportBytes,
  resolveMaxConcurrentExports,
};
