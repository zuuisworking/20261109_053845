import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/services/api';

describe('Kontrak sinkronisasi tamu', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('tidak menerima atau mengirim URL Apps Script dari klien', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            totalFetched: 0,
            insertedCount: 0,
            duplicateSkipped: 0,
            rejectedCount: 0,
            lastSyncTime: '2026-11-27T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.syncGuests();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/guests/sync');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({});
    expect(String(init.body)).not.toContain('customUrl');
    expect(String(init.body)).not.toContain('http');
  });
});
