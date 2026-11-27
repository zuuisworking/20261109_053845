const mongoose = require('mongoose');
const Transformer = require('./transformerModel');
const Measurement = require('../measurements/measurementModel');
const { serializeMeasurement } = require('../measurements/measurementService');
const { calculateIncomingAnalysis } = require('../../shared/utils/electricalCalculator');
const { parsePointCoordinates } = require('../../shared/utils/geoParser');
const { parseCapacityKva } = require('../../shared/utils/capacityParser');
const { normalizeNameKey } = require('../../shared/utils/nameKey');
const { MAX_CAPACITY_KVA, MAX_CURRENT_AMPS } = require('../../shared/constants/domainLimits');
const AppError = require('../../shared/errors/AppError');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

function normalizePeriod(value) {
  const period = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!['wbp', 'lwbp'].includes(period)) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('period', 'VALIDATION_ERROR', 'period hanya boleh WBP atau LWBP.'),
    );
  }
  return period;
}

function normalizeView(value) {
  const view = typeof value === 'string' ? value.trim().toLowerCase() : 'semua';
  if (['semua', 'all'].includes(view)) return 'semua';
  if (['pincang', 'unbalanced'].includes(view)) return 'pincang';
  if (['overload', 'overloaded'].includes(view)) return 'overload';
  throw semanticValidationError(
    'Permintaan tidak valid.',
    validationDetails(
      'category',
      'VALIDATION_ERROR',
      'category hanya boleh all, unbalanced, atau overloaded.',
    ),
  );
}

function buildBaseQuery({ search, feeder }) {
  const query = {};
  const cleanFeeder = typeof feeder === 'string' ? feeder.trim() : '';
  if (cleanFeeder) query.feeder = cleanFeeder;

  const cleanSearch = typeof search === 'string' ? search.trim() : '';
  if (cleanSearch.length > 100) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails('q', 'VALIDATION_ERROR', 'q maksimal 100 karakter.'),
    );
  }
  if (cleanSearch) {
    const literalPattern = new RegExp(escapeRegexLiteral(cleanSearch), 'i');
    query.$or = [
      { name: { $regex: literalPattern } },
      { feeder: { $regex: literalPattern } },
      { capacity: { $regex: literalPattern } },
    ];
  }
  return query;
}

function hasMeasurementField(path) {
  return {
    $and: [
      { $ne: [{ $ifNull: [`${path}`, null] }, null] },
      { $ne: [{ $type: path }, 'missing'] },
    ],
  };
}

function buildMongoAnalysis() {
  const incomingPath = '$measurement.incoming';
  const r = { $ifNull: [`${incomingPath}.r`, null] };
  const s = { $ifNull: [`${incomingPath}.s`, null] };
  const t = { $ifNull: [`${incomingPath}.t`, null] };
  const hasIncoming = {
    $and: [
      hasMeasurementField(`${incomingPath}.r`),
      hasMeasurementField(`${incomingPath}.s`),
      hasMeasurementField(`${incomingPath}.t`),
      { $isNumber: r },
      { $isNumber: s },
      { $isNumber: t },
      { $gte: [r, 0] },
      { $gte: [s, 0] },
      { $gte: [t, 0] },
      { $lte: [r, MAX_CURRENT_AMPS] },
      { $lte: [s, MAX_CURRENT_AMPS] },
      { $lte: [t, MAX_CURRENT_AMPS] },
    ],
  };

  const iAvg = {
    $cond: [hasIncoming, { $divide: [{ $add: [r, s, t] }, 3] }, null],
  };
  const hasPositiveAverage = {
    $and: [hasIncoming, { $gt: [iAvg, 0] }],
  };
  const hasCapacity = {
    $and: [
      { $isNumber: '$capacityKva' },
      { $gt: ['$capacityKva', 0] },
      { $lte: ['$capacityKva', MAX_CAPACITY_KVA] },
    ],
  };
  const isApplicable = {
    $and: [hasIncoming, hasPositiveAverage, hasCapacity],
  };
  const maxDiff = {
    $cond: [
      isApplicable,
      {
        $max: [
          { $abs: { $subtract: [r, iAvg] } },
          { $abs: { $subtract: [s, iAvg] } },
          { $abs: { $subtract: [t, iAvg] } },
        ],
      },
      null,
    ],
  };
  const unbalance = {
    $cond: [
      isApplicable,
      { $multiply: [{ $divide: [maxDiff, iAvg] }, 100] },
      null,
    ],
  };
  const nominalA = {
    $cond: [
      isApplicable,
      {
        $divide: [
          { $multiply: ['$capacityKva', 1000] },
          { $multiply: [{ $sqrt: 3 }, 400] },
        ],
      },
      null,
    ],
  };
  const loadingPercent = {
    $cond: [
      isApplicable,
      { $multiply: [{ $divide: [iAvg, nominalA] }, 100] },
      null,
    ],
  };

  return {
    unbalance,
    loadingPercent,
    isApplicable,
    isPincang: {
      $cond: [isApplicable, { $gt: [unbalance, 10] }, false],
    },
    isOverload: {
      $cond: [isApplicable, { $gt: [loadingPercent, 80] }, false],
    },
  };
}

