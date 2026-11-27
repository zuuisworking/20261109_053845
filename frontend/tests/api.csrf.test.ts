import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  ApiError,
  CSRF_FAILED_EVENT,
  readCsrfCookie,
  UNAUTHORIZED_EVENT,
} from '../src/services/api';

const user = {
  id: 'user-1',
  adminId: 'admin',
  username: 'operator',
  fullName: 'Operator SIGAP',
  email: 'operator@pln.co.id',
  avatar: '',
  role: 'admin' as const,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('API client CSRF dan session handling', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('membaca token CSRF dari cookie sigap_csrf untuk request unsafe', async () => {
    document.cookie = 'sigap_csrf=token-dari-cookie';
    expect(readCsrfCookie()).toBe('token-dari-cookie');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'success',
          message: 'Login berhasil.',
          data: { user },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'success',
          message: 'Pelanggan tersimpan.',
          data: { _id: 'customer-1' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await api.login('admin', 'rahasia');

    const loginInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(loginInit.credentials).toBe('include');
    expect(new Headers(loginInit.headers).get('X-CSRF-Token')).toBeNull();
    expect(JSON.parse(String(loginInit.body))).toEqual({
      adminId: 'admin',
      password: 'rahasia',
    });

    await api.createCustomer({
      customerId: '12345',
      name: 'Pelanggan Uji',
      tariff: 'R1',
      power: '450',
    });

    const unsafeInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(unsafeInit.credentials).toBe('include');
    expect(new Headers(unsafeInit.headers).get('X-CSRF-Token')).toBe('token-dari-cookie');
  });

  it('tidak memakai token dari JSON dan tidak menyimpannya di storage persisten', async () => {
    document.cookie = 'sigap_csrf=token-dari-cookie';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'success',
          message: 'Login berhasil.',
          // Token lama pada payload JSON harus diabaikan sepenuhnya.
          data: { user, csrfToken: 'token-dari-json' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'success',
          message: 'Pelanggan tersimpan.',
          data: { _id: 'customer-1' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await api.login('admin', 'rahasia');
    expect(response.data).not.toHaveProperty('csrfToken');

    await api.createCustomer({
      customerId: '12345',
      name: 'Pelanggan Uji',
      tariff: 'R1',
      power: '450',
    });

    const unsafeInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(new Headers(unsafeInit.headers).get('X-CSRF-Token')).toBe('token-dari-cookie');
    expect(new Headers(unsafeInit.headers).get('X-CSRF-Token')).not.toBe('token-dari-json');

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.getItem('csrfToken')).toBeNull();
    expect(window.sessionStorage.getItem('csrfToken')).toBeNull();
  });

  it('tidak mengirim header CSRF ketika cookie sigap_csrf tidak tersedia', async () => {
    expect(readCsrfCookie()).toBeNull();

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'success',
        message: 'Pelanggan tersimpan.',
        data: { _id: 'customer-1' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.createCustomer({
      customerId: '12345',
      name: 'Pelanggan Uji',
      tariff: 'R1',
      power: '450',
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBeNull();
  });

  it('menangani CSRF_FAILED secara deliberat tanpa mengulang request', async () => {
    document.cookie = 'sigap_csrf=token-dari-cookie';
    const csrfFailed = vi.fn();
    window.addEventListener(CSRF_FAILED_EVENT, csrfFailed);

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'CSRF_FAILED',
            message: 'Origin atau token CSRF tidak valid.',
          },
        },
        403,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      api.createCustomer({
        customerId: '12345',
        name: 'Pelanggan Uji',
        tariff: 'R1',
        power: '450',
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'CSRF_FAILED',
      message: 'Origin atau token CSRF tidak valid.',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(csrfFailed).toHaveBeenCalledTimes(1);
    window.removeEventListener(CSRF_FAILED_EVENT, csrfFailed);
  });

  it('tidak memasang Content-Type JSON untuk multipart import', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          importJobId: 'job-1',
          previewToken: 'token-1',
          kind: 'transformer',
          format: 'csv',
          sourceFilename: 'trafo.csv',
          sourceSha256: 'a'.repeat(64),
          sourceEncoding: 'utf-8-sig',
          sourceWorksheetName: null,
          expiresAt: '2026-11-28T00:00:00.000Z',
          summary: {
            totalRows: 1,
            validRows: 1,
            insertCount: 1,
            updateCount: 0,
            unchangedCount: 0,
            rejectedCount: 0,
          },
          issueCount: 0,
          issues: [],
          issuesTruncated: false,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['nama;penyulang'], 'trafo.csv', { type: 'text/csv' });
    await api.previewImport(file, 'trafo');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).get('Content-Type')).toBeNull();
  });

  it('mengunggah avatar sebagai file dan tetap kompatibel dengan nama field avatar', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'MALFORMED_MULTIPART',
              message: 'Permintaan file tidak valid.',
            },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'success',
          message: 'Avatar berhasil diperbarui.',
          data: { user, avatar: '/api/v1/auth/avatar/user-1' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    const response = await api.uploadAvatar(file);

    expect(response.data.avatar).toBe('/api/v1/auth/avatar/user-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = fetchMock.mock.calls[0][1].body as FormData;
    const secondBody = fetchMock.mock.calls[1][1].body as FormData;
    expect(firstBody.has('file')).toBe(true);
    expect(firstBody.has('avatar')).toBe(false);
    expect(secondBody.has('avatar')).toBe(true);
    expect(secondBody.has('file')).toBe(false);
  });

  it('memakai envelope pagination kanonik dan parameter q/pageSize', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'trafo-1', name: 'ML.391' }],
        meta: { page: 2, pageSize: 25, total: 26, totalPages: 2 },
        counts: {
          total: 26,
          analyzable: 22,
          notAnalyzable: 4,
          pincang: 3,
          overload: 1,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await api.getTransformers({
      page: 2,
      pageSize: 25,
      q: 'ML.391',
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/v1/transformers?page=2&pageSize=25&q=ML.391',
    );
    expect(response.data.items).toHaveLength(1);
    expect(response.data.pagination).toEqual({
      page: 2,
      limit: 25,
      totalItems: 26,
      totalPages: 2,
    });
    expect(response.data.counts).toEqual({
      total: 26,
      analyzable: 22,
      notAnalyzable: 4,
      pincang: 3,
      overload: 1,
    });
  });

  it('menandai sesi tidak valid ketika server mengembalikan 401', async () => {
    const unauthorized = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Sesi tidak valid.',
            },
          },
          401,
        ),
      ),
    );

    await expect(api.getCustomers({ page: 1, limit: 10 })).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Sesi tidak valid.',
    });
    expect(unauthorized).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized);
  });

  it('menyertakan kode error kanonik pada ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'CSRF_FAILED',
              message: 'Origin atau token CSRF tidak valid.',
            },
          },
          403,
        ),
      ),
    );

    const error = await api.getCustomers().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('CSRF_FAILED');
  });
});
