import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/services/api';

describe('API anomali trafo', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('memakai endpoint kanonik dengan category dan periode terpilih', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'transformer-1',
              name: 'Trafo Pincang',
              feeder: 'F-01',
              capacity: '100 kVA',
              capacityKva: 100,
              analysis: {
                period: 'wbp',
                available: true,
                averageCurrent: 100,
                unbalancePercent: 16,
                nominalCurrent: 144,
                neutralCurrent: 0,
                loadingPercent: 70,
                overloaded: false,
                isPincang: true,
                isOverload: false,
                visualStatus: 'warning',
                recommendationStatus: 'critical',
              },
            },
          ],
          meta: { page: 2, pageSize: 10, total: 11, totalPages: 2 },
          counts: {
            total: 20,
            analyzable: 18,
            notAnalyzable: 2,
            pincang: 11,
            overload: 4,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await api.getTransformerAnomalies({
      category: 'unbalanced',
      page: 2,
      pageSize: 10,
      period: 'wbp',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/v1/transformers/anomalies?category=unbalanced&page=2&pageSize=10&period=wbp',
    );
    expect(response.data.pagination).toEqual({
      page: 2,
      limit: 10,
      totalItems: 11,
      totalPages: 2,
    });
    expect(response.data.counts).toEqual({
      total: 20,
      analyzable: 18,
      notAnalyzable: 2,
      pincang: 11,
      overload: 4,
    });
    expect(response.data.items[0]).toMatchObject({
      id: 'transformer-1',
      name: 'Trafo Pincang',
      analysis: {
        available: true,
        unbalancePercent: 16,
        recommendationStatus: 'critical',
      },
    });
  });
});