function buildAnalysisPipeline(period) {
  return [
    {
      $lookup: {
        from: Measurement.collection.name,
        let: { transformerId: '$_id', wantedPeriod: period },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$transformerId', '$$transformerId'] },
                  { $eq: ['$period', '$$wantedPeriod'] },
                ],
              },
            },
          },
          {
            $project: {
              transformerId: 1,
              voltage: 1,
              incoming: 1,
              branches: 1,
              measurementDate: 1,
              measurementTime: 1,
              source: 1,
              sourceRecordKey: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
        as: 'measurement',
      },
    },
    { $unwind: { path: '$measurement', preserveNullAndEmptyArrays: true } },
    { $set: { _analysis: buildMongoAnalysis() } },
  ];
}

function buildViewMatch(view) {
  if (view === 'pincang') return { '_analysis.isPincang': true };
  if (view === 'overload') return { '_analysis.isOverload': true };
  return {};
}

function buildViewCondition(view) {
  if (view === 'pincang') return { $eq: ['$_analysis.isPincang', true] };
  if (view === 'overload') return { $eq: ['$_analysis.isOverload', true] };
  return true;
}

function buildViewSort(view) {
  if (view === 'pincang') return { '_analysis.unbalance': -1, nameKey: 1, _id: 1 };
  if (view === 'overload') return { '_analysis.loadingPercent': -1, nameKey: 1, _id: 1 };
  return { nameKey: 1, _id: 1 };
}

function validationDetails(path, code, message) {
  return [{ path, code, message }];
}

function semanticValidationError(message, details) {
  return new AppError(message, 422, details, 'VALIDATION_ERROR');
}

function cleanOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeTransformerName(value) {
  return typeof value === 'string' ? value.trim().normalize('NFC') : '';
}

function normalizeCapacityKva(value) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_CAPACITY_KVA
  ) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        'capacityKva',
        'VALIDATION_ERROR',
        `Kapasitas kVA harus berupa angka lebih besar dari 0 dan maksimal ${MAX_CAPACITY_KVA}.`,
      ),
    );
  }
  return value;
}

function normalizeCapacityFields(data) {
  const hasCapacity = Object.prototype.hasOwnProperty.call(data, 'capacity');
  const hasCapacityKva = Object.prototype.hasOwnProperty.call(data, 'capacityKva');
  const capacity = hasCapacity ? cleanOptionalString(data.capacity) : null;
  let capacityKva = hasCapacityKva ? normalizeCapacityKva(data.capacityKva) : null;

  if (capacity) {
    const parsed = parseCapacityKva(capacity);
    if (parsed.error && !parsed.ambiguous) {
      throw semanticValidationError(
        'Permintaan tidak valid.',
        validationDetails('capacity', 'INVALID_CAPACITY', parsed.error),
      );
    }

    if (parsed.value !== null) {
      if (capacityKva !== null && capacityKva !== parsed.value) {
        throw semanticValidationError(
          'Permintaan tidak valid.',
          validationDetails(
            'capacityKva',
            'CAPACITY_VALUE_MISMATCH',
            'Nilai capacity dan capacityKva harus sesuai.',
          ),
        );
      }
      capacityKva = parsed.value;
    } else if (capacityKva !== null) {
      throw semanticValidationError(
        'Permintaan tidak valid.',
        validationDetails(
          'capacityKva',
          'CAPACITY_VALUE_MISMATCH',
          'Kapasitas majemuk tidak dapat memiliki capacityKva tunggal.',
        ),
      );
    }
  }

  return { capacity, capacityKva };
}

