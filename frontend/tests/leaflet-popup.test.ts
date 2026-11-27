import { describe, expect, it, vi } from 'vitest';
import { createTrafoPopupContent } from '../src/features/dashboard/leafletPopup';
import type { MapPoint } from '../src/types';

describe('Leaflet popup escaping', () => {
  it('membangun isi popup dengan textContent dan tidak mengeksekusi HTML database', () => {
    const point: MapPoint = {
      id: 'trafo-1',
      name: '<img src=x onerror="alert(1)">Trafo <b>Uji</b>',
      feeder: '"><script>alert(2)</script>',
      capacity: '<svg onload=alert(3)>',
      capacityKva: 100,
      brand: '',
      grounding: '',
      visualStatus: 'unknown',
      recommendationStatus: 'unknown',
      overloaded: null,
      coordinates: [98.6665, 3.6662],
    };
    const onSelectTrafo = vi.fn();

    const popup = createTrafoPopupContent(point, onSelectTrafo);

    expect(popup.textContent).toContain('<img src=x onerror="alert(1)">Trafo <b>Uji</b>');
    expect(popup.textContent).toContain('"><script>alert(2)</script>');
    expect(popup.querySelector('img')).toBeNull();
    expect(popup.querySelector('script')).toBeNull();
    expect(popup.querySelector('svg')).toBeNull();

    const detailButton = popup.querySelector<HTMLButtonElement>('button');
    expect(detailButton).not.toBeNull();
    detailButton?.click();
    expect(onSelectTrafo).toHaveBeenCalledWith('trafo-1');
  });
});
