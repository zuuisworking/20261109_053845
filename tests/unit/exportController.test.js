const { Readable, Writable } = require('stream');
const exportController = require('../../backend/src/modules/exports/exportController');
const exportService = require('../../backend/src/modules/exports/exportService');

class FakeResponse extends Writable {
  constructor() {
    super();
    this.headers = {};
    this.headersSent = false;
    this.writtenChunks = [];
    this.destroyReason = null;
  }

  _write(chunk, _encoding, callback) {
    this.headersSent = true;
    this.writtenChunks.push(Buffer.from(chunk));
    callback();
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  removeHeader(name) {
    delete this.headers[name];
  }

  destroy(error) {
    this.destroyReason = error || new Error('response destroyed');
    super.destroy(error);
  }
}

function createExportFile(overrides = {}) {
  return {
    contentType: 'text/csv; charset=utf-8',
    filename: 'SIGAP_Data_Uji.csv',
    byteLength: 3,
    stream: Readable.from([Buffer.from('a;b')]),
    cleanup: async () => undefined,
    ...overrides,
  };
}

describe('export controller resource handling', () => {
  const originalExportCustomers = exportService.exportCustomers;

  afterEach(() => {
    exportService.exportCustomers = originalExportCustomers;
  });

  it('releases the export resources when the client disconnects before the download starts', async () => {
    let releaseExport;
    const exportStarted = new Promise((resolve) => {
      releaseExport = resolve;
    });
    let cleanupCalls = 0;

    exportService.exportCustomers = async () => {
      const file = createExportFile({
        cleanup: async () => {
          cleanupCalls += 1;
        },
      });
      releaseExport();
      return file;
    };

    const res = new FakeResponse();
    const next = () => {
      throw new Error('next() must not be called for a disconnected client');
    };

    const request = exportController.exportCustomers({ query: { format: 'csv' } }, res, next);
    await exportStarted;
    res.emit('close');
    await request;

    expect(cleanupCalls).toBe(1);
  });

  it('uses the canonical error path when the file stream fails before the first byte', async () => {
    const failure = new Error('read failure');
    const file = createExportFile({
      stream: new Readable({
        read() {
          this.destroy(failure);
        },
      }),
    });

    exportService.exportCustomers = async () => file;

    const res = new FakeResponse();
    let nextError = null;

    await exportController.exportCustomers(
      { query: { format: 'csv' } },
      res,
      (error) => {
        nextError = error;
      }
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(res.headersSent).toBe(false);
    expect(nextError).toBe(failure);
  });

  it('aborts the transfer instead of pretending success when the stream fails mid-download', async () => {
    const failure = new Error('mid-download failure');
    const stream = Readable.from(
      (async function* failingStream() {
        yield Buffer.from('a;b');
        throw failure;
      })()
    );
    const file = createExportFile({ stream });

    exportService.exportCustomers = async () => file;

    const res = new FakeResponse();
    res.on('error', () => undefined);
    let nextError = null;

    await exportController.exportCustomers(
      { query: { format: 'csv' } },
      res,
      (error) => {
        nextError = error;
      }
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(res.headersSent).toBe(true);
    expect(res.destroyReason).toBe(failure);
    expect(nextError).toBeNull();
  });
});
