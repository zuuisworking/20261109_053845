const mongoose = require('mongoose');
const Measurement = require('./measurementModel');
const Transformer = require('../transformers/transformerModel');
const AppError = require('../../shared/errors/AppError');
const { MAX_CURRENT_AMPS } = require('../../shared/constants/domainLimits');

const ALLOWED_MANUAL_FIELDS = new Set([
  'period',
  'voltage',
  'incoming',
  'branches',
  'measurementDate',
  'measurementTime',
]);

const ALLOWED_BRANCH_FIELDS = new Set([
  'name',
  'r',
  's',
  't',
  'n',
  'fuse',
  'note',
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function assertNoUnexpectedFields(object, allowedFields, pathPrefix = '') {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return;
  const unexpected = Object.keys(object).filter((key) => !allowedFields.has(key));
  if (unexpected.length === 0) return;

  throw new AppError(
    `Field '${unexpected[0]}' tidak dikenal.`,
    422,
    unexpected.map((field) => ({
      path: `${pathPrefix}/${field}`,
      code: 'UNEXPECTED_FIELD',
      message: `Field '${field}' tidak dikenal.`,
    })),
    'UNEXPECTED_FIELD'
  );
}

function parseOptionalNumber(value, label, { min, max } = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError(`${label} harus berupa angka yang valid.`, 422);
  }
  if (min !== undefined && value < min) {
    throw new AppError(`${label} tidak boleh kurang dari ${min}.`, 422);
  }
  if (max !== undefined && value > max) {
    throw new AppError(`${label} tidak boleh lebih dari ${max}.`, 422);
  }
  return value;
}

function normalizeVoltage(source) {
  if (source === null) return null;
  if (source === undefined) return undefined;
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new AppError('Data tegangan harus berupa objek R/S/T.', 422);
  }

  assertNoUnexpectedFields(source, new Set(['r', 's', 't']));
  const voltage = {};
  for (const phase of ['r', 's', 't']) {
    if (hasOwn(source, phase)) {
      voltage[phase] = parseOptionalNumber(source[phase], `Tegangan ${phase.toUpperCase()}`, {
        min: 0,
        max: 500,
      });
    }
  }
  return voltage;
}

function normalizeIncoming(source) {
  if (source === null) return null;
  if (source === undefined) return undefined;
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new AppError('Data arus incoming harus berupa objek R/S/T/N.', 422);
  }

  assertNoUnexpectedFields(source, new Set(['r', 's', 't', 'n']));
  const incoming = {};
  for (const phase of ['r', 's', 't', 'n']) {
    if (hasOwn(source, phase)) {
      incoming[phase] = parseOptionalNumber(source[phase], `Arus ${phase.toUpperCase()}`, {
        min: 0,
        max: MAX_CURRENT_AMPS,
      });
    }
  }
  return incoming;
}

function normalizeBranches(source) {
  if (source === null) return null;
  if (source === undefined) return undefined;
  if (!Array.isArray(source)) {
    throw new AppError('Data jurusan harus berupa array.', 422);
  }

  return source.map((branch, index) => {
    if (!branch || typeof branch !== 'object' || Array.isArray(branch)) {
      throw new AppError(`Jurusan pada indeks ${index} tidak valid.`, 422);
    }

    assertNoUnexpectedFields(branch, ALLOWED_BRANCH_FIELDS, `/branches/${index}`);
    const normalized = {};
    if (hasOwn(branch, 'name')) {
      normalized.name = branch.name === null ? null : String(branch.name).trim();
    }

    for (const phase of ['r', 's', 't', 'n']) {
      if (hasOwn(branch, phase)) {
        normalized[phase] = parseOptionalNumber(branch[phase], `Arus jurusan ${phase.toUpperCase()}`, {
          min: 0,
          max: MAX_CURRENT_AMPS,
        });
      }
    }

    if (hasOwn(branch, 'fuse')) {
      normalized.fuse = branch.fuse === null ? null : String(branch.fuse).trim();
    }
    if (hasOwn(branch, 'note')) {
      normalized.note = branch.note === null ? null : String(branch.note).trim();
    }

    return normalized;
  });
}

function normalizeMeasurementDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new AppError('Tanggal pengukuran harus menggunakan format YYYY-MM-DD.', 422);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AppError('Tanggal pengukuran tidak valid.', 422);
  }
  return date;
}

function normalizeMeasurementTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw new AppError('Jam pengukuran harus menggunakan format HH:mm.', 422);
  }
  return text;
}

function hasRequiredPhaseValues(value, phases) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return phases.every((phase) => {
    if (!Object.prototype.hasOwnProperty.call(value, phase)) return false;
    const parsed = toFiniteNumber(value[phase]);
    return parsed !== null && parsed >= 0 && parsed <= MAX_CURRENT_AMPS;
  });
}

