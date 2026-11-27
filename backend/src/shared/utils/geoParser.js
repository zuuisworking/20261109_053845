/**
 * Parser koordinat untuk data Gardu Trafo SIGAP ULP Labuhan.
 *
 * Format yang didukung:
 * 1. WKT ketat: `POINT(longitude latitude)`.
 *    - Longitude selalu menjadi argumen pertama.
 *    - Parser ini tidak pernah menukar atau "memperbaiki" urutan WKT.
 * 2. Pasangan berlabel: `latitude: 3.666219, longitude: 98.676652`.
 *    - Alias label yang diterima: lat/latitude/lintang dan lon/long/longitude/bujur.
 * 3. Pasangan numerik. Gunakan opsi `inputFormat: 'lat-long'` atau
 *    `inputFormat: 'lon-lat'` agar urutan tidak ambigu.
 * 4. Pasangan desimal-koma Indonesia. Gunakan opsi eksplisit
 *    `inputFormat: 'indonesian-lat-long'`, misalnya:
 *    `3,666219, 98,676652`.
 *
 * Tanpa `inputFormat`, pasangan numerik tanpa label ditolak karena ambigu.
 * Semua koordinat juga harus berada dalam rentang geografis global dan
 * (kecuali `enforceOperationalBounds: false`) area operasional ULP Labuhan.
 */

const BOUNDS = Object.freeze({
  minLon: 98.5,
  maxLon: 98.9,
  minLat: 3.5,
  maxLat: 3.9,
});

const GLOBAL_BOUNDS = Object.freeze({
  minLongitude: -180,
  maxLongitude: 180,
  minLatitude: -90,
  maxLatitude: 90,
});

const NUMBER_PATTERN = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const DOT_NUMBER_PATTERN = new RegExp(`^${NUMBER_PATTERN}$`);
const DECIMAL_COMMA_NUMBER_PATTERN = /^[+-]?\d+,\d+$/;
const WKT_PATTERN = new RegExp(
  `^POINT\\s*\\(\\s*(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})\\s*\\)$`,
  'i',
);
const DOT_PAIR_PATTERN = new RegExp(
  `^(${NUMBER_PATTERN})\\s*(?:,|;|\\s)\\s*(${NUMBER_PATTERN})$`,
);
const INDONESIAN_PAIR_PATTERN = /^([+-]?\d+,\d+)\s*(?:,|;|\s)\s*([+-]?\d+,\d+)$/;
const LABELED_NUMBER_PATTERN =
  /(latitude|lat|lintang|longitude|lon|long|bujur)\s*[:=]\s*([+-]?(?:\d+(?:[.,]\d*)?|\.\d+))/gi;

function normalizeInputFormat(inputFormat) {
  if (!inputFormat) return 'auto';
  return String(inputFormat).trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function parseNumber(value, allowDecimalComma = false) {
  const text = String(value).trim();
  if (DOT_NUMBER_PATTERN.test(text)) return Number(text);
  if (allowDecimalComma && DECIMAL_COMMA_NUMBER_PATTERN.test(text)) {
    return Number(text.replace(',', '.'));
  }
  return null;
}

function makeResult(raw, format, values = {}, error = null) {
  const longitude = values.longitude ?? null;
  const latitude = values.latitude ?? null;
  const coordinates =
    Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
  const geojson = coordinates ? { type: 'Point', coordinates } : null;

  return {
    raw: typeof raw === 'string' ? raw : '',
    format,
    longitude,
    latitude,
    coordinates,
    geojson,
    location: geojson,
    valid: !error,
    isValid: !error,
    error,
  };
}

function makeError(code, message, details = null) {
  return { code, message, details };
}

function validateCoordinates(longitude, latitude, enforceOperationalBounds = true) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return makeError(
      'INVALID_NUMBER',
      'Koordinat bukan angka yang valid.',
      { longitude, latitude },
    );
  }

  if (
    longitude < GLOBAL_BOUNDS.minLongitude ||
    longitude > GLOBAL_BOUNDS.maxLongitude
  ) {
    return makeError('OUT_OF_RANGE', 'Longitude berada di luar rentang -180..180.', {
      value: longitude,
      range: [GLOBAL_BOUNDS.minLongitude, GLOBAL_BOUNDS.maxLongitude],
      axis: 'longitude',
    });
  }

  if (latitude < GLOBAL_BOUNDS.minLatitude || latitude > GLOBAL_BOUNDS.maxLatitude) {
    return makeError('OUT_OF_RANGE', 'Latitude berada di luar rentang -90..90.', {
      value: latitude,
      range: [GLOBAL_BOUNDS.minLatitude, GLOBAL_BOUNDS.maxLatitude],
      axis: 'latitude',
    });
  }

  if (
    enforceOperationalBounds &&
    (longitude < BOUNDS.minLon ||
      longitude > BOUNDS.maxLon ||
      latitude < BOUNDS.minLat ||
      latitude > BOUNDS.maxLat)
  ) {
    return makeError(
      'OUTSIDE_OPERATIONAL_BOUNDS',
      'Koordinat berada di luar area operasional ULP Labuhan.',
      {
        longitude,
        latitude,
        bounds: BOUNDS,
      },
    );
  }

  return null;
}

