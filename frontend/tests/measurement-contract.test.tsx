import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModalBebanTrafo } from '../src/components/modals/ModalBebanTrafo';
import { ModalDetailTrafo } from '../src/components/modals/ModalDetailTrafo';
import { NotificationProvider } from '../src/context/NotificationContext';
import { api } from '../src/services/api';
import type {
  ApiEnvelope,
  Measurement,
  SaveMeasurementRequest,
  Transformer,
  TransformerMeasurements,
} from '../src/types';

const transformerId = 'trafo-1';

const transformer: Transformer = {
  id: transformerId,
  name: 'Trafo Pengukuran',
  feeder: 'FEEDER-01',
  capacity: '100 kVA',
  capacityKva: 100,
  brand: 'Voltra',
  grounding: 'Ada',
};

const measurement: Measurement = {
  id: 'measurement-1',
  transformerId,
  period: 'wbp',
  voltage: { r: 220, s: 221, t: 222 },
  incoming: { r: 10, s: 11, t: 12, n: 1 },
  branches: [
    {
      name: 'Jurusan A',
      r: 1,
      s: 2,
      t: 3,
      n: 1,
      fuse: '10 A',
      note: 'Hasil Ukur Lapangan',
    },
  ],
  measurementDate: '2026-11-26',
  measurementTime: '08:30',
  source: 'manual',
  sourceRecordKey: null,
  createdAt: '2026-11-26T01:30:00.000Z',
  updatedAt: '2026-11-26T01:30:00.000Z',
};

function envelope<T>(data: T): ApiEnvelope<T> {
  return {
    success: true,
    status: 'success',
    message: '',
    data,
  };
}

function mockMeasurementLoads() {
  const getTransformerById = vi
    .spyOn(api, 'getTransformerById')
    .mockResolvedValue(envelope(transformer));
  const getMeasurements = vi
    .spyOn(api, 'getMeasurements')
    .mockResolvedValue(
      envelope<TransformerMeasurements>({
        transformerId,
        wbp: measurement,
        lwbp: null,
      }),
    );
  return { getTransformerById, getMeasurements };
}

function renderBebanModal(onClose = vi.fn(), onSaved = vi.fn()) {
  render(
    <NotificationProvider>
      <ModalBebanTrafo trafoId={transformerId} onClose={onClose} onSaved={onSaved} />
    </NotificationProvider>,
  );
  return { onClose, onSaved };
}

