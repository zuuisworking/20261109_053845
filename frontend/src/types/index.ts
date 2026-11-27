export type UserRole = 'superadmin' | 'admin';
export type MeasurementPeriodKey = 'wbp' | 'lwbp';
export type Period = MeasurementPeriodKey;
export type TransformerView = 'semua' | 'pincang' | 'overload';
export type DatasetType = 'trafo' | 'pelanggan';
export type ExportDataset = DatasetType | 'tamu';
export type ExportFormat = 'csv' | 'xlsx';

export interface User {
  id: string;
  adminId: string;
  username: string;
  fullName: string | null;
  email: string | null;
  avatar: string;
  role: UserRole;
}

export interface ApiEnvelope<T> {
  success: boolean;
  status: string;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
  counts?: Record<string, unknown>;
}

export interface AuthSession {
  user: User;
}

export interface Analysis {
  period: Period;
  ir: number | null;
  is: number | null;
  it: number | null;
  inVal: number | null;
  iAvg: number | null;
  nominalA: number | null;
  kva: number | null;
  unbalance: number | null;
  loadingPercent: number | null;
  isPincang: boolean;
  isOverload: boolean;
  available?: boolean;
  averageCurrent?: number | null;
  unbalancePercent?: number | null;
  nominalCurrent?: number | null;
  neutralCurrent?: number | null;
  visualStatus?: AnalysisStatus;
  recommendationStatus?: AnalysisStatus;
  overloaded?: boolean | null;
  isApplicable?: boolean;
  loadingApplicable?: boolean;
  labelStatus: string;
  badgeClass: string;
  rekomendasi: string;
}

export interface MeasurementVoltage {
  r: number | null;
  s: number | null;
  t: number | null;
}

export interface MeasurementIncoming {
  r: number | null;
  s: number | null;
  t: number | null;
  n: number | null;
}

export interface MeasurementBranch {
  name: string | null;
  r: number | null;
  s: number | null;
  t: number | null;
  n: number | null;
  fuse: string | null;
  note: string | null;
}

export interface Measurement {
  id: string;
  transformerId: string;
  period: MeasurementPeriodKey;
  voltage: MeasurementVoltage;
  incoming: MeasurementIncoming;
  branches: MeasurementBranch[];
  measurementDate: string | null;
  measurementTime: string | null;
  source: string | null;
  sourceRecordKey: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TransformerMeasurements {
  transformerId: string;
  wbp: Measurement | null;
  lwbp: Measurement | null;
}

export interface SaveMeasurementBranch {
  name: string | null;
  r: number | null;
  s: number | null;
  t: number | null;
  n: number | null;
  fuse: string | null;
  note: string | null;
}

export interface SaveMeasurementRequest {
  period: MeasurementPeriodKey;
  voltage: { r: number; s: number; t: number };
  incoming: { r: number; s: number; t: number; n: number };
  branches?: SaveMeasurementBranch[];
  measurementDate?: string | null;
  measurementTime?: string | null;
}

export interface Transformer {
  id: string;
  name: string;
  feeder: string | null;
  capacity: string | null;
  capacityKva: number | null;
  brand?: string | null;
  grounding?: string | null;
  location?: {
    type: 'Point';
    coordinates: [number, number];
  } | null;
  rawCoordinates?: string | null;
  source?: string | null;
  sourceFile?: string | null;
  sourceRow?: number | null;
  sourceMetadata?: Record<string, unknown> | null;
  analysis?: Analysis | Partial<Record<Period, Analysis>>;
  updatedAtDate?: string | null;
  updatedTimeStr?: string | null;
}

export interface TransformerWritePayload {
  name: string;
  feeder: string | null;
  capacity: string | null;
  capacityKva: number | null;
  brand: string | null;
  grounding: string | null;
  location: {
    type: 'Point';
    coordinates: [number, number];
  } | null;
  rawCoordinates: string | null;
}

export type AnalysisStatus = 'unknown' | 'normal' | 'warning' | 'critical';

export interface MapPoint {
  id: string;
  name: string;
  feeder: string | null;
  capacity: string | null;
  capacityKva: number | null;
  brand: string | null;
  grounding: string | null;
  visualStatus: AnalysisStatus;
  recommendationStatus: AnalysisStatus;
  overloaded: boolean | null;
  coordinates: [number, number];
}

export interface Customer {
  id: string;
  customerId: string;
  name: string;
  tariff: string | null;
  power: string | null;
  powerVa: number | null;
  address: string | null;
  feeder?: string | null;
  status?: string | null;
  source?: string | null;
  sourceFile?: string | null;
  sourceRow?: number | null;
  sourceMetadata?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface GuestVisit {
  id: string;
  syncFingerprint: string;
  timestamp: string | null;
  timestampRaw?: string | null;
  guestName: string;
  phone: string;
  customerId: string | null;
  purpose: string;
  source: string;
  sourceRecordId?: string | null;
  syncedAt?: string | null;
  createdAt?: string | null;
}

export interface Pagination {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface TransformerCounts {
  total: number;
  analyzable: number;
  notAnalyzable: number;
  pincang: number;
  overload: number;
}

export interface TransformerListData {
  items: Transformer[];
  pagination: Pagination;
  counts: TransformerCounts;
}

export interface CustomerWritePayload {
  customerId: string;
  name: string;
  tariff?: string | null;
  power?: string | null;
  powerVa?: number | null;
  address?: string | null;
}

export interface CustomerListData {
  items: Customer[];
  pagination: Pagination;
}

export interface GuestListData {
  items: GuestVisit[];
  pagination: Pagination;
}

export interface DashboardCounts {
  totalTrafo: number;
  analyzable: number;
  pincang: number;
  overload: number;
  notAnalyzable: number;
  pelanggan: number;
  tamu: number;
}

export interface DashboardData {
  period: Period;
  counts: DashboardCounts;
  mapPoints: MapPoint[];
  pincangList: Transformer[];
  overloadList: Transformer[];
}

export type ImportKind = 'transformer' | 'customer';
export type ImportRowStatus = 'insert' | 'update' | 'unchanged' | 'rejected';
export type ImportIssueAction = 'reject' | 'skip' | 'warn';

export interface ImportSummary {
  totalRows: number;
  validRows: number;
  insertCount: number;
  updateCount: number;
  unchangedCount: number;
  rejectedCount: number;
}

export interface ImportIssue {
  rowNumber: number;
  field: string | null;
  code: string;
  message: string;
  rawValue: string | null;
  action: ImportIssueAction;
}

export interface ImportRow {
  rowNumber: number;
  status: ImportRowStatus;
  data: Record<string, unknown>;
  issues: ImportIssue[];
}

export interface ImportPreview {
  importJobId: string;
  previewToken: string;
  kind: ImportKind;
  format: ExportFormat;
  sourceFilename: string;
  sourceSha256: string;
  sourceEncoding: 'utf-8-sig' | 'cp1252' | null;
  sourceWorksheetName: string | null;
  expiresAt: string;
  summary: ImportSummary;
  issueCount: number;
  issues: ImportIssue[];
  issuesTruncated: boolean;
}

export interface ImportCommitCounts {
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  rejectedCount: number;
  failedCount: number;
}

export interface ImportCommitResult {
  importJobId: string;
  status: 'committed';
  committedAt: string;
  result: ImportCommitCounts;
}

export interface ImportPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
