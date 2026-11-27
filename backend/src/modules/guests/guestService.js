const crypto = require('crypto');
const GuestVisit = require('./guestModel');
const config = require('../../config');
const AppError = require('../../shared/errors/AppError');
const { guestSyncCoordinator } = require('./guestSyncCoordinator');

const UPSTREAM_TIMEOUT_MS = 10000;
const MAX_UPSTREAM_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const DATABASE_BATCH_SIZE = 500;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE_NUMBER = 10000;
const MAX_INVALID_SAMPLES = 100;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validationDetails(path, code, message) {
  return [{ path, code, message }];
}

function semanticValidationError(message, details) {
  return new AppError(message, 422, details, 'VALIDATION_ERROR');
}

function parseBoundedInteger(value, fallback, minimum, maximum, path) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        path,
        'VALIDATION_ERROR',
        `${path} harus berupa bilangan bulat antara ${minimum} dan ${maximum}.`,
      ),
    );
  }
  return parsed;
}

function isPlaceholder(value) {
  if (value === undefined || value === null) return true;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '' || normalized === '-' || normalized === 'n/a' || normalized === 'null';
}

function sourceText(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'text')) {
      return String(value.text).trim();
    }
  }
  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeSourceTimestamp(value) {
  if (value === null || value === undefined) {
    return { timestamp: null, timestampRaw: null };
  }

  const timestampRaw = String(value).trim();
  if (!timestampRaw) return { timestamp: null, timestampRaw: null };

  const parsed = new Date(timestampRaw);
  if (Number.isNaN(parsed.getTime())) {
    return { timestamp: null, timestampRaw };
  }
  return { timestamp: parsed, timestampRaw };
}

function pickSourceValue(item, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(item, key)) {
      const value = sourceText(item[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function normalizeAllowedHosts() {
  const configuredHosts = config.googleFormAllowedHosts;
  if (Array.isArray(configuredHosts) && configuredHosts.length > 0) {
    return new Set(
      configuredHosts
        .map((entry) => {
          const value = String(entry || '').trim().toLowerCase();
          if (!value) return null;
          if (value.includes('://')) {
            try {
              return new URL(value).hostname.toLowerCase();
            } catch (_error) {
              return null;
            }
          }
          return value;
        })
        .filter(Boolean)
    );
  }

  return new Set(['script.google.com']);
}

function validateGoogleFormUrl(rawUrl, allowedHosts) {
  if (!rawUrl || !String(rawUrl).trim()) {
    throw new AppError(
      'Integrasi Google Form belum dikonfigurasi di server.',
      503
    );
  }

  if (/placeholder|url_apps_script_kamu/i.test(String(rawUrl))) {
    throw new AppError(
      'Integrasi Google Form belum dikonfigurasi di server.',
      503
    );
  }

  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch (_error) {
    throw new AppError('URL Google Apps Script yang dikonfigurasi tidak valid.', 503);
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError('URL Google Apps Script harus menggunakan HTTPS.', 503);
  }
  if (parsed.username || parsed.password) {
    throw new AppError('URL Google Apps Script tidak boleh memuat kredensial.', 503);
  }
  if (parsed.port && parsed.port !== '443') {
    throw new AppError('URL Google Apps Script harus menggunakan port HTTPS standar.', 503);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) {
    throw new AppError('Host Google Apps Script tidak berada dalam allowlist server.', 503);
  }

  if (hostname === 'script.google.com') {
    const validPath = /^\/macros\/(?:s\/[^/]+\/)?exec\/?$/i.test(parsed.pathname);
    if (!validPath) {
      throw new AppError(
        'URL Google Apps Script harus berbentuk /macros/.../exec.',
        503
      );
    }
  } else if (!/\/exec\/?$/i.test(parsed.pathname)) {
    throw new AppError('URL integrasi yang diizinkan harus berakhiran /exec.', 503);
  }

  return parsed;
}

function validateRedirectUrl(location, currentUrl, allowedHosts) {
  if (!location) {
    throw new AppError('Upstream mengembalikan redirect tanpa tujuan yang valid.', 502);
  }

  let target;
  try {
    target = new URL(location, currentUrl);
  } catch (_error) {
    throw new AppError('Upstream mengembalikan tujuan redirect yang tidak valid.', 502);
  }

  if (target.protocol !== 'https:' || target.username || target.password) {
    throw new AppError('Upstream mencoba redirect ke tujuan yang tidak aman.', 502);
  }
  if (target.port && target.port !== '443') {
    throw new AppError('Upstream mencoba redirect ke port yang tidak aman.', 502);
  }

  const hostname = target.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) {
    throw new AppError('Upstream mencoba redirect ke host yang tidak diizinkan.', 502);
  }

  if (hostname === 'script.google.com' && !/\/macros\/(?:s\/[^/]+\/)?exec\/?$/i.test(target.pathname)) {
    throw new AppError('Upstream mencoba redirect ke endpoint yang tidak aman.', 502);
  }

  return target;
}

async function fetchWithSafeRedirects(initialUrl, allowedHosts, signal) {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal,
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount >= MAX_REDIRECTS) {
        throw new AppError('Upstream terlalu banyak melakukan redirect.', 502);
      }
      currentUrl = validateRedirectUrl(
        response.headers.get('location'),
        currentUrl,
        allowedHosts
      );
      continue;
    }

    return response;
  }

  throw new AppError('Upstream terlalu banyak melakukan redirect.', 502);
}