describe('Kontrak pengukuran trafo frontend', () => {
  it('menghidrasi form dari GET pengukuran kanonis dan metadata trafo terpisah', async () => {
    const { getMeasurements } = mockMeasurementLoads();
    renderBebanModal();

    await waitFor(() => expect(getMeasurements).toHaveBeenCalledWith(transformerId));
    await waitFor(() => expect(screen.getByLabelText('Merek Trafo')).toHaveValue('Voltra'));

    expect(screen.getByLabelText('Kondisi Grounding')).toHaveValue('Ada');
    expect(screen.getByLabelText('Tanggal Pengukuran')).toHaveValue('2026-11-26');
    expect(screen.getByLabelText('Jam Pengukuran')).toHaveValue('08:30');
    expect(screen.getByLabelText('Tegangan R-N')).toHaveValue(220);
    expect(screen.getByLabelText('Tegangan S-N')).toHaveValue(221);
    expect(screen.getByLabelText('Tegangan T-N')).toHaveValue(222);
    expect(screen.getByLabelText('Incoming R (A)')).toHaveValue(10);
    expect(screen.getByLabelText('Incoming S (A)')).toHaveValue(11);
    expect(screen.getByLabelText('Incoming T (A)')).toHaveValue(12);
    expect(screen.getByLabelText('Incoming N (A)')).toHaveValue(1);
    expect(screen.getByLabelText('Nama jurusan 1')).toHaveValue('Jurusan A');
    expect(screen.getByLabelText('Fuse jurusan 1')).toHaveValue('10 A');
  });

  it('menulis metadata melalui updateTransformer dan pengukuran melalui payload PUT kanonis', async () => {
    const user = userEvent.setup();
    mockMeasurementLoads();
    const updateTransformer = vi
      .spyOn(api, 'updateTransformer')
      .mockResolvedValue(envelope({ ...transformer, brand: 'Sintra', grounding: 'Tidak Ada' }));
    const saveMeasurement = vi
      .spyOn(api, 'saveMeasurement')
      .mockResolvedValue(envelope(measurement));
    const { onClose, onSaved } = renderBebanModal();

    await waitFor(() => expect(screen.getByLabelText('Merek Trafo')).toHaveValue('Voltra'));
    await user.clear(screen.getByLabelText('Merek Trafo'));
    await user.type(screen.getByLabelText('Merek Trafo'), 'Sintra');
    await user.selectOptions(screen.getByLabelText('Kondisi Grounding'), 'Tidak Ada');
    await user.clear(screen.getByLabelText('Nama jurusan 1'));
    await user.type(screen.getByLabelText('Nama jurusan 1'), 'Jurusan Baru');
    await user.click(screen.getByRole('button', { name: 'Simpan Pengukuran' }));

    await waitFor(() => {
      expect(updateTransformer).toHaveBeenCalledWith(transformerId, {
        name: 'Trafo Pengukuran',
        feeder: 'FEEDER-01',
        capacity: '100 kVA',
        capacityKva: 100,
        brand: 'Sintra',
        grounding: 'Tidak Ada',
        location: null,
        rawCoordinates: null,
      });
      expect(saveMeasurement).toHaveBeenCalledTimes(1);
    });

    const expectedPayload: SaveMeasurementRequest = {
      period: 'wbp',
      voltage: { r: 220, s: 221, t: 222 },
      incoming: { r: 10, s: 11, t: 12, n: 1 },
      branches: [
        {
          name: 'Jurusan Baru',
          r: 1,
          s: 2,
          t: 3,
          n: 1,
          fuse: '10 A',
          note: 'Hasil Ukur Lapangan',
        },
      ],
      measurementDate: '2026-11-26',
      measurementTime: '08:30',
    };
    expect(saveMeasurement).toHaveBeenCalledWith(transformerId, expectedPayload);
    expect(saveMeasurement.mock.calls[0][1]).not.toHaveProperty('brand');
    expect(saveMeasurement.mock.calls[0][1]).not.toHaveProperty('grounding');
    expect(saveMeasurement.mock.calls[0][1].branches?.[0]).not.toHaveProperty('nama');
    expect(saveMeasurement.mock.calls[0][1].branches?.[0]).not.toHaveProperty('ket');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tidak menulis metadata yang tidak berubah dan tetap menyimpan pengukuran', async () => {
    const user = userEvent.setup();
    mockMeasurementLoads();
    const updateTransformer = vi
      .spyOn(api, 'updateTransformer')
      .mockResolvedValue(envelope(transformer));
    const saveMeasurement = vi
      .spyOn(api, 'saveMeasurement')
      .mockResolvedValue(envelope(measurement));
    renderBebanModal();

    await waitFor(() => expect(screen.getByLabelText('Merek Trafo')).toHaveValue('Voltra'));
    await user.click(screen.getByRole('button', { name: 'Simpan Pengukuran' }));

    await waitFor(() => expect(saveMeasurement).toHaveBeenCalledTimes(1));
    expect(updateTransformer).not.toHaveBeenCalled();
  });

  it('menjaga modal terbuka dan melaporkan penyimpanan sebagian jika metadata berhasil tetapi pengukuran gagal', async () => {
    const user = userEvent.setup();
    mockMeasurementLoads();
    vi.spyOn(api, 'updateTransformer').mockResolvedValue(
      envelope({ ...transformer, brand: 'Sintra' }),
    );
    vi.spyOn(api, 'saveMeasurement').mockRejectedValue(
      new Error('Server pengukuran sedang tidak tersedia.'),
    );
    const { onClose, onSaved } = renderBebanModal();

    await waitFor(() => expect(screen.getByLabelText('Merek Trafo')).toHaveValue('Voltra'));
    await user.clear(screen.getByLabelText('Merek Trafo'));
    await user.type(screen.getByLabelText('Merek Trafo'), 'Sintra');
    await user.click(screen.getByRole('button', { name: 'Simpan Pengukuran' }));

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent('Penyimpanan sebagian berhasil');
    expect(warning).toHaveTextContent('metadata trafo telah disimpan');
    expect(warning).toHaveTextContent('data pengukuran belum berhasil disimpan');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Tersimpan' })).not.toBeInTheDocument();
  });

  it('menampilkan detail kanonis dari GET pengukuran tanpa memakai branch legacy', async () => {
    const { getMeasurements } = mockMeasurementLoads();
    render(
      <ModalDetailTrafo
        trafoId={transformerId}
        onClose={vi.fn()}
        onOpenUkurBeban={vi.fn()}
      />,
    );

    await waitFor(() => expect(getMeasurements).toHaveBeenCalledWith(transformerId));
    await waitFor(() => expect(screen.getByText('Jurusan A')).toBeInTheDocument());
    expect(screen.getByText('Hasil Ukur Lapangan')).toBeInTheDocument();
    expect(screen.getByText('220 V')).toBeInTheDocument();
    expect(screen.getAllByText('10 A').length).toBeGreaterThan(0);
  });
});
