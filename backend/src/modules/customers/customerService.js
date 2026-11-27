const mongoose = require('mongoose');
const Customer = require('./customerModel');
const AppError = require('../../shared/errors/AppError');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function validationDetails(path, code, message) {
  return [{ path, code, message }];
}

function semanticValidationError(message, details) {
  return new AppError(message, 422, details, 'VALIDATION_ERROR');
}

function parseBoundedInteger(value, fallback, { min, max, path }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        path,
        'VALIDATION_ERROR',
        `${path} harus berupa bilangan bulat antara ${min} dan ${max}.`,
      ),
    );
  }
  return parsed;
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeCustomerId(value) {
  if (typeof value !== 'string') {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('customerId', 'VALIDATION_ERROR', 'ID Pelanggan harus berupa string.'),
    );
  }
  const customerId = value.trim();
  if (!customerId) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('customerId', 'REQUIRED', 'ID Pelanggan wajib diisi.'),
    );
  }
  if (!/^\d{12}$/.test(customerId)) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        'customerId',
        'VALIDATION_ERROR',
        'ID Pelanggan harus terdiri dari tepat 12 digit.',
      ),
    );
  }
  return customerId;
}

function parsePowerVa(value) {
  if (value === null || value === undefined || value === '') {
    return { raw: null, value: null };
  }

  const raw = String(value).trim();
  if (!raw) return { raw: null, value: null };

  const numericText = raw.replace(/\s*(?:VA|Volt.?)\s*$/i, '').trim();
  let valueVa = null;

  if (/^\d{1,3}(?:\.\d{3})+$/.test(numericText)) {
    // Format Indonesia: 1.300 berarti 1.300 VA (bukan 1,3 VA).
    valueVa = Number(numericText.replace(/\./g, ''));
  } else if (/^\d+$/.test(numericText)) {
    valueVa = Number(numericText);
  } else if (/^\d+,\d+$/.test(numericText)) {
    valueVa = Number(numericText.replace(',', '.'));
  } else if (/^\d+(?:\.\d+)?$/.test(numericText)) {
    valueVa = Number(numericText);
  }

  if (!Number.isFinite(valueVa) || !Number.isInteger(valueVa) || valueVa < 0) {
    throw new AppError(
      `Daya '${raw}' tidak valid. Gunakan angka VA bulat, misalnya 900 atau 1.300.`,
      422,
      null,
      'INVALID_POWER_VALUE'
    );
  }

  return { raw, value: valueVa };
}

function normalizePowerInput(data) {
  const hasRaw = hasOwn(data, 'powerRaw') || hasOwn(data, 'power');
  const hasNumeric = hasOwn(data, 'powerVa');
  if (!hasRaw && !hasNumeric) return null;

  const rawValue = hasOwn(data, 'powerRaw') ? data.powerRaw : data.power;
  const parsedRaw = hasRaw ? parsePowerVa(rawValue) : null;
  let numericValue = null;

  if (hasNumeric) {
    if (data.powerVa !== null && data.powerVa !== undefined && data.powerVa !== '') {
      const parsed = Number(data.powerVa);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new AppError(
          'Daya VA harus berupa bilangan bulat nonnegatif.',
          422,
          null,
          'INVALID_POWER_VALUE'
        );
      }
      numericValue = parsed;
    }
  }

  if (parsedRaw && numericValue !== null && parsedRaw.value !== numericValue) {
    throw new AppError(
      'Nilai power dan powerVa tidak cocok.',
      422,
      null,
      'POWER_VALUE_MISMATCH'
    );
  }

  if (parsedRaw) {
    return {
      powerRaw:
        parsedRaw.value === null && numericValue !== null
          ? String(numericValue)
          : parsedRaw.raw,
      powerVa: parsedRaw.value ?? numericValue,
    };
  }

  return {
    powerRaw: numericValue === null ? null : String(numericValue),
    powerVa: numericValue,
  };
}

