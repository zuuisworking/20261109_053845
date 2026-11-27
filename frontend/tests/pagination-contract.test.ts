import { describe, expect, it } from 'vitest';
import {
  normalizeCustomerList,
  normalizeGuestList,
  normalizeTransformerList,
} from '../src/services/contracts';

describe('Kontrak paginasi kanonik', () => {
  it('mempertahankan totalPages nol untuk hasil kosong pada seluruh daftar', () => {
    const transformer = normalizeTransformerList({
      data: [],
      meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
      counts: { total: 0 },
    });
    const customer = normalizeCustomerList({
      data: [],
      meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });
    const guest = normalizeGuestList({
      data: [],
      meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });

    expect(transformer.pagination).toEqual({
      page: 1,
      limit: 10,
      totalItems: 0,
      totalPages: 0,
    });
    expect(customer.pagination.totalPages).toBe(0);
    expect(guest.pagination.totalPages).toBe(0);
  });

  it('menghitung totalPages untuk payload lama yang tidak menyertakan nilainya', () => {
    const transformer = normalizeTransformerList({
      data: [],
      pagination: { page: 1, limit: 10, totalItems: 21 },
    });

    expect(transformer.pagination.totalPages).toBe(3);
  });
});