async function readLimitedResponse(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPSTREAM_RESPONSE_BYTES) {
    throw new AppError('Respons Google Apps Script melebihi batas ukuran yang diizinkan.', 502);
  }
  if (!response.body) {
    throw new AppError('Respons Google Apps Script tidak memiliki body.', 502);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_UPSTREAM_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AppError('Respons Google Apps Script melebihi batas ukuran yang diizinkan.', 502);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Gagal membaca respons Google Apps Script.', 502);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function serializeGuest(guest) {
  const source =
    guest && typeof guest.toObject === 'function' ? guest.toObject() : guest || {};
  return {
    id: String(source._id),
    guestName: source.guestName ?? null,
    phone: source.phone ?? null,
    customerId: source.customerId ?? null,
    purpose: source.purpose ?? null,
    timestamp: source.timestamp ? new Date(source.timestamp).toISOString() : null,
    timestampRaw: source.timestampRaw ?? null,
    source: source.source ?? null,
    syncedAt: source.syncedAt ? new Date(source.syncedAt).toISOString() : null,
    syncFingerprint: source.syncFingerprint ?? null,
    sourceRecordId: source.sourceRecordId ?? null,
    createdAt: source.createdAt ? new Date(source.createdAt).toISOString() : null,
    updatedAt: source.updatedAt ? new Date(source.updatedAt).toISOString() : null,
  };
}