function validateObjectId(id, label = 'ID') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`${label} tidak valid.`, 400);
  }
}

function validateCanonicalLocation(location) {
  if (location === null) return null;
  const coordinates = location?.coordinates;
  if (
    location?.type !== 'Point' ||
    !Array.isArray(coordinates) ||
    coordinates.length !== 2 ||
    !coordinates.every((coordinate) => Number.isFinite(coordinate)) ||
    coordinates[0] < -180 ||
    coordinates[0] > 180 ||
    coordinates[1] < -90 ||
    coordinates[1] > 90
  ) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        'location',
        'INVALID_LOCATION',
        'Lokasi harus berupa GeoJSON Point dengan koordinat [longitude, latitude] yang valid.',
      ),
    );
  }

  return {
    type: 'Point',
    coordinates: [coordinates[0], coordinates[1]],
  };
}

function sameCoordinates(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === 2 &&
    right.length === 2 &&
    left.every((coordinate, index) => coordinate === right[index])
  );
}

function buildLocationFromInput(data) {
  const hasLocation = Object.prototype.hasOwnProperty.call(data, 'location');
  const hasRawCoordinates = Object.prototype.hasOwnProperty.call(data, 'rawCoordinates');
  const rawCoordinates = hasRawCoordinates
    ? cleanOptionalString(data.rawCoordinates)
    : null;

  if (!hasLocation && !hasRawCoordinates) {
    return { rawCoordinates: null, location: null };
  }

  if (hasLocation) {
    const location = validateCanonicalLocation(data.location);
    if (!location) {
      if (rawCoordinates) {
        throw semanticValidationError(
          'Permintaan tidak valid.',
          validationDetails(
            'rawCoordinates',
            'LOCATION_VALUE_MISMATCH',
            'rawCoordinates tidak boleh diisi ketika location bernilai null.',
          ),
        );
      }
      return { rawCoordinates: null, location: null };
    }

    if (rawCoordinates) {
      const parsed = parsePointCoordinates(rawCoordinates, {
        enforceOperationalBounds: false,
      });
      if (!parsed.isValid || !sameCoordinates(parsed.coordinates, location.coordinates)) {
        throw semanticValidationError(
          'Permintaan tidak valid.',
          validationDetails(
            'rawCoordinates',
            'LOCATION_VALUE_MISMATCH',
            'rawCoordinates harus dapat diurai dan harus sesuai dengan location.',
          ),
        );
      }
    }

    return { rawCoordinates, location };
  }

  if (!rawCoordinates) {
    return { rawCoordinates: null, location: null };
  }

  const parsed = parsePointCoordinates(rawCoordinates, {
    enforceOperationalBounds: false,
  });
  if (!parsed.isValid) {
    throw semanticValidationError(
      'Permintaan tidak valid.',
      validationDetails(
        'rawCoordinates',
        'INVALID_LOCATION',
        parsed.error?.message || 'Koordinat tidak valid.',
      ),
    );
  }

  return {
    rawCoordinates,
    location: {
      type: 'Point',
      coordinates: parsed.coordinates,
    },
  };
}

function buildDetailPeriod(measurement, capacityKva, period) {
  if (!measurement) return null;

  const serializedMeasurement = serializeMeasurement(measurement);
  return {
    measurement: serializedMeasurement,
    tegangan: serializedMeasurement.voltage,
    incoming: serializedMeasurement.incoming,
    jurusan: serializedMeasurement.branches,
    updatedAt: serializedMeasurement.measurementDate,
    updatedTime: serializedMeasurement.measurementTime,
    analysis: calculateIncomingAnalysis(
      serializedMeasurement.incoming,
      capacityKva,
      period,
    ),
  };
}

