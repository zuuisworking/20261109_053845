import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

function clearBrowserCookies(): void {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') return;

  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=; Max-Age=0; path=/`;
    }
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearBrowserCookies();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = vi.fn(() => 'blob:test');
}
if (!window.URL.revokeObjectURL) {
  window.URL.revokeObjectURL = vi.fn();
}