function serializeCustomer(customer) {
  const source =
    customer && typeof customer.toObject === 'function'
      ? customer.toObject()
      : customer || {};
  const powerRaw = source.powerRaw ?? source.power ?? null;

  return {
    id: String(source._id),
    customerId: source.customerId ?? null,
    name: source.name ?? null,
    tariff: source.tariff ?? null,
    power: powerRaw,
    powerVa: source.powerVa ?? null,
    address: source.address ?? null,
    feeder: source.feeder ?? null,
    status: source.status ?? null,
    source: source.source ?? null,
    sourceFile: source.sourceFile ?? null,
    sourceRow: source.sourceRow ?? null,
    sourceMetadata: source.sourceMetadata ?? null,
    createdAt: source.createdAt ? new Date(source.createdAt).toISOString() : null,
    updatedAt: source.updatedAt ? new Date(source.updatedAt).toISOString() : null,
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

class CustomerService {
  async getCustomers({
    page = DEFAULT_PAGE,
    limit,
    pageSize,
    search = '',
    q = '',
  } = {}) {
    const pageNum = parseBoundedInteger(page, DEFAULT_PAGE, {
      min: 1,
      max: 1_000_000,
      path: 'page',
    });
    const limitNum = parseBoundedInteger(
      pageSize ?? limit,
      DEFAULT_LIMIT,
      { min: 1, max: MAX_LIMIT, path: 'pageSize' },
    );

    const query = {};
    const cleanSearch = typeof (q || search) === 'string' ? (q || search).trim() : '';
    if (cleanSearch.length > 100) {
      throw semanticValidationError(
        'Permintaan tidak valid.',
        validationDetails('q', 'VALIDATION_ERROR', 'q maksimal 100 karakter.'),
      );
    }
    if (cleanSearch) {
      const literalPattern = new RegExp(escapeRegexLiteral(cleanSearch), 'i');
      const clauses = [
        { name: { $regex: literalPattern } },
        { address: { $regex: literalPattern } },
      ];
      if (/^\d+$/.test(cleanSearch)) {
        clauses.push({
          customerId: {
            $regex: new RegExp(`^${escapeRegexLiteral(cleanSearch)}`),
          },
        });
      }
      query.$or = clauses;
    }

    const totalItems = await Customer.countDocuments(query);
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limitNum);
    const skip = (pageNum - 1) * limitNum;
    const documents = await Customer.find(query)
      .sort({ customerId: 1, _id: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    return {
      items: documents.map(serializeCustomer),
      meta: {
        page: pageNum,
        pageSize: limitNum,
        total: totalItems,
        totalPages,
      },
    };
  }

  async getCustomerById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('ID pelanggan tidak valid.', 400);
    }
    const customer = await Customer.findById(id).lean();
    if (!customer) throw new AppError('Data pelanggan tidak ditemukan.', 404);
    return serializeCustomer(customer);
  }

  async createCustomer(data = {}) {
    const customerId = normalizeCustomerId(data.customerId);
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) {
      throw semanticValidationError(
        'Permintaan tidak valid.',
        validationDetails('name', 'REQUIRED', 'Nama pelanggan wajib diisi.'),
      );
    }

    const existing = await Customer.findOne({ customerId });
    if (existing) {
      throw new AppError(`Pelanggan dengan ID '${customerId}' sudah ada dalam database.`, 409);
    }

    const power = normalizePowerInput(data) || { powerRaw: null, powerVa: null };
    const doc = {
      customerId,
      name,
      tariff: cleanOptionalString(data.tariff),
      address: cleanOptionalString(data.address),
      powerRaw: power.powerRaw,
      powerVa: power.powerVa,
      source: 'operator',
    };

    const created = await Customer.create(doc);
    return serializeCustomer(created);
  }

  async updateCustomer(id, data = {}) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('ID pelanggan tidak valid.', 400);
    }
    const customer = await Customer.findById(id);
    if (!customer) throw new AppError('Pelanggan tidak ditemukan.', 404);

    const customerId = normalizeCustomerId(data.customerId);
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) {
      throw semanticValidationError(
        'Permintaan tidak valid.',
        validationDetails('name', 'REQUIRED', 'Nama pelanggan wajib diisi.'),
      );
    }
    if (customerId !== customer.customerId) {
      const duplicate = await Customer.findOne({ customerId });
      if (duplicate) {
        throw new AppError(`ID Pelanggan '${customerId}' sudah digunakan.`, 409);
      }
    }

    const power = normalizePowerInput(data) || { powerRaw: null, powerVa: null };
    customer.customerId = customerId;
    customer.name = name;
    customer.tariff = cleanOptionalString(data.tariff);
    customer.address = cleanOptionalString(data.address);
    customer.powerRaw = power.powerRaw;
    customer.powerVa = power.powerVa;

    const updated = await customer.save();
    return serializeCustomer(updated);
  }

  async deleteCustomer(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('ID pelanggan tidak valid.', 400);
    }
    const customer = await Customer.findByIdAndDelete(id);
    if (!customer) throw new AppError('Pelanggan tidak ditemukan.', 404);
    return { id: customer._id.toString() };
  }
}

const customerService = new CustomerService();
customerService.parsePowerVa = parsePowerVa;
customerService.escapeRegexLiteral = escapeRegexLiteral;

module.exports = customerService;