function serializeTransformer(transformer, extra = {}) {
  const source =
    transformer && typeof transformer.toObject === 'function'
      ? transformer.toObject()
      : transformer || {};

  return {
    id: String(source._id),
    name: source.name ?? null,
    feeder: source.feeder ?? null,
    capacity: source.capacity ?? null,
    capacityKva: source.capacityKva ?? null,
    brand: source.brand ?? null,
    grounding: source.grounding ?? null,
    location: source.location
      ? {
          type: 'Point',
          coordinates: [
            Number(source.location.coordinates?.[0]),
            Number(source.location.coordinates?.[1]),
          ],
        }
      : null,
    rawCoordinates: source.rawCoordinates ?? null,
    source: source.source ?? null,
    sourceFile: source.sourceFile ?? null,
    sourceRow: source.sourceRow ?? null,
    sourceMetadata: source.sourceMetadata ?? null,
    createdAt: source.createdAt ? new Date(source.createdAt).toISOString() : null,
    updatedAt: source.updatedAt ? new Date(source.updatedAt).toISOString() : null,
    ...extra,
  };
}

class TransformerService {
  async getTransformers({
    page = DEFAULT_PAGE,
    limit,
    pageSize,
    search = '',
    q = '',
    feeder = '',
    view = 'semua',
    category,
    period = 'wbp',
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
    const normalizedPeriod = normalizePeriod(period);
    const normalizedView = normalizeView(category ?? view);
    const query = buildBaseQuery({ search: q || search, feeder });

    const countsPipeline = [
      { $match: query },
      ...buildAnalysisPipeline(normalizedPeriod),
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pincang: {
            $sum: { $cond: [{ $eq: ['$_analysis.isPincang', true] }, 1, 0] },
          },
          overload: {
            $sum: { $cond: [{ $eq: ['$_analysis.isOverload', true] }, 1, 0] },
          },
          analyzable: {
            $sum: { $cond: [{ $eq: ['$_analysis.isApplicable', true] }, 1, 0] },
          },
          notAnalyzable: {
            $sum: { $cond: [{ $eq: ['$_analysis.isApplicable', false] }, 1, 0] },
          },
          filteredTotal: {
            $sum: { $cond: [buildViewCondition(normalizedView), 1, 0] },
          },
        },
      },
    ];

    const rowsPipeline = [
      { $match: query },
      ...buildAnalysisPipeline(normalizedPeriod),
      { $match: buildViewMatch(normalizedView) },
      { $sort: buildViewSort(normalizedView) },
      { $skip: (pageNum - 1) * limitNum },
      { $limit: limitNum },
      {
        $project: {
          name: 1,
          feeder: 1,
          capacity: 1,
          capacityKva: 1,
          brand: 1,
          grounding: 1,
          location: 1,
          rawCoordinates: 1,
          source: 1,
          sourceFile: 1,
          sourceRow: 1,
          sourceMetadata: 1,
          createdAt: 1,
          updatedAt: 1,
          measurement: { $ifNull: ['$measurement', null] },
        },
      },
    ];

    const [countsAggregate, rows] = await Promise.all([
      Transformer.aggregate(countsPipeline),
      Transformer.aggregate(rowsPipeline),
    ]);
    const countsResult = countsAggregate[0] || {};
    const totalItems = countsResult.filteredTotal || 0;

    const items = rows.map((trafo) => {
      const measurement = trafo.measurement
        ? serializeMeasurement(trafo.measurement)
        : null;
      return serializeTransformer(trafo, {
        measurement,
        analysis: measurement
          ? calculateIncomingAnalysis(measurement.incoming, trafo.capacityKva, normalizedPeriod)
          : null,
        updatedAtDate: measurement?.measurementDate ?? null,
        updatedTimeStr: measurement?.measurementTime ?? null,
      });
    });

