import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ModalTambahEditTrafo from '../src/components/modals/ModalTambahEditTrafo';
import { api } from '../src/services/api';
import type { Transformer } from '../src/types';

const transformer: Transformer = {
  id: 'transformer-1',
  name: 'ML.391',
  feeder: 'FEEDER-01',
  capacity: '500/300/865 kVA',
  capacityKva: null,
  brand: 'Siemens',
  grounding: 'Pentanahan langsung',
  location: { type: 'Point', coordinates: [98.675804, 3.65562] },
};

describe('canonical transformer write payload', () => {
  it('mengirim representasi lengkap dan koordinat longitude-latitude', async () => {
    const user = userEvent.setup();
    const updateTransformer = vi.spyOn(api, 'updateTransformer').mockResolvedValue({
      success: true,
      status: 'success',
      message: '',
      data: transformer,
    });

    render(
      <ModalTambahEditTrafo
        mode="edit"
        trafo={transformer}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const coordinates = screen.getByLabelText('Koordinat');
    await user.clear(coordinates);
    await user.type(coordinates, '3.700000, 98.700000');
    await user.click(screen.getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(updateTransformer).toHaveBeenCalledTimes(1));
    expect(updateTransformer).toHaveBeenCalledWith('transformer-1', {
      name: 'ML.391',
      feeder: 'FEEDER-01',
      capacity: '500/300/865 kVA',
      capacityKva: null,
      brand: 'Siemens',
      grounding: 'Pentanahan langsung',
      location: { type: 'Point', coordinates: [98.7, 3.7] },
      rawCoordinates: null,
    });
  });
});
