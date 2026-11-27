import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ModalImportPreview from '../src/components/modals/ModalImportPreview';
import { api } from '../src/services/api';
import { normalizeImportCommit, normalizeImportPreview } from '../src/services/contracts';

const canonicalPreview = {
  importJobId: 'import-job-123',
  previewToken: 'preview-token-123',
  kind: 'customer' as const,
  format: 'xlsx' as const,
  sourceFilename: 'pelanggan.xlsx',
  sourceSha256: 'a'.repeat(64),
  sourceEncoding: null,
  sourceWorksheetName: null,
  expiresAt: '2026-11-28T00:00:00.000Z',
  summary: {
    totalRows: 10,
    validRows: 8,
    insertCount: 3,
    updateCount: 2,
    unchangedCount: 3,
    rejectedCount: 2,
  },
  issueCount: 1,
  issues: [
    {
      rowNumber: 4,
      field: 'name',
      code: 'REQUIRED',
      message: 'ID Pelanggan wajib diisi.',
      rawValue: null,
      action: 'reject' as const,
    },
  ],
  issuesTruncated: false,
};

describe('Kontrak import preview dan commit', () => {
  it('menampilkan ringkasan canonical, baris ditolak, dan hanya commit setelah konfirmasi eksplisit', async () => {
    const user = userEvent.setup();
    const previewImport = vi.spyOn(api, 'previewImport').mockResolvedValue({
      success: true,
      status: 'success',
      message: '',
      data: canonicalPreview,
    });
    const getImportRows = vi.spyOn(api, 'getImportRows').mockResolvedValue({
      success: true,
      status: 'success',
      message: '',
      data: [
        {
          rowNumber: 4,
          status: 'rejected',
          data: { name: null },
          issues: [canonicalPreview.issues[0]],
        },
      ],
      meta: { page: 1, pageSize: 15, total: 10, totalPages: 1 },
    });
    const commitImport = vi.spyOn(api, 'commitImport').mockResolvedValue({
      success: true,
      status: 'success',
      message: '',
      data: {
        importJobId: 'import-job-123',
        status: 'committed',
        committedAt: '2026-11-27T00:00:00.000Z',
        result: {
          insertedCount: 3,
          updatedCount: 2,
          unchangedCount: 3,
          rejectedCount: 2,
          failedCount: 0,
        },
      },
    });
    const onImported = vi.fn();

    render(
      <ModalImportPreview
        defaultTarget="pelanggan"
        onClose={vi.fn()}
        onImported={onImported}
      />,
    );

    const file = new File(['id;nama'], 'pelanggan.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await user.upload(screen.getByLabelText('File CSV / XLSX'), file);
    await user.click(screen.getByRole('button', { name: /Pratinjau/ }));

    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(1));
    expect(previewImport.mock.calls[0][0]).toBe(file);
    expect(previewImport.mock.calls[0][1]).toBe('pelanggan');
    await waitFor(() => expect(getImportRows).toHaveBeenCalled());
    expect(
      screen.getByText(
        '2 baris ditolak dan tidak akan diimpor. Periksa kolom Keterangan pada tabel.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('ID Pelanggan wajib diisi.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Konfirmasi Import \(5 baris\)/ })).toBeEnabled();
    expect(commitImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Konfirmasi Import \(5 baris\)/ }));

    await waitFor(() =>
      expect(commitImport).toHaveBeenCalledWith('import-job-123', 'preview-token-123'),
    );
    expect(onImported).toHaveBeenCalledWith(
      expect.objectContaining({
        importJobId: 'import-job-123',
        result: expect.objectContaining({ insertedCount: 3, updatedCount: 2 }),
      }),
    );
  });

  it('mengirim encoding dan mapping header eksplisit ke backend', async () => {
    const user = userEvent.setup();
    const previewImport = vi.spyOn(api, 'previewImport').mockResolvedValue({
      success: true,
      status: 'success',
      message: '',
      data: { ...canonicalPreview, format: 'csv' },
    });

    render(
      <ModalImportPreview
        defaultTarget="trafo"
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    const file = new File(['Kode Trafo'], 'trafo.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('File CSV / XLSX'), file);
    await user.selectOptions(screen.getByLabelText('Encoding CSV'), 'cp1252');
    await user.click(screen.getByText('Mapping kolom lanjutan'));
    await user.click(screen.getByLabelText('Mapping header sumber'));
    await user.paste('{"name":"Kode Trafo"}');
    await user.click(screen.getByRole('button', { name: /Pratinjau/ }));

    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(1));
    expect(previewImport).toHaveBeenCalledWith(file, 'trafo', {
      encoding: 'cp1252',
      mapping: { name: 'Kode Trafo' },
    });
  });

  it('mengirim nama worksheet eksplisit untuk workbook XLSX', async () => {
    const user = userEvent.setup();
    const previewImport = vi.spyOn(api, 'previewImport').mockResolvedValue({
      success: true,
      status: 'success',
      message: '',
      data: canonicalPreview,
    });

    render(
      <ModalImportPreview
        defaultTarget="pelanggan"
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    const file = new File(['id;nama'], 'pelanggan.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await user.upload(screen.getByLabelText('File CSV / XLSX'), file);
    await user.type(screen.getByLabelText('Nama worksheet'), 'Data Pelanggan');
    await user.click(screen.getByRole('button', { name: /Pratinjau/ }));

    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(1));
    expect(previewImport).toHaveBeenCalledWith(file, 'pelanggan', {
      sheet: 'Data Pelanggan',
    });
  });

  it('mengunci kontrol modal selama commit berjalan', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'previewImport').mockResolvedValue({
      success: true,
      status: 'success',
      message: '',
      data: canonicalPreview,
    });
    vi.spyOn(api, 'getImportRows').mockResolvedValue({
      success: true,
      status: 'success',
      message: '',
      data: [],
      meta: { page: 1, pageSize: 15, total: 10, totalPages: 1 },
    });
    vi.spyOn(api, 'commitImport').mockImplementation(() => new Promise(() => undefined));

    render(
      <ModalImportPreview
        defaultTarget="pelanggan"
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    const file = new File(['id;nama'], 'pelanggan.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await user.upload(screen.getByLabelText('File CSV / XLSX'), file);
    await user.click(screen.getByRole('button', { name: /Pratinjau/ }));

    const commitButton = await screen.findByRole('button', {
      name: /Konfirmasi Import \(5 baris\)/,
    });
    await waitFor(() => expect(commitButton).toBeEnabled());
    await user.click(commitButton);

    await waitFor(() => expect(commitButton).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Tutup modal import' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Batal' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ganti File/ })).toBeDisabled();
    expect(screen.getByLabelText('File CSV / XLSX')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Pelanggan' })).toBeDisabled();
  });

  it('membuang file ketika target import berubah agar file lama tidak dipakai untuk dataset lain', async () => {
    const user = userEvent.setup();
    const previewImport = vi.spyOn(api, 'previewImport');

    render(
      <ModalImportPreview
        defaultTarget="trafo"
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    const fileInput = screen.getByLabelText('File CSV / XLSX') as HTMLInputElement;
    const file = new File(['name'], 'trafo.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);

    expect(screen.getByRole('button', { name: /Pratinjau/ })).toBeEnabled();

    await user.click(screen.getByRole('radio', { name: 'Pelanggan' }));

    expect(fileInput.files).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Pratinjau/ })).toBeDisabled();
    expect(previewImport).not.toHaveBeenCalled();
  });

  it('menormalkan preview backend canonical', () => {
    const preview = normalizeImportPreview({
      data: canonicalPreview,
    });

    expect(preview).toEqual(canonicalPreview);
  });

  it('menormalkan hasil commit backend canonical', () => {
    const result = normalizeImportCommit({
      data: {
        importJobId: 'job-1',
        status: 'committed',
        committedAt: '2026-11-27T00:00:00.000Z',
        result: {
          insertedCount: 3,
          updatedCount: 2,
          unchangedCount: 3,
          rejectedCount: 2,
          failedCount: 0,
        },
      },
    });

    expect(result).toEqual({
      importJobId: 'job-1',
      status: 'committed',
      committedAt: '2026-11-27T00:00:00.000Z',
      result: {
        insertedCount: 3,
        updatedCount: 2,
        unchangedCount: 3,
        rejectedCount: 2,
        failedCount: 0,
      },
    });
  });
});
