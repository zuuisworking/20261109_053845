import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../src/context/NotificationContext';
import { DashboardView } from '../src/features/dashboard/DashboardView';
import { normalizeDashboard } from '../src/services/contracts';

vi.mock('../src/features/dashboard/LeafletMap', () => ({
  LeafletMap: ({ points }: { points: unknown[] }) => (
    <div data-testid="leaflet-map">Peta: {points.length} titik</div>
  ),
}));

describe('Dashboard envelope', () => {
  it('mengambil ringkasan dashboard kanonik untuk periode terpilih', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            period: 'wbp',
            summary: {
              transformerTotal: 1238,
              analyzableTotal: 1231,
              unbalancedTotal: 42,
              overloadedTotal: 17,
              notAnalyzableTotal: 7,
              customerTotal: 68742,
              guestTotal: 321,
            },
            anomalies: {
              unbalanced: [],
              overloaded: [],
            },
            mapPoints: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [98.6665, 3.6662],
                },
                properties: {
                  id: 'trafo-1',
                  name: 'Trafo 1',
                  feeder: 'F-01',
                  capacity: '100',
                  capacityKva: 100,
                  visualStatus: 'normal',
                  recommendationStatus: 'normal',
                  overloaded: false,
                },
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <NotificationProvider>
        <DashboardView
          onOpenDetailModal={vi.fn()}
          onNavigateToTrafoView={vi.fn()}
          onNavigateToPelanggan={vi.fn()}
        />
      </NotificationProvider>,
    );

    await waitFor(() => expect(screen.getByText('1.238')).toBeInTheDocument());
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('68.742')).toBeInTheDocument();
    expect(screen.getByText('321 Data Tamu GForm')).toBeInTheDocument();
    expect(screen.getByTestId('leaflet-map')).toHaveTextContent('Peta: 1 titik');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/dashboard?period=wbp');

    await user.click(screen.getByRole('button', { name: 'LWBP' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/dashboard?period=lwbp');
  });

  it('menormalkan ringkasan nested tanpa mengubahnya menjadi nol', () => {
    const dashboard = normalizeDashboard({
      success: true,
      data: {
        period: 'lwbp',
        summary: {
          transformerTotal: 1238,
          analyzableTotal: 1231,
          unbalancedTotal: 42,
          overloadedTotal: 17,
          notAnalyzableTotal: 7,
          customerTotal: 68742,
          guestTotal: 321,
        },
      },
    });

    expect(dashboard.period).toBe('lwbp');
    expect(dashboard.counts).toEqual({
      totalTrafo: 1238,
      analyzable: 1231,
      pincang: 42,
      overload: 17,
      notAnalyzable: 7,
      pelanggan: 68742,
      tamu: 321,
    });
  });
});
