import type {
  Customer,
  CustomerListData,
  DashboardData,
  ExportFormat,
  ExportDataset,
  GuestListData,
  GuestVisit,
  ImportCommitResult,
  ImportIssue,
  ImportIssueAction,
  ImportKind,
  ImportPreview,
  ImportRow,
  ImportRowStatus,
  ImportSummary,
  MapPoint,
  Pagination,
  Transformer,
  TransformerCounts,
  TransformerListData,
  User,
} from '../types';

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeUser(value: unknown): User {
  const source = isRecord(value) ? value : {};
  const fullName = typeof source.fullName === 'string' ? source.fullName : null;
  const email = typeof source.email === 'string' ? source.email : null;

  return {
    id: String(source.id ?? source._id ?? ''),
    adminId: String(source.adminId ?? source.idadmin ?? ''),
    username: String(source.username ?? source.adminId ?? source.idadmin ?? ''),
    fullName,
    email,
    avatar: typeof source.avatar === 'string' ? source.avatar : '',
    role: source.role === 'superadmin' ? 'superadmin' : 'admin',
  };
}

export function unwrapEnvelopeData(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ('data' in value && !('error' in value)) {
    return value.data;
  }
  return value;
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, value);
}

function firstNumber(source: unknown, paths: string[]): number {
  for (const path of paths) {
    const value = getPath(source, path);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function firstArray(source: unknown, paths: string[]): unknown[] {
  if (Array.isArray(source)) return source;
  for (const path of paths) {
    const value = getPath(source, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstString(source: unknown, paths: string[]): string {
  for (const path of paths) {
    const value = getPath(source, path);
    if (typeof value === 'string') return value;
  }
  return '';
}

function normalizePagination(source: unknown, fallbackLimit = 10): Pagination {
  const page = Math.max(1, Math.trunc(firstNumber(source, ['page', 'pagination.page', 'meta.page'])));
  const reportedLimit = Math.trunc(
    firstNumber(source, ['limit', 'pageSize', 'pagination.limit', 'meta.limit']),
  );
  const limit = reportedLimit > 0 ? reportedLimit : fallbackLimit;
  const totalItems = Math.max(
    0,
    Math.trunc(
      firstNumber(source, [
        'totalItems',
        'total',
        'pagination.totalItems',
        'pagination.total',
        'meta.totalItems',
        'meta.total',
        'counts.total',
      ]),
    ),
  );
  const totalPagePaths = ['totalPages', 'pagination.totalPages', 'meta.totalPages'];
  const hasReportedTotalPages = totalPagePaths.some((path) => {
    const value = getPath(source, path);
    return value !== undefined && value !== null;
  });
  const totalPages = hasReportedTotalPages
    ? Math.max(
        0,
        Math.trunc(firstNumber(source, totalPagePaths)),
      )
    : Math.max(1, Math.ceil(totalItems / (limit || fallbackLimit)));

  return { page, limit, totalItems, totalPages };
}

function normalizeTransformer(value: unknown): Transformer {
  const source = isRecord(value) ? value : {};
  const rawLocation = isRecord(source.location) ? source.location : null;
  const rawCoordinates = rawLocation?.coordinates;
  const coordinates =
    Array.isArray(rawCoordinates) && rawCoordinates.length === 2
      ? [Number(rawCoordinates[0]), Number(rawCoordinates[1])] as [number, number]
      : null;
  const location =
    rawLocation?.type === 'Point' &&
    coordinates &&
    coordinates.every((coordinate) => Number.isFinite(coordinate))
      ? { type: 'Point' as const, coordinates }
      : null;
  const capacityKva =
    source.capacityKva === null || source.capacityKva === undefined
      ? null
      : Number(source.capacityKva);
  const sourceMetadata = isRecord(source.sourceMetadata) ? source.sourceMetadata : null;

  return {
    id: String(source.id ?? source._id ?? ''),
    name: String(source.name ?? ''),
    feeder: source.feeder === null || source.feeder === undefined ? null : String(source.feeder),
    capacity: source.capacity === null || source.capacity === undefined ? null : String(source.capacity),
    capacityKva: capacityKva !== null && Number.isFinite(capacityKva) ? capacityKva : null,
    brand: source.brand === null || source.brand === undefined ? null : String(source.brand),
    grounding:
      source.grounding === null || source.grounding === undefined ? null : String(source.grounding),
    location,
    rawCoordinates:
      source.rawCoordinates === null || source.rawCoordinates === undefined
        ? null
        : String(source.rawCoordinates),
    source: source.source === null || source.source === undefined ? null : String(source.source),
    sourceFile:
      source.sourceFile === null || source.sourceFile === undefined ? null : String(source.sourceFile),
    sourceRow:
      source.sourceRow === null || source.sourceRow === undefined ? null : Number(source.sourceRow),
    sourceMetadata,
    analysis: source.analysis as Transformer['analysis'],
    updatedAtDate:
      source.updatedAtDate === null || source.updatedAtDate === undefined
        ? null
        : String(source.updatedAtDate),
    updatedTimeStr:
      source.updatedTimeStr === null || source.updatedTimeStr === undefined
        ? null
        : String(source.updatedTimeStr),
  };
}

export function normalizeTransformerList(payload: unknown): TransformerListData {
  const envelopeRecord = isRecord(payload) ? payload : {};
  const root = unwrapEnvelopeData(payload);
  const rootRecord = isRecord(root) ? root : {};
  const meta = isRecord(envelopeRecord.meta) ? envelopeRecord.meta : null;
  const rawItems = (
    Array.isArray(root)
      ? root
      : firstArray(rootRecord, ['items', 'transformers', 'data.items', 'results'])
  ) as unknown[];
  const items = rawItems.map(normalizeTransformer);
  const paginationSource =
    meta ||
    (isRecord(rootRecord.pagination)
      ? rootRecord.pagination
      : isRecord(envelopeRecord.pagination)
        ? envelopeRecord.pagination
        : Array.isArray(root)
          ? envelopeRecord
          : rootRecord);
  const pagination = normalizePagination(paginationSource);
  const countsSource = isRecord(envelopeRecord.counts)
    ? envelopeRecord.counts
    : isRecord(meta?.counts)
      ? meta.counts
      : isRecord(rootRecord.counts)
        ? rootRecord.counts
        : rootRecord;
  const transformerCountsSource = isRecord(countsSource.transformers)
    ? countsSource.transformers
    : isRecord(countsSource.transformer)
      ? countsSource.transformer
      : countsSource;
  const counts: TransformerCounts = {
    total: Math.trunc(firstNumber(transformerCountsSource, ['total', 'totalTrafo', 'totalTransformers'])),
    analyzable: Math.trunc(firstNumber(transformerCountsSource, ['analyzable', 'analyzableTotal'])),
    notAnalyzable: Math.trunc(
      firstNumber(transformerCountsSource, ['notAnalyzable', 'notAnalyzableTotal']),
    ),
    pincang: Math.trunc(firstNumber(transformerCountsSource, ['pincang', 'unbalance', 'totalPincang'])),
    overload: Math.trunc(firstNumber(transformerCountsSource, ['overload', 'totalOverload'])),
  };

  if (counts.total === 0 && pagination.totalItems > 0) counts.total = pagination.totalItems;

  return { items, pagination, counts };
}

function normalizeCustomer(value: unknown): Customer {
  const source = isRecord(value) ? value : {};
  const powerVa =
    source.powerVa === null || source.powerVa === undefined ? null : Number(source.powerVa);
  const sourceMetadata = isRecord(source.sourceMetadata) ? source.sourceMetadata : null;

  return {
    id: String(source.id ?? source._id ?? ''),
    customerId: String(source.customerId ?? ''),
    name: String(source.name ?? ''),
    tariff: source.tariff === null || source.tariff === undefined ? null : String(source.tariff),
    power:
      source.power === null || source.power === undefined
        ? source.powerRaw === null || source.powerRaw === undefined
          ? null
          : String(source.powerRaw)
        : String(source.power),
    powerVa: powerVa !== null && Number.isFinite(powerVa) ? powerVa : null,
    address:
      source.address === null || source.address === undefined ? null : String(source.address),
    feeder: source.feeder === null || source.feeder === undefined ? null : String(source.feeder),
    status: source.status === null || source.status === undefined ? null : String(source.status),
    source: source.source === null || source.source === undefined ? null : String(source.source),
    sourceFile:
      source.sourceFile === null || source.sourceFile === undefined ? null : String(source.sourceFile),
    sourceRow:
      source.sourceRow === null || source.sourceRow === undefined ? null : Number(source.sourceRow),
    sourceMetadata,
    createdAt:
      source.createdAt === null || source.createdAt === undefined ? null : String(source.createdAt),
    updatedAt:
      source.updatedAt === null || source.updatedAt === undefined ? null : String(source.updatedAt),
  };
}

function normalizeGuest(value: unknown): GuestVisit {
  const source = isRecord(value) ? value : {};
  return {
    id: String(source.id ?? source._id ?? ''),
    syncFingerprint: String(source.syncFingerprint ?? ''),
    timestamp: source.timestamp === null || source.timestamp === undefined ? null : String(source.timestamp),
    timestampRaw:
      source.timestampRaw === null || source.timestampRaw === undefined
        ? null
        : String(source.timestampRaw),
    guestName: String(source.guestName ?? ''),
    phone: String(source.phone ?? ''),
    customerId:
      source.customerId === null || source.customerId === undefined
        ? null
        : String(source.customerId),
    purpose: String(source.purpose ?? ''),
    source: String(source.source ?? ''),
    sourceRecordId:
      source.sourceRecordId === null || source.sourceRecordId === undefined
        ? null
        : String(source.sourceRecordId),
    syncedAt:
      source.syncedAt === null || source.syncedAt === undefined ? null : String(source.syncedAt),
    createdAt:
      source.createdAt === null || source.createdAt === undefined ? null : String(source.createdAt),
  };
}

export function normalizeCustomerList(payload: unknown): CustomerListData {
  const envelopeRecord = isRecord(payload) ? payload : {};
  const root = unwrapEnvelopeData(payload);
  const rootRecord = isRecord(root) ? root : {};
  const meta = isRecord(envelopeRecord.meta) ? envelopeRecord.meta : null;
  const rawItems = (
    Array.isArray(root)
      ? root
      : firstArray(rootRecord, ['items', 'customers', 'data.items', 'results'])
  ) as unknown[];
  const items = rawItems.map(normalizeCustomer);
  const paginationSource =
    meta ||
    (isRecord(rootRecord.pagination)
      ? rootRecord.pagination
      : isRecord(envelopeRecord.pagination)
        ? envelopeRecord.pagination
        : Array.isArray(root)
          ? envelopeRecord
          : rootRecord);
  const pagination = normalizePagination(paginationSource);
  if (pagination.totalItems === 0 && items.length > 0) {
    pagination.totalItems = items.length;
    pagination.totalPages = Math.max(1, Math.ceil(items.length / pagination.limit));
  }

  return { items, pagination };
}

export function normalizeGuestList(payload: unknown): GuestListData {
  const envelopeRecord = isRecord(payload) ? payload : {};
  const root = unwrapEnvelopeData(payload);
  const rootRecord = isRecord(root) ? root : {};
  const meta = isRecord(envelopeRecord.meta) ? envelopeRecord.meta : null;
  const rawItems = (
    Array.isArray(root)
      ? root
      : firstArray(rootRecord, ['items', 'guests', 'data.items', 'results'])
  ) as unknown[];
  const items = rawItems.map(normalizeGuest);
  const paginationSource =
    meta ||
    (isRecord(rootRecord.pagination)
      ? rootRecord.pagination
      : isRecord(envelopeRecord.pagination)
        ? envelopeRecord.pagination
        : Array.isArray(root)
          ? envelopeRecord
          : rootRecord);
  const pagination = normalizePagination(paginationSource);
  if (pagination.totalItems === 0 && items.length > 0) {
    pagination.totalItems = items.length;
    pagination.totalPages = Math.max(1, Math.ceil(items.length / pagination.limit));
  }

  return { items, pagination };
}

function normalizeAnalysisStatus(value: unknown): MapPoint['visualStatus'] {
  const status = String(value ?? 'unknown').trim().toLowerCase();
  if (['normal', 'warning', 'critical'].includes(status)) {
    return status as MapPoint['visualStatus'];
  }
  return 'unknown';
}

function normalizeMapPoints(value: unknown): MapPoint[] {
  const featureCollection = isRecord(value) && value.type === 'FeatureCollection';
  const features = featureCollection
    ? Array.isArray(value.features)
      ? value.features
      : []
    : Array.isArray(value)
      ? value
      : [];

  return features.filter(isRecord).flatMap((item) => {
    const properties = isRecord(item.properties) ? item.properties : item;
    const geometry = isRecord(item.geometry) ? item.geometry : null;
    const location = isRecord(properties.location) ? properties.location : null;
    const coordinates =
      properties.coordinates ?? geometry?.coordinates ?? location?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];

    const overloadedValue = properties.overloaded;
    const overloaded =
      overloadedValue === null || overloadedValue === undefined
        ? null
        : Boolean(overloadedValue);
    const capacityKvaValue =
      properties.capacityKva === null || properties.capacityKva === undefined
        ? null
        : Number(properties.capacityKva);

    return [
      {
        id: String(properties.id ?? properties._id ?? item.id ?? item._id ?? ''),
        name: String(properties.name ?? '-'),
        feeder: properties.feeder === null || properties.feeder === undefined
          ? null
          : String(properties.feeder),
        capacity:
          properties.capacity === null || properties.capacity === undefined
            ? null
            : String(properties.capacity),
        capacityKva:
          capacityKvaValue !== null && Number.isFinite(capacityKvaValue)
            ? capacityKvaValue
            : null,
        brand:
          properties.brand === null || properties.brand === undefined
            ? null
            : String(properties.brand),
        grounding:
          properties.grounding === null || properties.grounding === undefined
            ? null
            : String(properties.grounding),
        visualStatus: normalizeAnalysisStatus(properties.visualStatus),
        recommendationStatus: normalizeAnalysisStatus(properties.recommendationStatus),
        overloaded,
        coordinates: [lon, lat] as [number, number],
      },
    ];
  });
}

export function normalizeDashboard(payload: unknown): DashboardData {
  const root = unwrapEnvelopeData(payload);
  const rootRecord = isRecord(root) ? root : {};
  const counts = isRecord(rootRecord.counts)
    ? rootRecord.counts
    : isRecord(rootRecord.summary)
      ? rootRecord.summary
      : isRecord(rootRecord.statistics)
        ? rootRecord.statistics
        : rootRecord;
  const transformerCounts = isRecord(counts.transformers)
    ? counts.transformers
    : isRecord(counts.transformer)
      ? counts.transformer
      : isRecord(counts.trafo)
        ? counts.trafo
        : counts;
  const transformerPeriods = isRecord(transformerCounts.periods)
    ? transformerCounts.periods
    : null;
  const wbpPeriod = transformerPeriods && isRecord(transformerPeriods.wbp)
    ? transformerPeriods.wbp
    : null;
  const customerCounts = isRecord(counts.customers)
    ? counts.customers
    : isRecord(counts.customer)
      ? counts.customer
      : counts;
  const guestCounts = isRecord(counts.guests)
    ? counts.guests
    : isRecord(counts.guest)
      ? counts.guest
      : counts;

  const mapPoints = normalizeMapPoints(
    rootRecord.mapPoints ??
      rootRecord.mapFeatureCollection ??
      firstArray(root, [
        'points',
        'map.points',
        'transformers.mapPoints',
        'transformers.points',
        'data.mapPoints',
      ]),
  );
  const pincangList = firstArray(root, [
    'anomalies.unbalanced',
    'anomalies.unbalanced.items',
    'pincangList',
    'pincangList.items',
    'recentPincang',
    'recentPincang.items',
    'anomalies.pincang',
    'anomalies.pincang.items',
    'transformers.pincang',
    'transformers.pincang.items',
  ]).map(normalizeTransformer);
  const overloadList = firstArray(root, [
    'anomalies.overloaded',
    'anomalies.overloaded.items',
    'overloadList',
    'overloadList.items',
    'recentOverload',
    'recentOverload.items',
    'anomalies.overload',
    'anomalies.overload.items',
    'transformers.overload',
    'transformers.overload.items',
  ]).map(normalizeTransformer);

  const period = rootRecord.period === 'lwbp' ? 'lwbp' : 'wbp';

  return {
    period,
    counts: {
      totalTrafo: Math.trunc(
        firstNumber(transformerCounts, [
          'total',
          'totalTrafo',
          'totalTransformers',
          'transformerTotal',
        ]) ||
          firstNumber(rootRecord, ['transformerTotal', 'totalTrafo', 'totalTransformers']),
      ),
      analyzable: Math.trunc(
        firstNumber(transformerCounts, [
          'analyzable',
          'analyzableTotal',
        ]) ||
          firstNumber(rootRecord, ['analyzable', 'analyzableTotal']),
      ),
      pincang: Math.trunc(
        firstNumber(transformerCounts, [
          'pincang',
          'totalPincang',
          'unbalance',
          'unbalancedTotal',
        ]) ||
          firstNumber(wbpPeriod, [
            'unbalance',
            'unbalancedTotal',
            'pincang',
            'totalPincang',
          ]) ||
          firstNumber(rootRecord, ['totalPincang', 'unbalancedTotal', 'pincang']),
      ),
      overload: Math.trunc(
        firstNumber(transformerCounts, [
          'overload',
          'totalOverload',
          'overloadedTotal',
        ]) ||
          firstNumber(wbpPeriod, [
            'overload',
            'overloadedTotal',
            'totalOverload',
          ]) ||
          firstNumber(rootRecord, ['totalOverload', 'overloadedTotal', 'overload']),
      ),
      notAnalyzable: Math.trunc(
        firstNumber(transformerCounts, [
          'notAnalyzable',
          'notAnalyzableTotal',
        ]) ||
          firstNumber(rootRecord, ['notAnalyzable', 'notAnalyzableTotal']),
      ),
      pelanggan: Math.trunc(
        firstNumber(customerCounts, [
          'total',
          'totalCustomers',
          'customerTotal',
          'pelanggan',
        ]) ||
          firstNumber(rootRecord, ['customerTotal', 'totalCustomers', 'pelanggan']),
      ),
      tamu: Math.trunc(
        firstNumber(guestCounts, ['total', 'totalGuests', 'guestTotal', 'tamu']) ||
          firstNumber(rootRecord, ['guestTotal', 'totalGuests', 'tamu']),
      ),
    },
    mapPoints,
    pincangList,
    overloadList,
  };
}

function normalizeStatus(value: unknown): ImportRowStatus {
  const status = String(value ?? '').trim().toLowerCase();
  if (['insert', 'new', 'inserted', 'tambah', 'baru'].includes(status)) return 'insert';
  if (['update', 'updated', 'perbarui'].includes(status)) return 'update';
  if (['unchanged', 'same', 'sama'].includes(status)) return 'unchanged';
  if (['rejected', 'invalid', 'error', 'failed', 'tidak_valid'].includes(status)) return 'rejected';
  return 'rejected';
}

function normalizeIssueAction(value: unknown): ImportIssueAction {
  const action = String(value ?? '').trim().toLowerCase();
  if (action === 'skip' || action === 'warn') return action;
  return 'reject';
}

function normalizeImportIssue(value: unknown, fallbackRowNumber = 0): ImportIssue {
  if (!isRecord(value)) {
    return {
      rowNumber: fallbackRowNumber,
      field: null,
      code: 'UNKNOWN',
      message: typeof value === 'string' ? value : 'Issue import tidak valid.',
      rawValue: null,
      action: 'reject',
    };
  }

  const rowValue = value.rowNumber ?? value.row ?? value.lineNumber;
  const rowNumber =
    typeof rowValue === 'number' && Number.isFinite(rowValue)
      ? rowValue
      : fallbackRowNumber;
  const rawValue = value.rawValue;
  return {
    rowNumber,
    field: typeof value.field === 'string' && value.field.trim() ? value.field : null,
    code: firstString(value, ['code']) || 'UNKNOWN',
    message: firstString(value, ['message']) || 'Issue import tidak valid.',
    rawValue:
      rawValue === null || rawValue === undefined
        ? null
        : String(rawValue),
    action: normalizeIssueAction(value.action),
  };
}

function normalizeImportRow(value: unknown, index: number): ImportRow {
  if (!isRecord(value)) {
    return {
      rowNumber: index + 1,
      status: 'rejected',
      data: {},
      issues: [],
    };
  }

  const rowValue = value.rowNumber ?? value.row ?? value.lineNumber ?? value.number;
  const rowNumber =
    typeof rowValue === 'number' && Number.isFinite(rowValue) ? rowValue : index + 1;
  const nestedData = isRecord(value.data)
    ? value.data
    : isRecord(value.values)
      ? value.values
      : null;
  const data = nestedData ? { ...nestedData } : {};
  const rawIssues = firstArray(value, ['issues', 'errors']);
  const issues = rawIssues.map((issue) => normalizeImportIssue(issue, rowNumber));

  return {
    rowNumber,
    status: normalizeStatus(value.status),
    data,
    issues,
  };
}

function normalizeImportSummary(source: UnknownRecord): ImportSummary {
  const nested = isRecord(source.summary)
    ? source.summary
    : isRecord(source.counts)
      ? source.counts
      : source;
  const totalRows = Math.max(
    0,
    Math.trunc(firstNumber(nested, ['totalRows', 'total', 'rows', 'rowCount'])),
  );
  const rejectedCount = Math.max(
    0,
    Math.trunc(
      firstNumber(nested, [
        'rejectedCount',
        'rejectedRows',
        'invalidRows',
        'invalid',
        'errorRows',
        'failedRows',
      ]),
    ),
  );
  const insertCount = Math.max(
    0,
    Math.trunc(
      firstNumber(nested, ['insertCount', 'insertedCount', 'newRows', 'insertedRows']),
    ),
  );
  const updateCount = Math.max(
    0,
    Math.trunc(
      firstNumber(nested, ['updateCount', 'updatedCount', 'updateRows', 'updatedRows']),
    ),
  );
  const unchangedCount = Math.max(
    0,
    Math.trunc(
      firstNumber(nested, [
        'unchangedCount',
        'sameRows',
        'unchangedRows',
        'skippedCount',
      ]),
    ),
  );
  const reportedValidRows = Math.trunc(
    firstNumber(nested, ['validRows', 'valid', 'successRows']),
  );
  const validRows =
    reportedValidRows > 0
      ? reportedValidRows
      : Math.max(0, totalRows - rejectedCount);

  return {
    totalRows,
    validRows,
    insertCount,
    updateCount,
    unchangedCount,
    rejectedCount,
  };
}

export function normalizeImportPreview(payload: unknown): ImportPreview {
  const root = unwrapEnvelopeData(payload);
  const rootRecord = isRecord(root) ? root : {};
  const summary = normalizeImportSummary(rootRecord);
  const rawIssues = firstArray(root, ['issues']);
  const issues = rawIssues.map((issue) => normalizeImportIssue(issue));
  const kindValue = firstString(root, ['kind', 'datasetType', 'dataset']).toLowerCase();
  const kind: ImportKind = kindValue === 'customer' ? 'customer' : 'transformer';
  const formatValue = firstString(root, ['format']).toLowerCase();
  const sourceEncodingValue = firstString(root, ['sourceEncoding']).toLowerCase();
  const sourceEncoding =
    sourceEncodingValue === 'cp1252'
      ? 'cp1252'
      : sourceEncodingValue === 'utf-8-sig'
        ? 'utf-8-sig'
        : null;
  const reportedIssueCount = Math.trunc(
    firstNumber(root, ['issueCount', 'issuesCount']),
  );

  return {
    importJobId: firstString(root, ['importJobId', 'jobId']),
    previewToken: firstString(root, ['previewToken', 'importToken', 'token']),
    kind,
    format: formatValue === 'xlsx' ? 'xlsx' : 'csv',
    sourceFilename: firstString(root, ['sourceFilename', 'filename', 'fileName']),
    sourceSha256: firstString(root, ['sourceSha256']),
    sourceEncoding,
    sourceWorksheetName:
      firstString(root, ['sourceWorksheetName', 'worksheetName', 'sheet']) || null,
    expiresAt: firstString(root, ['expiresAt']),
    summary,
    issueCount: reportedIssueCount > 0 ? reportedIssueCount : issues.length,
    issues,
    issuesTruncated: Boolean(rootRecord.issuesTruncated),
  };
}

export function normalizeImportRows(payload: unknown): ImportRow[] {
  const root = unwrapEnvelopeData(payload);
  const items = firstArray(root, ['items', 'rows', 'data']);
  return items.map(normalizeImportRow);
}

export function normalizeImportIssues(payload: unknown): ImportIssue[] {
  const root = unwrapEnvelopeData(payload);
  const items = firstArray(root, ['items', 'issues', 'data']);
  return items.map((issue) => normalizeImportIssue(issue));
}

export function normalizeImportCommit(payload: unknown): ImportCommitResult {
  const root = unwrapEnvelopeData(payload);
  const rootRecord = isRecord(root) ? root : {};
  const result = isRecord(rootRecord.result) ? rootRecord.result : rootRecord;
  const committedAt =
    firstString(rootRecord, ['committedAt']) || new Date(0).toISOString();

  return {
    importJobId: firstString(rootRecord, ['importJobId', 'jobId']),
    status: 'committed',
    committedAt,
    result: {
      insertedCount: Math.trunc(
        firstNumber(result, ['insertedCount', 'inserted', 'newRows']),
      ),
      updatedCount: Math.trunc(
        firstNumber(result, ['updatedCount', 'updated', 'updateRows']),
      ),
      unchangedCount: Math.trunc(
        firstNumber(result, ['unchangedCount', 'sameRows', 'skippedCount']),
      ),
      rejectedCount: Math.trunc(
        firstNumber(result, ['rejectedCount', 'rejected', 'invalidRows']),
      ),
      failedCount: Math.trunc(firstNumber(result, ['failedCount', 'failed'])),
    },
  };
}

export function normalizeExportFormat(value: string | undefined): ExportFormat {
  return value?.toLowerCase() === 'csv' ? 'csv' : 'xlsx';
}

export function normalizeExportDataset(value: string | undefined): ExportDataset {
  const normalized = value?.toLowerCase();
  if (normalized === 'pelanggan' || normalized === 'tamu') return normalized;
  return 'trafo';
}
