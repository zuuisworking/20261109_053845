import type { MapPoint } from '../../types';

const STATUS_LABELS: Record<MapPoint['recommendationStatus'], string> = {
  unknown: 'Belum dapat dinilai',
  normal: 'Normal',
  warning: 'Waspada',
  critical: 'Kritis',
};

function appendDetailRow(
  container: HTMLElement,
  label: string,
  value: string | null | undefined,
  marginClass: string,
): void {
  const row = document.createElement('div');
  row.className = `text-gray-600 ${marginClass}`;

  const labelElement = document.createElement('span');
  labelElement.className = 'font-semibold';
  labelElement.textContent = `${label}: `;
  row.append(labelElement, document.createTextNode(value || '-'));
  container.append(row);
}

export function createTrafoPopupContent(
  point: MapPoint,
  onSelectTrafo: (trafoId: string) => void,
): HTMLDivElement {
  const popupContent = document.createElement('div');
  popupContent.className = 'p-1 text-xs';

  const name = document.createElement('div');
  name.className = 'font-bold text-sm text-[#005b82] mb-1';
  name.textContent = point.name || '-';
  popupContent.append(name);

  appendDetailRow(popupContent, 'Penyulang', point.feeder, 'mb-0.5');
  appendDetailRow(popupContent, 'Kapasitas', point.capacity, 'mb-0.5');
  appendDetailRow(
    popupContent,
    'Status Analisis',
    STATUS_LABELS[point.recommendationStatus],
    'mb-2',
  );

  const detailButton = document.createElement('button');
  detailButton.type = 'button';
  detailButton.className =
    'w-full px-2.5 py-1.5 bg-[#00A2E9] hover:bg-[#008ecf] text-white font-semibold rounded-lg text-xs transition-colors cursor-pointer detail-btn';

  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-circle-info mr-1';
  icon.setAttribute('aria-hidden', 'true');
  detailButton.append(icon, document.createTextNode('Buka Detail'));
  detailButton.addEventListener('click', (event) => {
    event.preventDefault();
    onSelectTrafo(point.id);
  });
  popupContent.append(detailButton);

  return popupContent;
}
