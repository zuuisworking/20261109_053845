import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import type { MapPoint } from '../../types';
import { createTrafoPopupContent } from './leafletPopup';

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: () => string })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface LeafletMapProps {
  points: MapPoint[];
  onSelectTrafo: (trafoId: string) => void;
}

const DENSE_MARKER_THRESHOLD = 600;

export function LeafletMap({ points, onSelectTrafo }: LeafletMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      preferCanvas: true,
    }).setView([3.6662, 98.6665], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => map.invalidateSize({ pan: false }))
        : null;
    resizeObserver?.observe(mapContainerRef.current);

    return () => {
      resizeObserver?.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
        map.removeLayer(layer);
      }
    });

    const validLayers: L.Layer[] = [];
    const useCanvasMarkers = points.length > DENSE_MARKER_THRESHOLD;

    points.forEach((point) => {
      const coordinates = point.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length !== 2) return;

      const [lon, lat] = coordinates;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

      const popupContent = createTrafoPopupContent(point, onSelectTrafo);
      const layer = useCanvasMarkers
        ? L.circleMarker([lat, lon], {
            radius: 4,
            color: '#005b82',
            fillColor: '#00A2E9',
            fillOpacity: 0.8,
            opacity: 0.9,
            weight: 1,
          })
        : L.marker([lat, lon], {
            keyboard: false,
            riseOnHover: false,
          });

      layer.bindPopup(popupContent);
      layer.addTo(map);
      validLayers.push(layer);
    });

    if (validLayers.length > 0) {
      const bounds = L.featureGroup(validLayers).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.08), { animate: false });
    }
  }, [points, onSelectTrafo]);

  return (
    <div className="w-full h-full relative rounded-xl overflow-hidden border border-gray-200 shadow-inner">
      <div
        ref={mapContainerRef}
        role="application"
        aria-label="Peta sebaran gardu trafo ULP Labuhan"
        className="w-full h-full"
        style={{ minHeight: '380px' }}
      />
    </div>
  );
}
