import type {
  ApiEnvelope,
  AuthSession,
  Customer,
  CustomerListData,
  CustomerWritePayload,
  DashboardData,
  DatasetType,
  ExportFormat,
  GuestListData,
  ImportCommitResult,
  ImportIssue,
  ImportPreview,
  ImportRow,
  Measurement,
  Period,
  SaveMeasurementRequest,
  Transformer,
  TransformerListData,
  TransformerWritePayload,
  TransformerMeasurements,
  User,
} from '../types';
import {
  isRecord,
  normalizeCustomerList,
  normalizeDashboard,
  normalizeGuestList,
  normalizeImportCommit,
  normalizeImportIssues,
  normalizeImportPreview,
  normalizeImportRows,
  normalizeTransformerList,
  normalizeUser,
} from './contracts';

const BASE_URL = '/api/v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UNAUTHORIZED_EVENT = 'sigap:unauthorized';
const CSRF_FAILED_EVENT = 'sigap:csrf-failed';
const CSRF_COOKIE_NAME = 'sigap_csrf';

interface ApiRequestOptions extends RequestInit {
  authenticated?: boolean;
}

interface AvatarUploadData {
  avatar: string;
  user?: User;
}

export interface ImportPreviewOptions {
  encoding?: 'utf-8-sig' | 'cp1252' | 'auto';
  sheet?: string;
  mapping?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  readonly code?: string;

  constructor(message: string, status: number, details?: unknown, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

/**
 * Reads the same-origin `sigap_csrf` cookie. The token is never returned by the
 * API in JSON, never kept in module state, and never written to
 * localStorage/sessionStorage: it is read from the cookie jar per request.
 */
export function readCsrfCookie(): string | null {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') {
    return null;
  }

  const prefix = `${CSRF_COOKIE_NAME}=`;
  for (const entry of document.cookie.split(';')) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith(prefix)) continue;

    const rawValue = trimmed.slice(prefix.length);
    if (!rawValue) return null;

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isUnsafeMethod(method: string | undefined): boolean {
  return !SAFE_METHODS.has((method || 'GET').toUpperCase());
}

function applyCsrfHeader(headers: Headers, method: string, authenticated: boolean): void {
  if (!authenticated || !isUnsafeMethod(method)) return;

  const token = readCsrfCookie();
  if (token) {
    headers.set('X-CSRF-Token', token);
  }
}

function statusMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Permintaan tidak valid. Periksa kembali data yang Anda kirim.';
    case 401:
      return 'Sesi Anda telah berakhir atau tidak valid. Silakan masuk kembali.';
    case 403:
      return 'Anda tidak memiliki izin untuk melakukan tindakan ini.';
    case 404:
      return 'Data yang diminta tidak ditemukan.';
    case 409:
      return 'Data sudah ada atau bertentangan dengan data yang tersimpan.';
    case 413:
      return 'Ukuran file terlalu besar. Pilih file yang lebih kecil.';
    case 422:
      return 'Data belum valid. Periksa kembali informasi yang Anda masukkan.';
    case 429:
      return 'Terlalu banyak permintaan. Tunggu sebentar lalu coba kembali.';
    case 500:
      return 'Terjadi kesalahan pada server. Silakan coba kembali.';
    default:
      return `Permintaan gagal (HTTP ${status}). Silakan coba kembali.`;
  }
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (isRecord(payload)) {
    const directMessage = payload.message;
    if (typeof directMessage === 'string' && directMessage.trim()) return directMessage;

    const errorValue = payload.error;
    if (typeof errorValue === 'string' && errorValue.trim()) return errorValue;
    if (isRecord(errorValue) && typeof errorValue.message === 'string' && errorValue.message.trim()) {
      return errorValue.message;
    }

    const details = isRecord(errorValue) ? errorValue.details : payload.details;
    if (Array.isArray(details)) {
      const messages = details
        .map((detail) => {
          if (typeof detail === 'string') return detail;
          if (isRecord(detail) && typeof detail.message === 'string') return detail.message;
          return '';
        })
        .filter(Boolean);
      if (messages.length) return messages.join(' ');
    }
  }

  return statusMessage(status);
}

function extractErrorCode(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  const errorValue = payload.error;
  if (isRecord(errorValue) && typeof errorValue.code === 'string') {
    return errorValue.code;
  }
  if (typeof payload.code === 'string') {
    return payload.code;
  }

  return undefined;
}

