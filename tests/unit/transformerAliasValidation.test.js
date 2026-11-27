const mongoose = require('mongoose');
const { assertValid } = require('../../backend/src/shared/validation');
const {
  transformerAliasWriteSchema,
} = require('../../backend/src/shared/validation/transformerAliasSchemas');
const {
  parseBoundedInteger,
  parseBoundedSearch,
} = require('../../backend/src/shared/validation/canonicalQueryParams');
const { normalizeNameKey } = require('../../backend/src/shared/utils/nameKey');
const TransformerAlias = require('../../backend/src/modules/transformers/transformerAliasModel');
const transformerAliasService = require('../../backend/src/modules/transformers/transformerAliasService');
const AppError = require('../../backend/src/shared/errors/AppError');

function captureError(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Diharapkan fungsi melempar error.');
}

async function validateDocument(document) {
  try {
    await document.validate();
    return null;
  } catch (error) {
    return error;
  }
}

function buildAliasDocument(overrides = {}) {
  return new TransformerAlias({
    aliasName: 'PDAM TIRTANADI',
    aliasKey: 'diabaikan-oleh-model',
    transformerId: new mongoose.Types.ObjectId(),
    reason: 'Persetujuan operator tersimpan.',
    approvedBy: new mongoose.Types.ObjectId(),
    approvedAt: new Date(),
    source: 'static-html',
    sourceVersion: 'protected-html-v1',
    ...overrides,
  });
}

describe('transformer alias write schema', () => {
  it('accepts a valid alias write payload', () => {
    const payload = {
      aliasName: 'PDAM TIRTANADI',
      transformerId: new mongoose.Types.ObjectId().toString(),
      reason: 'Disetujui operator setelah verifikasi lapangan.',
      sourceVersion: 'protected-html-v2',
    };

    expect(() => assertValid(transformerAliasWriteSchema, payload)).not.toThrow();
  });

  it('rejects unknown fields with the canonical unexpected-field envelope', () => {
    const error = captureError(() =>
      assertValid(transformerAliasWriteSchema, {
        aliasName: 'PDAM TIRTANADI',
        transformerId: new mongoose.Types.ObjectId().toString(),
        reason: 'Disetujui operator setelah verifikasi lapangan.',
        source: 'operator',
        aliasKey: 'alias-dibuat-pelanggan',
      }),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('UNEXPECTED_FIELD');
    expect(error.message).toBe('Permintaan tidak valid.');
    expect(error.details.map((detail) => detail.path)).toEqual(
      expect.arrayContaining(['aliasKey', 'source']),
    );
  });

  it('rejects wrong types and overlong values', () => {
    const invalidPayloads = [
      { aliasName: 123, transformerId: new mongoose.Types.ObjectId().toString(), reason: 'ok' },
      { aliasName: 'Alias', transformerId: 12345, reason: 'ok' },
      { aliasName: 'Alias', transformerId: new mongoose.Types.ObjectId().toString(), reason: {} },
      {
        aliasName: 'Alias',
        transformerId: new mongoose.Types.ObjectId().toString(),
        reason: 'ok',
        sourceVersion: { version: 'v2' },
      },
      {
        aliasName: 'A'.repeat(201),
        transformerId: new mongoose.Types.ObjectId().toString(),
        reason: 'ok',
      },
      {
        aliasName: 'Alias',
        transformerId: new mongoose.Types.ObjectId().toString(),
        reason: 'B'.repeat(1001),
      },
      {
        aliasName: 'Alias',
        transformerId: new mongoose.Types.ObjectId().toString(),
        reason: 'ok',
        sourceVersion: 'v'.repeat(101),
      },
    ];

    for (const payload of invalidPayloads) {
      const error = captureError(() => assertValid(transformerAliasWriteSchema, payload));
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details.length).toBeGreaterThan(0);
    }
  });
});

