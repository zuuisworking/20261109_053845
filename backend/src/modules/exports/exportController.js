const exportService = require('./exportService');

/**
 * Streams a generated export to the client.
 *
 * The export file is produced completely before the response starts, so any
 * generation failure (row ceiling, byte ceiling, concurrency rejection) is
 * raised before headers are sent and keeps the canonical error envelope.
 * Once the transfer starts, a failure aborts the response instead of
 * pretending that a truncated file is a complete export.
 */
function streamExportFile(res, file, next) {
  const safeFilename = file.filename.replace(/["\r\n]/g, '_');
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Content-Length', String(file.byteLength));
  res.setHeader('Cache-Control', 'no-store');

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    Promise.resolve(file.cleanup()).catch(() => undefined);
  };

  res.on('close', () => {
    file.stream.destroy();
    cleanup();
  });

  file.stream.on('error', (error) => {
    cleanup();
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.destroy(error);
      }
      return;
    }
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Disposition');
    res.removeHeader('Content-Length');
    next(error);
  });

  file.stream.pipe(res);
}

class ExportController {
  /**
   * Runs one export request. The response is watched while the export is
   * generated so a client that disconnects early releases the export slot and
   * the temporary file instead of blocking later exports.
   */
  async respondWithExport(res, next, produceExport) {
    let clientGone = false;
    const markClientGone = () => {
      clientGone = true;
    };
    res.on('close', markClientGone);

    let file;
    try {
      file = await produceExport();
    } catch (err) {
      res.off('close', markClientGone);
      next(err);
      return;
    }

    res.off('close', markClientGone);

    if (clientGone || res.destroyed || res.writableEnded) {
      await file.cleanup();
      return;
    }

    try {
      streamExportFile(res, file, next);
    } catch (err) {
      await file.cleanup();
      next(err);
    }
  }

  async exportTransformers(req, res, next) {
    const { format, view, period } = req.query;
    await this.respondWithExport(res, next, () =>
      exportService.exportTransformers({ format, view, period })
    );
  }

  async exportCustomers(req, res, next) {
    const { format } = req.query;
    await this.respondWithExport(res, next, () => exportService.exportCustomers({ format }));
  }

  async exportGuests(req, res, next) {
    const { format } = req.query;
    await this.respondWithExport(res, next, () => exportService.exportGuests({ format }));
  }
}

module.exports = new ExportController();
module.exports.streamExportFile = streamExportFile;