function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === 'number' ? value : String(value).trim();
  if (normalized === '') return null;
  const number = typeof normalized === 'number' ? normalized : Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function formatDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function serializeMeasurement(measurement) {
  if (!measurement) return null;
  const plain = typeof measurement.toObject === 'function' ? measurement.toObject() : measurement;
  const branches = Array.isArray(plain.branches) ? plain.branches : [];
  return {
    id: String(plain._id),
    transformerId: String(plain.transformerId),
    period: plain.period,
    voltage: {
      r: plain.voltage?.r ?? null,
      s: plain.voltage?.s ?? null,
      t: plain.voltage?.t ?? null,
    },
    incoming: {
      r: plain.incoming?.r ?? null,
      s: plain.incoming?.s ?? null,
      t: plain.incoming?.t ?? null,
      n: plain.incoming?.n ?? null,
    },
    branches: branches.map((branch) => ({
      name: branch.name ?? branch.nama ?? null,
      r: branch.r ?? null,
      s: branch.s ?? null,
      t: branch.t ?? null,
      n: branch.n ?? null,
      fuse: branch.fuse ?? null,
      note: branch.note ?? branch.ket ?? null,
    })),
    measurementDate: formatDateOnly(plain.measurementDate),
    measurementTime: plain.measurementTime ?? null,
    source: plain.source ?? null,
    sourceRecordKey: plain.sourceRecordKey ?? null,
    createdAt: plain.createdAt ? new Date(plain.createdAt).toISOString() : null,
    updatedAt: plain.updatedAt ? new Date(plain.updatedAt).toISOString() : null,
  };
}

class MeasurementService {
  async getMeasurementsByTransformerId(transformerId) {
    if (!mongoose.Types.ObjectId.isValid(transformerId)) {
      throw new AppError('ID trafo tidak valid.', 400);
    }

    const trafo = await Transformer.findById(transformerId).select('_id').lean();
    if (!trafo) throw new AppError('Trafo tidak ditemukan.', 404);

    const measurements = await Measurement.find({ transformerId: trafo._id })
      .sort({ period: 1 })
      .lean();
    const byPeriod = new Map(measurements.map((measurement) => [measurement.period, measurement]));

    return {
      transformerId: String(trafo._id),
      wbp: serializeMeasurement(byPeriod.get('wbp')),
      lwbp: serializeMeasurement(byPeriod.get('lwbp')),
    };
  }

  async saveMeasurement(transformerId, measurementData = {}) {
    if (!mongoose.Types.ObjectId.isValid(transformerId)) {
      throw new AppError('ID trafo tidak valid.', 400);
    }
    if (!measurementData || typeof measurementData !== 'object' || Array.isArray(measurementData)) {
      throw new AppError('Data pengukuran tidak valid.', 400);
    }

    const trafo = await Transformer.findById(transformerId).select('_id');
    if (!trafo) throw new AppError('Trafo tidak ditemukan.', 404);

    assertNoUnexpectedFields(measurementData, ALLOWED_MANUAL_FIELDS);

    const periodValue = measurementData.period;
    const period = typeof periodValue === 'string' ? periodValue.trim().toLowerCase() : '';
    if (!['wbp', 'lwbp'].includes(period)) {
      throw new AppError('Periode pengukuran hanya boleh WBP atau LWBP.', 422);
    }

    const voltageSource = measurementData.voltage;
    const incomingSource = measurementData.incoming;
    const branchesSource = measurementData.branches;

    if (!hasRequiredPhaseValues(voltageSource, ['r', 's', 't'])) {
      throw new AppError(
        'Tegangan R, S, dan T wajib diisi untuk pengukuran manual.',
        422
      );
    }
    if (!hasRequiredPhaseValues(incomingSource, ['r', 's', 't', 'n'])) {
      throw new AppError(
        'Arus incoming R, S, T, dan N wajib diisi untuk pengukuran manual.',
        422
      );
    }

    const normalizedVoltage = normalizeVoltage(voltageSource);
    const normalizedIncoming = normalizeIncoming(incomingSource);
    const normalizedBranches = normalizeBranches(branchesSource);

    // Pengukuran manual mengganti dokumen periode terkait; data fase lama
    // tidak digabung secara diam-diam dan tanggal/jam yang tidak diberikan
    // tetap null.
    const updateDoc = {
      voltage:
        normalizedVoltage === undefined
          ? null
          : { r: null, s: null, t: null, ...normalizedVoltage },
      incoming:
        normalizedIncoming === undefined
          ? null
          : { r: null, s: null, t: null, n: null, ...normalizedIncoming },
      branches: normalizedBranches === undefined ? [] : normalizedBranches,
      source: 'manual',
      sourceRecordKey: null,
    };

    const hasDate = hasOwn(measurementData, 'measurementDate');
    const hasTime = hasOwn(measurementData, 'measurementTime');

    updateDoc.measurementDate = hasDate
      ? normalizeMeasurementDate(measurementData.measurementDate)
      : null;
    updateDoc.measurementTime = hasTime
      ? normalizeMeasurementTime(measurementData.measurementTime)
      : null;

    const filter = { transformerId: trafo._id, period };
    let saved;
    try {
      saved = await Measurement.findOneAndUpdate(
        filter,
        { $set: updateDoc },
        {
          upsert: true,
          returnDocument: 'after',
          runValidators: true,
          setDefaultsOnInsert: false,
        },
      );
    } catch (error) {
      // Two concurrent first writes for the same period can race on the
      // unique (transformerId, period) index. The loser retries as an update
      // against the winner's document instead of surfacing a false conflict.
      if (error?.code !== 11000) throw error;
      saved = await Measurement.findOneAndUpdate(
        filter,
        { $set: updateDoc },
        {
          upsert: false,
          returnDocument: 'after',
          runValidators: true,
        },
      );
      if (!saved) throw error;
    }

    return serializeMeasurement(saved);
  }
}

const measurementService = new MeasurementService();
measurementService.parseOptionalNumber = parseOptionalNumber;
measurementService.serializeMeasurement = serializeMeasurement;

module.exports = measurementService;