    return {
      items,
      meta: {
        page: pageNum,
        pageSize: limitNum,
        total: totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / limitNum),
      },
      counts: {
        total: countsResult.total || 0,
        analyzable: countsResult.analyzable || 0,
        notAnalyzable: countsResult.notAnalyzable || 0,
        pincang: countsResult.pincang || 0,
        overload: countsResult.overload || 0,
      },
    };
  }

  async getMapPoints(period = 'wbp') {
    const normalizedPeriod = normalizePeriod(period);
    const rows = await Transformer.aggregate([
      {
        $match: {
          'location.coordinates': { $exists: true, $ne: [] },
        },
      },
      ...buildAnalysisPipeline(normalizedPeriod),
      {
        $project: {
          name: 1,
          nameKey: 1,
          feeder: 1,
          capacity: 1,
          capacityKva: 1,
          brand: 1,
          grounding: 1,
          location: 1,
          measurement: { $ifNull: ['$measurement', null] },
        },
      },
      { $sort: { nameKey: 1, _id: 1 } },
    ]);

    const features = rows.flatMap((trafo) => {
      const coordinates = trafo.location?.coordinates;
      if (
        !Array.isArray(coordinates) ||
        coordinates.length !== 2 ||
        !coordinates.every((coordinate) => Number.isFinite(Number(coordinate))) ||
        Number(coordinates[0]) < -180 ||
        Number(coordinates[0]) > 180 ||
        Number(coordinates[1]) < -90 ||
        Number(coordinates[1]) > 90
      ) {
        return [];
      }

      const analysis = trafo.measurement
        ? calculateIncomingAnalysis(
            trafo.measurement.incoming || {},
            trafo.capacityKva ?? null,
            normalizedPeriod,
          )
        : null;
      const isAvailable = Boolean(analysis?.isApplicable);
      const visualStatus = isAvailable ? analysis.unbalanceLevel : 'unknown';
      let recommendationStatus = 'unknown';
      if (isAvailable) {
        if (
          analysis.isOverload ||
          analysis.unbalance > 15 ||
          (analysis.hasNeutralCurrent && analysis.inVal > 40)
        ) {
          recommendationStatus = 'critical';
        } else if (analysis.unbalance > 10) {
          recommendationStatus = 'warning';
        } else {
          recommendationStatus = 'normal';
        }
      }

      return [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [Number(coordinates[0]), Number(coordinates[1])],
          },
          properties: {
            id: String(trafo._id),
            name: trafo.name,
            feeder: trafo.feeder ?? null,
            capacity: trafo.capacity ?? null,
            capacityKva: trafo.capacityKva ?? null,
            brand: trafo.brand ?? null,
            grounding: trafo.grounding ?? null,
            visualStatus,
            recommendationStatus,
            overloaded: isAvailable ? analysis.isOverload : null,
          },
        },
      ];
    });

    return {
      type: 'FeatureCollection',
      features,
    };
  }

  async getAnomalies({
    page = DEFAULT_PAGE,
    limit,
    pageSize,
    category,
    period = 'wbp',
    search = '',
    q = '',
    feeder = '',
  } = {}) {
    const normalizedCategory = normalizeView(category);
    if (normalizedCategory === 'semua') {
      throw semanticValidationError(
        'Permintaan tidak valid.',
        validationDetails(
          'category',
          'VALIDATION_ERROR',
          'category anomaly hanya boleh unbalanced atau overloaded.',
        ),
      );
    }

    const result = await this.getTransformers({
      page,
      limit,
      pageSize,
      category: normalizedCategory,
      period,
      search: q || search,
      feeder,
    });
    return {
      items: result.items,
      meta: result.meta,
      counts: result.counts,
    };
  }

  async getTransformerById(id) {
    validateObjectId(id, 'ID trafo');
    const trafo = await Transformer.findById(id).lean();
    if (!trafo) throw new AppError('Data trafo tidak ditemukan.', 404);

    const measurements = await Measurement.find({
      transformerId: trafo._id,
      period: { $in: ['wbp', 'lwbp'] },
    }).lean();
    const measurementMap = new Map(
      measurements.map((measurement) => [measurement.period, serializeMeasurement(measurement)]),
    );
    const wbp = measurementMap.get('wbp') || null;
    const lwbp = measurementMap.get('lwbp') || null;
    const wbpDetail = buildDetailPeriod(wbp, trafo.capacityKva, 'wbp');
    const lwbpDetail = buildDetailPeriod(lwbp, trafo.capacityKva, 'lwbp');

    return serializeTransformer(trafo, {
      measurements: {
        wbp,
        lwbp,
      },
      beban: {
        merek: trafo.brand ?? null,
        grounding: trafo.grounding ?? null,
        wbp: wbpDetail,
        lwbp: lwbpDetail,
      },
      analysis: {
        wbp: wbpDetail?.analysis ?? null,
        lwbp: lwbpDetail?.analysis ?? null,
      },
    });
  }

  async createTransformer(data = {}) {
    const name = normalizeTransformerName(data.name);
    if (!name) {
      throw semanticValidationError(
        'Permintaan tidak valid.',
        validationDetails('name', 'REQUIRED', 'Nama trafo wajib diisi.'),
      );
    }

    const nameKey = normalizeNameKey(name);
    const existing = await Transformer.findOne({ nameKey });
    if (existing) {
      throw new AppError(`Trafo dengan nama '${name}' sudah ada.`, 409);
    }

    const capacityFields = normalizeCapacityFields(data);
    const locationInput = buildLocationFromInput(data);
    const doc = {
      name,
      nameKey,
      feeder: cleanOptionalString(data.feeder),
      capacity: capacityFields.capacity,
      capacityKva: capacityFields.capacityKva,
      brand: cleanOptionalString(data.brand),
      grounding: cleanOptionalString(data.grounding),
      rawCoordinates: locationInput.rawCoordinates,
      source: 'operator',
    };
    if (locationInput.location) doc.location = locationInput.location;

    const created = await Transformer.create(doc);
    return serializeTransformer(created);
  }

  async updateTransformer(id, data = {}) {
    validateObjectId(id, 'ID trafo');
    const trafo = await Transformer.findById(id);
    if (!trafo) throw new AppError('Trafo tidak ditemukan.', 404);

    const name = normalizeTransformerName(data.name);
    if (!name) {
      throw semanticValidationError(
        'Permintaan tidak valid.',
        validationDetails('name', 'REQUIRED', 'Nama trafo wajib diisi.'),
      );
    }

    const nameKey = normalizeNameKey(name);
    if (nameKey !== trafo.nameKey) {
      const duplicate = await Transformer.findOne({ nameKey });
      if (duplicate && duplicate._id.toString() !== trafo._id.toString()) {
        throw new AppError(`Trafo dengan nama '${name}' sudah ada.`, 409);
      }
    }

    const capacityFields = normalizeCapacityFields(data);
    const locationInput = buildLocationFromInput(data);

    trafo.name = name;
    trafo.nameKey = nameKey;
    trafo.feeder = cleanOptionalString(data.feeder);
    trafo.capacity = capacityFields.capacity;
    trafo.capacityKva = capacityFields.capacityKva;
    trafo.brand = cleanOptionalString(data.brand);
    trafo.grounding = cleanOptionalString(data.grounding);
    trafo.rawCoordinates = locationInput.rawCoordinates;
    if (locationInput.location) {
      trafo.location = locationInput.location;
    } else {
      trafo.set('location', undefined);
    }

    const updated = await trafo.save();
    return serializeTransformer(updated);
  }

  async deleteTransformer(id) {
    validateObjectId(id, 'ID trafo');
    const trafo = await Transformer.findByIdAndDelete(id);
    if (!trafo) throw new AppError('Trafo tidak ditemukan.', 404);

    await Measurement.deleteMany({ transformerId: trafo._id });
    return { id: trafo._id.toString() };
  }
}

const transformerService = new TransformerService();
transformerService.escapeRegexLiteral = escapeRegexLiteral;
transformerService.parseCapacityKva = parseCapacityKva;

module.exports = transformerService;