class GuestService {
  generateFingerprint(timestamp, name, phone) {
    const canonicalTimestamp = String(timestamp || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const canonicalName = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const canonicalPhone = String(phone || '').replace(/\D/g, '');
    const fields = [canonicalTimestamp, canonicalName, canonicalPhone].map((field) => {
      const byteLength = Buffer.byteLength(field, 'utf8');
      return `${byteLength}:${field}`;
    });
    const raw = `v2|${fields.join('|')}`;
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  async getGuests({ search = '', q = '', page = 1, limit, pageSize } = {}) {
    const searchTerm = String(q || search || '').trim();
    const pageNumber = parseBoundedInteger(page, 1, 1, MAX_PAGE_NUMBER, 'page');
    const pageSizeValue = parseBoundedInteger(
      limit ?? pageSize,
      DEFAULT_PAGE_SIZE,
      1,
      MAX_PAGE_SIZE,
      'pageSize'
    );

    const query = {};
    if (searchTerm.length > 100) {
      throw semanticValidationError(
        'Permintaan tidak valid.',
        validationDetails('q', 'VALIDATION_ERROR', 'q maksimal 100 karakter.'),
      );
    }
    if (searchTerm) {
      const escaped = escapeRegExp(searchTerm);
      const literalPattern = new RegExp(escaped, 'i');
      const clauses = [
        { guestName: literalPattern },
        { phone: literalPattern },
        { purpose: literalPattern },
      ];
      if (/^\d+$/.test(searchTerm)) {
        clauses.push({ customerId: searchTerm });
      }
      query.$or = clauses;
    }

    const skip = (pageNumber - 1) * pageSizeValue;
    const [items, totalItems] = await Promise.all([
      GuestVisit.find(query)
        .sort({ timestamp: -1, _id: -1 })
        .skip(skip)
        .limit(pageSizeValue)
        .lean(),
      GuestVisit.countDocuments(query),
    ]);

    return {
      items: items.map(serializeGuest),
      meta: {
        page: pageNumber,
        pageSize: pageSizeValue,
        total: totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSizeValue),
      },
    };
  }

  /**
   * Runs one guest synchronization at a time.
   *
   * Concurrent callers join the active upstream fetch and database upsert and
   * receive the same result, so a burst of requests cannot multiply upstream
   * traffic or duplicate writes. A failed operation releases the slot and the
   * next request retries from scratch.
   */
  async syncFromGoogleForm() {
    return guestSyncCoordinator.run(() => this.runSyncFromGoogleForm());
  }

  async runSyncFromGoogleForm() {
    const allowedHosts = normalizeAllowedHosts();
    const configuredUrl = validateGoogleFormUrl(config.googleFormUrl, allowedHosts);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let responseText;
    try {
      const response = await fetchWithSafeRedirects(
        configuredUrl,
        allowedHosts,
        controller.signal
      );
      if (!response.ok) {
        throw new AppError(
          `Gagal mengambil data dari Google Apps Script: HTTP ${response.status}.`,
          502
        );
      }
      responseText = await readLimitedResponse(response);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (controller.signal.aborted) {
        throw new AppError(
          'Google Apps Script tidak merespons sebelum batas waktu.',
          504,
          null,
          'UPSTREAM_TIMEOUT'
        );
      }
      throw new AppError('Gagal menghubungi Google Apps Script.', 502);
    } finally {
      clearTimeout(timeout);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (_error) {
      throw new AppError('Format respon Google Apps Script bukan JSON yang valid.', 502);
    }

    if (!Array.isArray(data)) {
      throw new AppError(
        'Format respon Google Apps Script tidak valid (harus berupa JSON Array).',
        502
      );
    }

    const validRecords = new Map();
    const invalidRows = [];
    let invalidCount = 0;
    let duplicatesInFile = 0;

    data.forEach((item, index) => {
      const rowNumber = index + 1;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        invalidCount += 1;
        if (invalidRows.length < MAX_INVALID_SAMPLES) {
          invalidRows.push({
            rowNumber,
            errors: [{ field: 'record', code: 'INVALID_RECORD', message: 'Record harus berupa object.' }],
          });
        }
        return;
      }

      const timestampValue = pickSourceValue(item, [
        'Timestamp',
        'timestamp',
        'waktu',
        'Waktu Kunjungan',
      ]);
      const sourceRecordIdValue = pickSourceValue(item, [
        'ID Tamu',
        'sourceRecordId',
        'recordId',
      ]);
      const guestNameValue = pickSourceValue(item, [
        'Nama Tamu',
        'nama',
        'nama_tamu',
        'guestName',
      ]);
      const phoneValue = pickSourceValue(item, [
        'No HP',
        'no_hp',
        'hp',
        'nomor_hp',
        'phone',
      ]);
      const customerIdValue = pickSourceValue(item, [
        'ID Pelanggan',
        'id_pelanggan',
        'idpel',
        'customerId',
      ]);
      const purposeValue = pickSourceValue(item, [
        'Keperluan',
        'keperluan',
        'purpose',
      ]);

      const timestampSource = isPlaceholder(timestampValue)
        ? { timestamp: null, timestampRaw: null }
        : normalizeSourceTimestamp(timestampValue);
      const timestamp = timestampSource.timestamp;
      const timestampRaw = timestampSource.timestampRaw;
      const sourceRecordId = isPlaceholder(sourceRecordIdValue)
        ? null
        : sourceRecordIdValue;
      const guestName = isPlaceholder(guestNameValue) ? null : guestNameValue;
      const phone = isPlaceholder(phoneValue) ? null : phoneValue;
      const customerId = isPlaceholder(customerIdValue) ? null : customerIdValue;
      const purpose = isPlaceholder(purposeValue) ? null : purposeValue;
      const errors = [];

      if (!guestName) {
        errors.push({ field: 'guestName', code: 'REQUIRED', message: 'Nama tamu wajib diisi.' });
      } else if (guestName.length > 200) {
        errors.push({ field: 'guestName', code: 'TOO_LONG', message: 'Nama tamu terlalu panjang.' });
      }

      if (!phone) {
        errors.push({ field: 'phone', code: 'REQUIRED', message: 'Nomor HP wajib diisi.' });
      } else {
        const phoneDigits = phone.replace(/\D/g, '');
        if (phoneDigits.length < 9 || phoneDigits.length > 15) {
          errors.push({
            field: 'phone',
            code: 'INVALID_PHONE',
            message: 'Nomor HP harus terdiri dari 9 sampai 15 digit.',
          });
        }
      }

      if (!purpose) {
        errors.push({ field: 'purpose', code: 'REQUIRED', message: 'Keperluan wajib diisi.' });
      } else if (purpose.length > 1000) {
        errors.push({ field: 'purpose', code: 'TOO_LONG', message: 'Keperluan terlalu panjang.' });
      }

      if (customerId && customerId.length > 64) {
        errors.push({
          field: 'customerId',
          code: 'TOO_LONG',
          message: 'ID Pelanggan terlalu panjang.',
        });
      }
      if (timestampRaw && timestampRaw.length > 100) {
        errors.push({
          field: 'timestamp',
          code: 'TOO_LONG',
          message: 'Waktu kunjungan terlalu panjang.',
        });
      }

      if (errors.length > 0) {
        invalidCount += 1;
        if (invalidRows.length < MAX_INVALID_SAMPLES) {
          invalidRows.push({ rowNumber, errors });
        }
        return;
      }

      const syncFingerprint = this.generateFingerprint(timestampRaw, guestName, phone);
      if (validRecords.has(syncFingerprint)) {
        duplicatesInFile += 1;
        return;
      }

      validRecords.set(syncFingerprint, {
        syncFingerprint,
        timestamp,
        timestampRaw,
        sourceRecordId,
        guestName,
        phone,
        customerId,
        purpose,
        source: 'google_form',
        syncedAt: new Date(),
      });
    });

    const candidateRecords = Array.from(validRecords.values());
    const existingFingerprints = await this.findExistingFingerprints(
      candidateRecords.map((record) => record.syncFingerprint)
    );

    const operations = candidateRecords.map((record) => ({
      updateOne: {
        filter: { syncFingerprint: record.syncFingerprint },
        update: { $setOnInsert: record },
        upsert: true,
      },
    }));

    for (let offset = 0; offset < operations.length; offset += DATABASE_BATCH_SIZE) {
      const batch = operations.slice(offset, offset + DATABASE_BATCH_SIZE);
      try {
        await GuestVisit.bulkWrite(batch, { ordered: false });
      } catch (error) {
        if (error?.code !== 11000) throw error;

        // A concurrent sync may have inserted the same fingerprint. Retrying the
        // same bulk upsert makes those records match the existing unique key.
        await GuestVisit.bulkWrite(batch, { ordered: false });
      }
    }

    const currentFingerprints = await this.findExistingFingerprints(
      candidateRecords.map((record) => record.syncFingerprint)
    );
    let insertedCount = 0;
    for (const record of candidateRecords) {
      if (
        currentFingerprints.has(record.syncFingerprint) &&
        !existingFingerprints.has(record.syncFingerprint)
      ) {
        insertedCount += 1;
      }
    }

    const duplicateCount = duplicatesInFile + existingFingerprints.size;
    const lastSyncTime = new Date().toISOString();

    return {
      totalFetched: data.length,
      fetchedCount: data.length,
      insertedCount,
      duplicateCount,
      duplicateSkipped: duplicateCount,
      duplicatesInFile,
      existingDuplicateCount: existingFingerprints.size,
      invalidCount,
      rejectedCount: invalidCount,
      invalidRows,
      invalidRowsTruncated: invalidCount > invalidRows.length,
      lastSyncTime,
    };
  }

  async findExistingFingerprints(fingerprints) {
    const existing = new Set();

    for (let offset = 0; offset < fingerprints.length; offset += DATABASE_BATCH_SIZE) {
      const batch = fingerprints.slice(offset, offset + DATABASE_BATCH_SIZE);
      const guests = await GuestVisit.find({ syncFingerprint: { $in: batch } })
        .select('syncFingerprint')
        .lean();
      for (const guest of guests) {
        existing.add(guest.syncFingerprint);
      }
    }

    return existing;
  }
}

module.exports = new GuestService();
