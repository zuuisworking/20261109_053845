const AMBIGUOUS_CAPACITY_PATTERN = /[\\/;|]/;

function parseCapacityKva(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { value: null, error: null, code: null, ambiguous: false };
  }

  const raw = String(value).trim();
  const withoutSuffix = raw.replace(/\s*kva\s*$/i, '').trim();
  if (!withoutSuffix) {
    return {
      value: null,
      error: 'Nilai kapasitas tidak dapat dibaca.',
      code: 'INVALID_CAPACITY',
      ambiguous: false,
    };
  }

  if (AMBIGUOUS_CAPACITY_PATTERN.test(withoutSuffix)) {
    return {
      value: null,
      error: 'Kapasitas majemuk memerlukan persetujuan operator.',
      code: 'AMBIGUOUS_CAPACITY',
      ambiguous: true,
    };
  }

  let numericText;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(withoutSuffix)) {
    numericText = withoutSuffix.replace(/\./g, '');
  } else if (/^\d+,\d+$/.test(withoutSuffix)) {
    numericText = withoutSuffix.replace(',', '.');
  } else if (/^-?\d+(?:\.\d+)?$/.test(withoutSuffix)) {
    numericText = withoutSuffix;
  } else {
    return {
      value: null,
      error: 'Nilai kapasitas harus berupa satu angka kVA yang tidak ambigu.',
      code: 'INVALID_CAPACITY',
      ambiguous: false,
    };
  }

  const numericValue = Number(numericText);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return {
      value: null,
      error: 'Nilai kapasitas harus lebih besar dari 0.',
      code: 'INVALID_CAPACITY',
      ambiguous: false,
    };
  }

  return { value: numericValue, error: null, code: null, ambiguous: false };
}

module.exports = { parseCapacityKva };