function toEnvelope<T>(payload: unknown, response: Response): ApiEnvelope<T> {
  if (!isRecord(payload)) {
    return {
      success: response.ok,
      status: response.ok ? 'success' : 'error',
      message: response.ok ? '' : statusMessage(response.status),
      data: payload as T,
    };
  }

  const hasData = 'data' in payload;
  const looksLikeLegacyEnvelope =
    hasData &&
    ('status' in payload || 'success' in payload || 'ok' in payload || 'message' in payload);
  if (!hasData) {
    return {
      success: response.ok,
      status: response.ok ? 'success' : 'error',
      message: '',
      data: payload as T,
      counts: isRecord(payload.counts) ? payload.counts : undefined,
    };
  }

  const rawSuccess = payload.success ?? payload.ok;
  const rawStatus = payload.status ?? (rawSuccess === false ? 'error' : 'success');
  const success =
    typeof rawSuccess === 'boolean'
      ? rawSuccess
      : looksLikeLegacyEnvelope
        ? String(rawStatus).toLowerCase() === 'success'
        : response.ok;
  const message = typeof payload.message === 'string' ? payload.message : '';

  return {
    success,
    status: String(rawStatus),
    message,
    data: payload.data as T,
    meta: isRecord(payload.meta) ? payload.meta : undefined,
    counts: isRecord(payload.counts) ? payload.counts : undefined,
  };
}

async function parsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  if (contentType.includes('text/')) {
    return response.text();
  }
  return response.blob();
}

function notifyUnauthorized(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
}

function notifyCsrfFailure(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CSRF_FAILED_EVENT));
  }
}

function buildError(response: Response, payload: unknown, authenticated: boolean): ApiError {
  const code = extractErrorCode(payload);

  if (response.status === 401 && authenticated) {
    notifyUnauthorized();
  }
  if (response.status === 403 && code === 'CSRF_FAILED') {
    // The rejected state-changing request is never retried automatically; the
    // application decides deliberately what to do next.
    notifyCsrfFailure();
  }

  return new ApiError(
    extractErrorMessage(payload, response.status),
    response.status,
    payload,
    code,
  );
}

export async function request<T = unknown>(
  endpoint: string,
  options: ApiRequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const { authenticated = true, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const hasBody = fetchOptions.body !== undefined && fetchOptions.body !== null;
  const isMultipart = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;

  if (hasBody && !isMultipart && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  applyCsrfHeader(headers, method, authenticated);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      ...fetchOptions,
      method,
      headers,
      credentials: 'include',
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(
      'Tidak dapat terhubung ke server. Periksa koneksi jaringan Anda lalu coba kembali.',
      0,
      error,
    );
  }

  let payload: unknown;
  try {
    payload = await parsePayload(response);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw buildError(response, payload, authenticated);
  }

  return toEnvelope<T>(payload, response);
}

async function requestBlob(endpoint: string, options: ApiRequestOptions = {}): Promise<{ blob: Blob; filename?: string }> {
  const { authenticated = true, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);
  const method = (fetchOptions.method || 'GET').toUpperCase();
  applyCsrfHeader(headers, method, authenticated);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      ...fetchOptions,
      method,
      headers,
      credentials: 'include',
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(
      'Tidak dapat terhubung ke server. Periksa koneksi jaringan Anda lalu coba kembali.',
      0,
      error,
    );
  }

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await parsePayload(response);
    } catch {
      payload = null;
    }
    throw buildError(response, payload, authenticated);
  }

  return {
    blob: await response.blob(),
    filename: parseContentDisposition(response.headers.get('content-disposition')),
  };
}

function parseContentDisposition(value: string | null): string | undefined {
  if (!value) return undefined;
  const encodedMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }
  const match = value.match(/filename="?([^";]+)"?/i);
  return match?.[1];
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.append(key, String(value));
  });
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

function normalizeUserEnvelope(envelope: ApiEnvelope<User>): ApiEnvelope<User> {
  return { ...envelope, data: normalizeUser(envelope.data) };
}

function normalizeAuthSession(value: unknown): AuthSession {
  const source = isRecord(value) ? value : {};
  const hasDirectUserFields = ['id', '_id', 'adminId', 'idadmin', 'username'].some(
    (key) => key in source,
  );
  const rawUser = isRecord(source.user)
    ? source.user
    : hasDirectUserFields
      ? source
      : {};

  return {
    user: normalizeUser(rawUser),
  };
}

