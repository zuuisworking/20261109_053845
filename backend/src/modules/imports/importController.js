const importService = require('./importService');
const AppError = require('../../shared/errors/AppError');

const ALLOWED_PREVIEW_FIELDS = new Set([
  'kind',
  'format',
  'encoding',
  'sheet',
  'mapping',
]);

function validationDetails(path, code, message) {
  return [{ path, code, message }];
}

function assertNoUnexpectedFields(body) {
  const unexpected = Object.keys(body || {}).filter(
    (field) => !ALLOWED_PREVIEW_FIELDS.has(field),
  );
  if (unexpected.length === 0) return;

  throw new AppError(
    'Permintaan tidak valid.',
    422,
    unexpected.flatMap((field) =>
      validationDetails(
        field,
        'UNEXPECTED_FIELD',
        `Field '${field}' tidak dikenal pada endpoint preview import.`,
      ),
    ),
    'UNEXPECTED_FIELD',
  );
}

function requireMultipartValue(body, field) {
  const value = body?.[field];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new AppError(
      `Part '${field}' wajib diisi pada multipart import.`,
      400,
      validationDetails(
        field,
        'REQUIRED',
        `Part '${field}' wajib diisi pada multipart import.`,
      ),
      'MALFORMED_MULTIPART',
    );
  }
  return String(value).trim();
}

function validateEnum(value, field, allowed) {
  const normalized = String(value).trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new AppError(
      'Permintaan tidak valid.',
      422,
      validationDetails(
        field,
        'VALIDATION_ERROR',
        `Field '${field}' harus salah satu dari: ${allowed.join(', ')}.`,
      ),
      'VALIDATION_ERROR',
    );
  }
  return normalized;
}

class ImportController {
  async preview(req, res, next) {
    try {
      if (!req.file) {
        throw new AppError(
          "Part 'file' wajib diisi pada multipart import.",
          400,
          validationDetails(
            'file',
            'REQUIRED',
            "Part 'file' wajib diisi pada multipart import.",
          ),
          'MALFORMED_MULTIPART',
        );
      }

      const body = req.body || {};
      assertNoUnexpectedFields(body);

      const kind = validateEnum(
        requireMultipartValue(body, 'kind'),
        'kind',
        ['transformer', 'customer'],
      );
      const format = validateEnum(
        requireMultipartValue(body, 'format'),
        'format',
        ['csv', 'xlsx'],
      );

      let encoding = null;
      if (body.encoding !== undefined && body.encoding !== null && body.encoding !== '') {
        encoding = validateEnum(body.encoding, 'encoding', [
          'utf-8-sig',
          'cp1252',
          'auto',
        ]);
      }
      if (encoding && format !== 'csv') {
        throw new AppError(
          'Permintaan tidak valid.',
          422,
          validationDetails(
            'encoding',
            'VALIDATION_ERROR',
            "Field 'encoding' hanya berlaku untuk CSV.",
          ),
          'VALIDATION_ERROR',
        );
      }

      let sheet = null;
      if (body.sheet !== undefined && body.sheet !== null && body.sheet !== '') {
        if (format !== 'xlsx') {
          throw new AppError(
            'Permintaan tidak valid.',
            422,
            validationDetails(
              'sheet',
              'VALIDATION_ERROR',
              "Field 'sheet' hanya berlaku untuk XLSX.",
            ),
            'VALIDATION_ERROR',
          );
        }
        sheet = String(body.sheet).trim();
      }

      const previewData = await importService.generatePreview(
        req.file,
        kind,
        req.user?._id,
        {
          format,
          encoding,
          sheet,
          mapping: body.mapping ?? null,
        },
      );

      res.status(201).json({ data: previewData });
    } catch (err) {
      next(err);
    }
  }

  async job(req, res, next) {
    try {
      const data = await importService.getImportJob(
        req.params.importJobId,
        req.user?._id,
        req.user?.role === 'superadmin',
      );
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  }

  async issues(req, res, next) {
    try {
      const result = await importService.getImportIssues(
        req.params.importJobId,
        req.user?._id,
        req.user?.role === 'superadmin',
        req.query,
      );
      res.status(200).json({ data: result.items, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async rows(req, res, next) {
    try {
      const result = await importService.getImportRows(
        req.params.importJobId,
        req.user?._id,
        req.user?.role === 'superadmin',
        req.query,
      );
      res.status(200).json({ data: result.items, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async commit(req, res, next) {
    try {
      const body = req.body || {};
      const allowedFields = new Set(['importJobId', 'previewToken']);
      const unexpected = Object.keys(body).filter(
        (field) => !allowedFields.has(field),
      );
      if (unexpected.length > 0) {
        throw new AppError(
          'Permintaan tidak valid.',
          422,
          unexpected.flatMap((field) =>
            validationDetails(
              field,
              'UNEXPECTED_FIELD',
              `Field '${field}' tidak dikenal pada endpoint commit import.`,
            ),
          ),
          'UNEXPECTED_FIELD',
        );
      }

      const importJobId =
        typeof body.importJobId === 'string' ? body.importJobId.trim() : '';
      const previewToken =
        typeof body.previewToken === 'string' ? body.previewToken.trim() : '';
      if (!importJobId || !previewToken) {
        const details = [];
        if (!importJobId) {
          details.push(
            validationDetails(
              'importJobId',
              'REQUIRED',
              "Field 'importJobId' wajib diisi.",
            ),
          );
        }
        if (!previewToken) {
          details.push(
            validationDetails(
              'previewToken',
              'REQUIRED',
              "Field 'previewToken' wajib diisi.",
            ),
          );
        }
        throw new AppError(
          'Permintaan tidak valid.',
          422,
          details,
          'VALIDATION_ERROR',
        );
      }

      const result = await importService.commitImport(
        { importJobId, previewToken },
        req.user?._id,
      );
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ImportController();
