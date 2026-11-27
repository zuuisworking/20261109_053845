import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ModalExport from '../src/components/modals/ModalExport';
import { api } from '../src/services/api';

describe('Konteks export dataset aktif', () => {
  it('mewarisi filter trafo dan periode aktif ketika export dijalankan', async () => {
    const user = userEvent.setup();
    const exportTransformers = vi.spyOn(api, 'exportTransformers').mockResolvedValue();
    const onClose = vi.fn();

    render(
      <ModalExport
        defaultTarget="trafo"
        defaultTrafoView="overload"
        defaultPeriod="lwbp"
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Overload' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'LWBP' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(exportTransformers).toHaveBeenCalledWith('xlsx', 'overload', 'lwbp');
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