export const api = {
  login: async (idadmin: string, password: string): Promise<ApiEnvelope<AuthSession>> => {
    const envelope = await request<AuthSession>(
      '/auth/login',
      {
        method: 'POST',
        authenticated: false,
        body: JSON.stringify({ adminId: idadmin, password }),
      },
    );
    return {
      ...envelope,
      data: normalizeAuthSession(envelope.data),
    };
  },

  logout: async (): Promise<ApiEnvelope<null>> => {
    const envelope = await request<null>('/auth/logout', { method: 'POST' });
    return envelope;
  },

  getMe: async (): Promise<ApiEnvelope<AuthSession>> => {
    const envelope = await request<AuthSession>('/auth/me');
    return {
      ...envelope,
      data: normalizeAuthSession(envelope.data),
    };
  },

  registerAdmin: async (data: {
    adminId: string;
    username: string;
    password: string;
    fullName?: string;
    email?: string;
  }): Promise<ApiEnvelope<User>> => {
    const envelope = await request<User>('/auth/register-admin', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return normalizeUserEnvelope(envelope);
  },

  changeUsername: async (newUsername: string): Promise<ApiEnvelope<User>> => {
    const envelope = await request<User>('/auth/profile/username', {
      method: 'PUT',
      body: JSON.stringify({ username: newUsername }),
    });
    return normalizeUserEnvelope(envelope);
  },

  changePassword: (oldPassword: string, newPassword: string): Promise<ApiEnvelope<null>> =>
    request<null>('/auth/profile/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword: oldPassword, newPassword }),
    }),

  updateProfile: async (data: {
    fullName?: string | null;
    email?: string | null;
  }): Promise<ApiEnvelope<User>> => {
    const envelope = await request<User>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return normalizeUserEnvelope(envelope);
  },

  uploadAvatar: async (file: File): Promise<ApiEnvelope<AvatarUploadData>> => {
    const sendUpload = (fieldName: 'file' | 'avatar') => {
      const formData = new FormData();
      formData.append(fieldName, file);
      return request<unknown>('/auth/profile/avatar', {
        method: 'POST',
        body: formData,
      });
    };

    let envelope: ApiEnvelope<unknown>;
    try {
      envelope = await sendUpload('file');
    } catch (error) {
      // Some deployments expose a different multipart field name.
      if (!(error instanceof ApiError) || error.status !== 400 || error.code !== 'MALFORMED_MULTIPART') {
        throw error;
      }
      envelope = await sendUpload('avatar');
    }

    const raw = isRecord(envelope.data) ? envelope.data : {};
    const avatar = String(raw.avatar ?? raw.avatarUrl ?? raw.url ?? raw.path ?? '');
    const user = isRecord(raw.user) ? normalizeUser(raw.user) : undefined;
    return { ...envelope, data: { avatar, user } };
  },

  getDashboard: async (
    period: Period = 'wbp',
    signal?: AbortSignal,
  ): Promise<ApiEnvelope<DashboardData>> => {
    const query = buildQuery({ period });
    const envelope = await request<unknown>(`/dashboard${query}`, { signal });
    return { ...envelope, data: normalizeDashboard(envelope.data) };
  },

  getTransformers: async (
    params: {
      page?: number;
      pageSize?: number;
      limit?: number;
      q?: string;
      search?: string;
      feeder?: string;
      view?: string;
      category?: string;
      period?: string;
    } = {},
    signal?: AbortSignal,
  ): Promise<ApiEnvelope<TransformerListData>> => {
    const { limit, search, view, ...canonicalParams } = params;
    const legacyCategory =
      view === undefined
        ? undefined
        : view === 'pincang'
          ? 'unbalanced'
          : view === 'overload'
            ? 'overloaded'
            : 'all';
    const query = buildQuery({
      ...canonicalParams,
      category: canonicalParams.category ?? legacyCategory,
      pageSize: canonicalParams.pageSize ?? limit,
      q: canonicalParams.q ?? search,
    });
    const envelope = await request<unknown>(`/transformers${query}`, { signal });
    return { ...envelope, data: normalizeTransformerList(envelope) };
  },

  getTransformerAnomalies: async (
    params: {
      category: 'unbalanced' | 'overloaded';
      page?: number;
      pageSize?: number;
      limit?: number;
      q?: string;
      search?: string;
      feeder?: string;
      period?: Period;
    },
    signal?: AbortSignal,
  ): Promise<ApiEnvelope<TransformerListData>> => {
    const { limit, search, ...canonicalParams } = params;
    const query = buildQuery({
      ...canonicalParams,
      pageSize: canonicalParams.pageSize ?? limit,
      q: canonicalParams.q ?? search,
    });
    const envelope = await request<unknown>(`/transformers/anomalies${query}`, { signal });
    return { ...envelope, data: normalizeTransformerList(envelope) };
  },

  getTransformerById: (id: string) => request<Transformer>(`/transformers/${encodeURIComponent(id)}`),

  createTransformer: (data: TransformerWritePayload) =>
    request<Transformer>('/transformers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTransformer: (id: string, data: TransformerWritePayload) =>
    request<Transformer>(`/transformers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTransformer: (id: string) =>
    request<null>(`/transformers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getMeasurements: (transformerId: string) =>
    request<TransformerMeasurements>(`/measurements/${encodeURIComponent(transformerId)}`),

  saveMeasurement: (transformerId: string, data: SaveMeasurementRequest) =>
    request<Measurement>(`/measurements/${encodeURIComponent(transformerId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  getCustomers: async (
    params: { page?: number; pageSize?: number; limit?: number; q?: string; search?: string } = {},
    signal?: AbortSignal,
  ): Promise<ApiEnvelope<CustomerListData>> => {
    const { limit, search, ...canonicalParams } = params;
    const query = buildQuery({
      ...canonicalParams,
      pageSize: canonicalParams.pageSize ?? limit,
      q: canonicalParams.q ?? search,
    });
    const envelope = await request<unknown>(`/customers${query}`, { signal });
    return { ...envelope, data: normalizeCustomerList(envelope) };
  },

  createCustomer: (data: CustomerWritePayload) =>
    request<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCustomer: (id: string, data: CustomerWritePayload) =>
    request<Customer>(`/customers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteCustomer: (id: string) =>
    request<null>(`/customers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getGuests: async (
    params: { page?: number; pageSize?: number; limit?: number; q?: string; search?: string } = {},
    signal?: AbortSignal,
  ): Promise<ApiEnvelope<GuestListData>> => {
    const { limit, search, ...canonicalParams } = params;
    const query = buildQuery({
      ...canonicalParams,
      pageSize: canonicalParams.pageSize ?? limit,
      q: canonicalParams.q ?? search,
    });
    const envelope = await request<unknown>(`/guests${query}`, { signal });
    return { ...envelope, data: normalizeGuestList(envelope) };
  },

  syncGuests: () =>
    request<null>('/guests/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  previewImport: async (
    file: File,
    datasetType: DatasetType,
    options: ImportPreviewOptions = {},
  ): Promise<ApiEnvelope<ImportPreview>> => {
    const kind = datasetType === 'pelanggan' ? 'customer' : 'transformer';
    const format = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('kind', kind);
    formData.append('format', format);
    if (options.encoding) formData.append('encoding', options.encoding);
    if (options.sheet) formData.append('sheet', options.sheet);
    if (options.mapping) formData.append('mapping', JSON.stringify(options.mapping));
    const envelope = await request<unknown>('/imports/preview', {
      method: 'POST',
      body: formData,
    });
    return { ...envelope, data: normalizeImportPreview(envelope.data) };
  },

  getImportRows: async (
    importJobId: string,
    params: { page?: number; pageSize?: number } = {},
    signal?: AbortSignal,
  ): Promise<ApiEnvelope<ImportRow[]>> => {
    const query = buildQuery(params);
    const envelope = await request<unknown>(
      `/imports/${encodeURIComponent(importJobId)}/rows${query}`,
      { signal },
    );
    return { ...envelope, data: normalizeImportRows(envelope.data) };
  },

  getImportIssues: async (
    importJobId: string,
    params: { page?: number; pageSize?: number; code?: string } = {},
    signal?: AbortSignal,
  ): Promise<ApiEnvelope<ImportIssue[]>> => {
    const query = buildQuery(params);
    const envelope = await request<unknown>(
      `/imports/${encodeURIComponent(importJobId)}/issues${query}`,
      { signal },
    );
    return { ...envelope, data: normalizeImportIssues(envelope.data) };
  },

  commitImport: async (
    importJobId: string,
    previewToken: string,
  ): Promise<ApiEnvelope<ImportCommitResult>> => {
    const envelope = await request<unknown>('/imports/commit', {
      method: 'POST',
      body: JSON.stringify({ importJobId, previewToken }),
    });
    return { ...envelope, data: normalizeImportCommit(envelope.data) };
  },

  exportTransformers: async (
    format: ExportFormat,
    view = 'semua',
    period = 'wbp',
  ): Promise<void> => {
    const query = buildQuery({ format, view, period });
    const { blob, filename } = await requestBlob(`/exports/transformers${query}`);
    downloadBlob(blob, filename || `SIGAP_Trafo_${view.toUpperCase()}_${period.toUpperCase()}.${format}`);
  },

  exportCustomers: async (format: ExportFormat): Promise<void> => {
    const query = buildQuery({ format });
    const { blob, filename } = await requestBlob(`/exports/customers${query}`);
    downloadBlob(blob, filename || `SIGAP_Data_Pelanggan.${format}`);
  },

  exportGuests: async (format: ExportFormat): Promise<void> => {
    const query = buildQuery({ format });
    const { blob, filename } = await requestBlob(`/exports/guests${query}`);
    downloadBlob(blob, filename || `SIGAP_Data_Tamu_GForm.${format}`);
  },
};

export { CSRF_FAILED_EVENT, UNAUTHORIZED_EVENT };
