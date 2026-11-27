import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../src/context/NotificationContext';
import { TransformerManagementView } from '../src/features/transformers/TransformerManagementView';
import { api } from '../src/services/api';

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}));

describe('Pagination trafo', () => {
  it('meminta halaman pertama dan memakai endpoint anomali kanonik saat view berubah', async () => {
    const user = userEvent.setup();
    const listData = {
      items: [],
      pagination: {
        page: 1,
        limit: 10,
        totalItems: 30,
        totalPages: 3,
      },
      counts: {
        total: 30,
        analyzable: 30,
        notAnalyzable: 0,
        pincang: 0,
        overload: 0,
      },
    };
    const getTransformers = vi.spyOn(api, 'getTransformers').mockImplementation(async (params) => ({
      success: true,
      status: 'success',
      message: '',
      data: {
        ...listData,
        pagination: {
          ...listData.pagination,
          page: params?.page ?? 1,
          limit: params?.pageSize ?? 10,
        },
      },
    }));
    const getTransformerAnomalies = vi
      .spyOn(api, 'getTransformerAnomalies')
      .mockImplementation(async (params) => ({
        success: true,
        status: 'success',
        message: '',
        data: {
          ...listData,
          pagination: {
            ...listData.pagination,
            page: params.page ?? 1,
            limit: params.pageSize ?? 10,
          },
        },
      }));

    const props = {
      currentView: 'semua' as const,
      period: 'wbp' as const,
      onChangeView: vi.fn(),
      onChangePeriod: vi.fn(),
      onOpenDetailModal: vi.fn(),
      onOpenBebanModal: vi.fn(),
      onOpenTambahModal: vi.fn(),
      onOpenEditModal: vi.fn(),
      onOpenImportModal: vi.fn(),
      onOpenExportModal: vi.fn(),
    };

    const view = render(
      <NotificationProvider>
        <TransformerManagementView {...props} />
      </NotificationProvider>,
    );

    await waitFor(() => expect(getTransformers).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await waitFor(() => expect(getTransformers).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await waitFor(() => expect(getTransformers).toHaveBeenCalledTimes(3));

    expect(getTransformers.mock.calls[2][0]).toMatchObject({ page: 3, view: 'semua' });

    view.rerender(
      <NotificationProvider>
        <TransformerManagementView {...props} currentView="overload" />
      </NotificationProvider>,
    );

    await waitFor(() => expect(getTransformerAnomalies).toHaveBeenCalledTimes(1));
    expect(getTransformerAnomalies.mock.calls[0][0]).toMatchObject({
      page: 1,
      category: 'overloaded',
      period: 'wbp',
    });
    expect(getTransformers).toHaveBeenCalledTimes(3);
  });
});