function parseLabeledPair(text) {
  const matches = [...text.matchAll(LABELED_NUMBER_PATTERN)];
  if (matches.length === 0) return null;

  const remainder = text
    .replace(LABELED_NUMBER_PATTERN, '')
    .replace(/[\s,;]/g, '');
  if (remainder.length > 0) {
    return {
      error: makeError(
        'INVALID_LABELED_FORMAT',
        'Format koordinat berlabel tidak valid.',
        { remainder },
      ),
    };
  }

  const latitudeLabels = new Set(['latitude', 'lat', 'lintang']);
  const longitudeLabels = new Set(['longitude', 'lon', 'long', 'bujur']);
  let latitude = null;
  let longitude = null;

  for (const match of matches) {
    const label = match[1].toLowerCase();
    const value = parseNumber(match[2], true);
    if (value === null) {
      return {
        error: makeError('INVALID_NUMBER', 'Nilai koordinat berlabel tidak valid.', {
          label,
          value: match[2],
        }),
      };
    }

    if (latitudeLabels.has(label)) {
      if (latitude !== null) {
        return {
          error: makeError('DUPLICATE_LABEL', 'Label latitude muncul lebih dari satu kali.', {
            label,
          }),
        };
      }
      latitude = value;
    } else if (longitudeLabels.has(label)) {
      if (longitude !== null) {
        return {
          error: makeError('DUPLICATE_LABEL', 'Label longitude muncul lebih dari satu kali.', {
            label,
          }),
        };
      }
      longitude = value;
    }
  }

  if (latitude === null || longitude === null) {
    return {
      error: makeError(
        'MISSING_LABEL',
        'Pasangan berlabel harus memuat latitude dan longitude.',
        { latitude, longitude },
      ),
    };
  }

  return { latitude, longitude };
}

