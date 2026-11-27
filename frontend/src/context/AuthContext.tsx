import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, CSRF_FAILED_EVENT, UNAUTHORIZED_EVENT } from '../services/api';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (idadmin: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  clearSession: () => void;
  updateUser: (updated: Partial<User>) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    api
      .getMe()
      .then((response) => {
        if (!active) return;
        setUser(response.data.user ?? null);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setLoading(false);
    };

    const handleCsrfFailure = async () => {
      // The rejected state-changing request is never retried automatically.
      // Refresh the session context once with a safe request; if the session is
      // still unusable, the operator must sign in again deliberately.
      try {
        const response = await api.getMe();
        setUser(response.data.user ?? null);
      } catch {
        setUser(null);
      }
      setLoading(false);
    };

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    window.addEventListener(CSRF_FAILED_EVENT, handleCsrfFailure);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
      window.removeEventListener(CSRF_FAILED_EVENT, handleCsrfFailure);
    };
  }, []);

  const login = async (idadmin: string, pass: string) => {
    const response = await api.login(idadmin, pass);
    if (
      !response.data.user ||
      (!response.data.user.id &&
        !response.data.user.adminId &&
        !response.data.user.username)
    ) {
      throw new Error('Server tidak mengembalikan data akun. Silakan coba lagi.');
    }
    setUser(response.data.user);
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  };

  const clearSession = () => {
    setUser(null);
  };

  const updateUser = (updated: Partial<User>) => {
    setUser((previous) => (previous ? { ...previous, ...updated } : previous));
  };

  const value = useMemo(
    () => ({ user, loading, login, logout, clearSession, updateUser }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth harus digunakan di dalam AuthProvider.');
  return context;
}
