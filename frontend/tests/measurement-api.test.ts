import { describe, expect, it, vi } from 'vitest';
import { api } from '../src/services/api';
import type { SaveMeasurementRequest } from '../src/types';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('API kontrak pengukuran', () => {
  it('menggunakan GET untuk membaca dan hanya PUT untuk menyimpan pengukuran', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'success',
          data: { transformerId: 'trafo-1', wbp: null, lwbp: null },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'success',
          data: {
            id: 'measurement-1',
            transformerId: 'trafo-1',
            period: 'wbp',
            voltage: { r: 220, s: 221, t: 222 },
            incoming: { r: 10, s: 11, t: 12, n: 1 },
            branches: [],
            measurementDate: '2026-11-26',
            measurementTime: '08:30',
            source: 'manual',
            sourceRecordKey: null,
            createdAt: '2026-11-26T01:30:00.000Z',
            updatedAt: '2026-11-26T01:30:00.000Z',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await api.getMeasurements('trafo-1');
    const payload: SaveMeasurementRequest = {
      period: 'wbp',
      voltage: { r: 220, s: 221, t: 222 },
      incoming: { r: 10, s: 11, t: 12, n: 1 },
      branches: [
        {
          name: 'Jurusan A',
          r: 1,
          s: 2,
          t: 3,
          n: 0.5,
          fuse: '10 A',
          note: 'Catatan lapangan',
        },
      ],
      measurementDate: '2026-11-26',
      measurementTime: '08:30',
    };
    await api.saveMeasurement('trafo-1', payload);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const getInit = fetchMock.mock.calls[0][1] as RequestInit;
    const putInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(getInit.method).toBe('GET');
    expect(putInit.method).toBe('PUT');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/v1/measurements/trafo-1');
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/v1/measurements/trafo-1');
    expect(JSON.parse(String(putInit.body))).toEqual(payload);
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).not.toContain('POST');
  });
});