function parsePointCoordinates(raw, options = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return makeResult(
      raw,
      'invalid',
      {},
      makeError('EMPTY_INPUT', 'Koordinat tidak boleh kosong.', null),
    );
  }

  const text = raw.trim();
  const requestedFormat = normalizeInputFormat(
    options.inputFormat || options.format || options.coordinateFormat,
  );
  const enforceOperationalBounds = options.enforceOperationalBounds !== false;

  const finish = (format, longitude, latitude) => {
    const error = validateCoordinates(longitude, latitude, enforceOperationalBounds);
    return makeResult(raw, format, { longitude, latitude }, error);
  };

  if (requestedFormat === 'wkt' || requestedFormat === 'point') {
    const match = text.match(WKT_PATTERN);
    if (!match) {
      return makeResult(
        raw,
        'wkt',
        {},
        makeError(
          'INVALID_WKT',
          'WKT harus berformat ketat POINT(longitude latitude).',
          { expected: 'POINT(<longitude> <latitude>)' },
        ),
      );
    }
    return finish('wkt', parseNumber(match[1]), parseNumber(match[2]));
  }

  if (requestedFormat === 'auto') {
    const wktMatch = text.match(WKT_PATTERN);
    if (wktMatch) {
      // WKT selalu longitude-latitude dan tidak boleh dibalik.
      return finish('wkt', parseNumber(wktMatch[1]), parseNumber(wktMatch[2]));
    }

    const labeled = parseLabeledPair(text);
    if (labeled) {
      if (labeled.error) return makeResult(raw, 'labeled-lat-long', {}, labeled.error);
      return finish(
        'labeled-lat-long',
        labeled.longitude,
        labeled.latitude,
      );
    }

    if (text.match(DOT_PAIR_PATTERN) || text.match(INDONESIAN_PAIR_PATTERN)) {
      return makeResult(
        raw,
        'ambiguous',
        {},
        makeError(
          'AMBIGUOUS_COORDINATE_ORDER',
          'Pasangan numerik tanpa label harus menyertakan inputFormat yang eksplisit.',
          {
            expected: ['lat-long', 'lon-lat', 'indonesian-lat-long'],
          },
        ),
      );
    }
  } else if (requestedFormat === 'labeled-lat-long' || requestedFormat === 'labeled') {
    const labeled = parseLabeledPair(text);
    if (!labeled) {
      return makeResult(
        raw,
        'labeled-lat-long',
        {},
        makeError(
          'INVALID_LABELED_FORMAT',
          'Label latitude dan longitude tidak ditemukan.',
          null,
        ),
      );
    }
    if (labeled.error) return makeResult(raw, 'labeled-lat-long', {}, labeled.error);
    return finish('labeled-lat-long', labeled.longitude, labeled.latitude);
  }

  if (
    requestedFormat === 'lat-long' ||
    requestedFormat === 'lat-lon' ||
    requestedFormat === 'latlon' ||
    requestedFormat === 'latitude-longitude'
  ) {
    const match = text.match(DOT_PAIR_PATTERN);
    if (!match) {
      return makeResult(
        raw,
        'lat-long',
        {},
        makeError(
          'INVALID_NUMERIC_FORMAT',
          'Pasangan numerik harus memuat dua angka.',
          { expectedFormat: 'latitude longitude' },
        ),
      );
    }
    return finish('lat-long', parseNumber(match[2]), parseNumber(match[1]));
  }

  if (requestedFormat === 'lon-lat' || requestedFormat === 'lonlat' || requestedFormat === 'longitude-latitude') {
    const match = text.match(DOT_PAIR_PATTERN);
    if (!match) {
      return makeResult(
        raw,
        'lon-lat',
        {},
        makeError(
          'INVALID_NUMERIC_FORMAT',
          'Pasangan numerik harus memuat dua angka.',
          { expectedFormat: 'longitude latitude' },
        ),
      );
    }
    return finish('lon-lat', parseNumber(match[1]), parseNumber(match[2]));
  }

  if (
    requestedFormat === 'indonesian-lat-long' ||
    requestedFormat === 'indonesian-lat-first' ||
    requestedFormat === 'decimal-comma-lat-long' ||
    requestedFormat === 'id-lat-long' ||
    requestedFormat === 'indonesian'
  ) {
    const match = text.match(INDONESIAN_PAIR_PATTERN);
    if (!match) {
      return makeResult(
        raw,
        'indonesian-lat-long',
        {},
        makeError(
          'INVALID_INDONESIAN_FORMAT',
          'Format desimal-koma Indonesia harus memuat dua angka desimal-koma.',
          { expectedFormat: 'latitude,decimal longitude,decimal' },
        ),
      );
    }
    return finish(
      'indonesian-lat-long',
      parseNumber(match[2], true),
      parseNumber(match[1], true),
    );
  }

  return makeResult(
    raw,
    'invalid',
    {},
    makeError(
      'UNSUPPORTED_FORMAT',
      'Format koordinat tidak didukung.',
      {
        inputFormat: requestedFormat,
        supported: [
          'auto',
          'wkt',
          'labeled-lat-long',
          'lat-long',
          'lon-lat',
          'indonesian-lat-long',
        ],
      },
    ),
  );
}

module.exports = {
  parsePointCoordinates,
  BOUNDS,
  GLOBAL_BOUNDS,
};
