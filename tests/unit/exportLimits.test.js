const { Readable, Writable } = require('stream');
const { pipeline } = require('stream/promises');
const {
  ByteLimitTransform,
  ExportConcurrencyLimiter,
  DEFAULT_MAX_EXPORT_BYTES,
  DEFAULT_MAX_CONCURRENT_EXPORTS,
  EXPORT_TOO_LARGE_CODE,
  resolveMaxExportBytes,
  resolveMaxConcurrentExports,
} = require('../../backend/src/modules/exports/exportLimits');

class Collector extends Writable {
  constructor() {
    super();
    this.chunks = [];
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  get bytes() {
    return Buffer.concat(this.chunks).length;
  }
}

describe('export output byte ceiling', () => {
  it('streams payloads that stay below the ceiling unchanged', async () => {
    const limiter = new ByteLimitTransform(8);
    const collector = new Collector();

    await pipeline(
      Readable.from([Buffer.alloc(4), Buffer.alloc(4)]),
      limiter,
      collector
    );

    expect(collector.bytes).toBe(8);
    expect(limiter.bytesWritten).toBe(8);
  });

  it('fails the export with the canonical error once the ceiling is exceeded', async () => {
    const limiter = new ByteLimitTransform(8);
    const collector = new Collector();

    const error = await pipeline(
      Readable.from([Buffer.alloc(4), Buffer.alloc(8)]),
      limiter,
      collector
    ).then(
      () => null,
      (pipelineError) => pipelineError
    );

    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe(EXPORT_TOO_LARGE_CODE);
    expect(error.isOperational).toBe(true);
    expect(error.message).toContain('melebihi batas');
    expect(error.details).toEqual({ maxBytes: 8 });
  });

  it('falls back to the documented defaults for invalid configuration', () => {
    expect(resolveMaxExportBytes(undefined)).toBe(DEFAULT_MAX_EXPORT_BYTES);
    expect(resolveMaxExportBytes('not-a-number')).toBe(DEFAULT_MAX_EXPORT_BYTES);
    expect(resolveMaxExportBytes(0)).toBe(DEFAULT_MAX_EXPORT_BYTES);
    expect(resolveMaxExportBytes(-1)).toBe(DEFAULT_MAX_EXPORT_BYTES);
    expect(resolveMaxExportBytes(4096)).toBe(4096);

    expect(resolveMaxConcurrentExports(undefined)).toBe(DEFAULT_MAX_CONCURRENT_EXPORTS);
    expect(resolveMaxConcurrentExports(0)).toBe(DEFAULT_MAX_CONCURRENT_EXPORTS);
    expect(resolveMaxConcurrentExports(5)).toBe(5);
  });
});

describe('export concurrency limiter', () => {
  it('rejects acquisitions above the limit and frees them on release', () => {
    const limiter = new ExportConcurrencyLimiter();

    expect(limiter.tryAcquire(2)).toBe(true);
    expect(limiter.tryAcquire(2)).toBe(true);
    expect(limiter.activeCount).toBe(2);

    expect(limiter.tryAcquire(2)).toBe(false);
    expect(limiter.activeCount).toBe(2);

    limiter.release();
    expect(limiter.activeCount).toBe(1);
    expect(limiter.tryAcquire(2)).toBe(true);
    expect(limiter.activeCount).toBe(2);
    expect(limiter.peakActiveCount).toBe(2);
  });

  it('never tracks a negative number of running exports', () => {
    const limiter = new ExportConcurrencyLimiter();

    limiter.release();
    expect(limiter.activeCount).toBe(0);
    expect(limiter.tryAcquire(1)).toBe(true);
  });
});