describe('canonical alias list query validation', () => {
  it('rejects malformed pagination values with the canonical 422 envelope', () => {
    for (const value of ['abc', '0', '-1', '1.5', '1000001']) {
      const error = captureError(() =>
        parseBoundedInteger(value, 1, { min: 1, max: 1_000_000, path: 'page' }),
      );
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details[0]).toMatchObject({ path: 'page', code: 'VALIDATION_ERROR' });
    }

    expect(parseBoundedInteger(undefined, 1, { min: 1, max: 1_000_000, path: 'page' })).toBe(1);
    expect(parseBoundedInteger('2', 1, { min: 1, max: 1_000_000, path: 'page' })).toBe(2);
  });

  it('bounds the page size to the canonical range', () => {
    for (const value of ['0', '101', 'abc']) {
      const error = captureError(() =>
        parseBoundedInteger(value, 20, { min: 1, max: 100, path: 'pageSize' }),
      );
      expect(error.statusCode).toBe(422);
      expect(error.details[0].path).toBe('pageSize');
    }

    expect(parseBoundedInteger('100', 20, { min: 1, max: 100, path: 'pageSize' })).toBe(100);
  });

  it('bounds the search term to 100 characters', () => {
    const error = captureError(() => parseBoundedSearch('x'.repeat(101)));
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details[0]).toMatchObject({ path: 'q', code: 'VALIDATION_ERROR' });

    expect(parseBoundedSearch('x'.repeat(100))).toBe('x'.repeat(100));
    expect(parseBoundedSearch('  PDAM  ')).toBe('PDAM');
    expect(parseBoundedSearch(undefined)).toBe('');
    expect(parseBoundedSearch(['PDAM'])).toBe('');
  });
});

describe('transformer alias service normalization', () => {
  it('rejects a structured source version instead of stringifying it', () => {
    const error = captureError(() => transformerAliasService.normalizeSourceVersion({ v: 2 }));
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(422);
    expect(error.details[0].path).toBe('sourceVersion');

    expect(transformerAliasService.normalizeSourceVersion(undefined)).toBe('protected-html-v1');
    expect(transformerAliasService.normalizeSourceVersion(' protected-html-v2 ')).toBe(
      'protected-html-v2',
    );
  });

  it('normalizes the alias display name on the canonical Unicode path', () => {
    expect(transformerAliasService.normalizeAliasName('  PDAM TIRTANADI  ')).toBe(
      'PDAM TIRTANADI',
    );
    expect(transformerAliasService.normalizeAliasName('é')).toBe('é');

    const typeError = captureError(() => transformerAliasService.normalizeAliasName(123));
    expect(typeError.statusCode).toBe(422);
    expect(typeError.details[0].path).toBe('aliasName');

    const emptyError = captureError(() => transformerAliasService.normalizeAliasName('   '));
    expect(emptyError.statusCode).toBe(422);
    expect(emptyError.details[0].path).toBe('aliasName');
  });
});

describe('transformer alias model defenses', () => {
  it('keeps the canonical field bounds on the model', () => {
    expect(TransformerAlias.schema.path('aliasName').options.maxlength[0]).toBe(200);
    expect(TransformerAlias.schema.path('aliasKey').options.maxlength[0]).toBe(600);
    expect(TransformerAlias.schema.path('reason').options.maxlength[0]).toBe(1000);
    expect(TransformerAlias.schema.path('source').options.maxlength[0]).toBe(64);
    expect(TransformerAlias.schema.path('sourceVersion').options.maxlength[0]).toBe(100);
  });

  it('rejects values outside the model bounds', async () => {
    const longVersion = buildAliasDocument({ sourceVersion: 'v'.repeat(101) });
    const versionError = await validateDocument(longVersion);
    expect(versionError).toBeTruthy();
    expect(versionError.name).toBe('ValidationError');
    expect(versionError.errors['sourceVersion']).toBeTruthy();

    const longName = buildAliasDocument({ aliasName: 'A'.repeat(201) });
    expect(await validateDocument(longName)).toBeTruthy();
  });

  it('derives the alias key with the shared full-fold identity path', async () => {
    const alias = buildAliasDocument({ aliasName: 'PDAM TIRTANADI' });
    expect(await validateDocument(alias)).toBeNull();
    expect(alias.aliasKey).toBe(normalizeNameKey('PDAM TIRTANADI'));

    // Full case folding expands a code point, so the key is longer than the
    // display name and must not be rewritten by a lowercase transform.
    const sharpS = buildAliasDocument({ aliasName: 'Straße' });
    expect(await validateDocument(sharpS)).toBeNull();
    expect(sharpS.aliasKey).toBe('strasse');

    const cherokee = buildAliasDocument({ aliasName: 'ᏸᏲᏫᏳᏴ' });
    expect(await validateDocument(cherokee)).toBeNull();
    expect(cherokee.aliasKey).toBe(normalizeNameKey('ᏸᏲᏫᏳᏴ'));
  });

  it('accepts the longest folded key derived from a 200 character display name', async () => {
    const alias = buildAliasDocument({ aliasName: 'ﬃ'.repeat(200) });
    expect(await validateDocument(alias)).toBeNull();
    expect(alias.aliasKey).toHaveLength(600);
  });
});
