import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { api, CSRF_FAILED_EVENT, readCsrfCookie } from '../src/services/api';
import type { User } from '../src/types';

const user: User = {
  id: 'user-1',
  adminId: 'admin',
  username: 'operator',
  fullName: 'Operator SIGAP',
  email: 'operator@pln.co.id',
  avatar: '',
  role: 'admin',
};

function AuthProbe() {
  const { user: currentUser, loading } = useAuth();
  if (loading) return <div>Memuat sesi</div>;
  return (
    <div>
      Sesi: {currentUser?.username ?? 'tidak ada'} / {currentUser?.id ?? '-'}
    </div>
  );
}

function userPayload() {
  return {
    user: {
      _id: user.id,
      adminId: user.adminId,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
    },
  };
}

describe('AuthContext', () => {
  it('memulihkan sesi melalui GET /auth/me tanpa menyimpan token di storage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          message: '',
          data: {
            ...userPayload(),
            // Token pada payload JSON tidak boleh dipakai oleh klien.
            csrfToken: 'csrf-from-me',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(screen.getByText('Memuat sesi')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Sesi: operator / user-1')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/auth/me');
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.credentials).toBe('include');
    expect(readCsrfCookie()).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('memulihkan sesi dari payload pengguna langsung', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...userPayload(),
            csrfToken: 'csrf-direct-user',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Sesi: operator / user-1')).toBeInTheDocument());
    expect(readCsrfCookie()).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('menyegarkan konteks sesi ketika CSRF_FAILED tanpa mengulang request yang ditolak', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: userPayload() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Sesi: operator / user-1')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new CustomEvent(CSRF_FAILED_EVENT));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/me');
    expect(screen.getByText('Sesi: operator / user-1')).toBeInTheDocument();
  });

  it('menampilkan kondisi tanpa sesi ketika /auth/me ditolak', async () => {
    vi.spyOn(api, 'getMe').mockRejectedValue(new Error('Sesi tidak valid.'));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Sesi: tidak ada / -')).toBeInTheDocument());
  });
});
