import React, { useState, useEffect, useRef } from 'react'
import { Transformer } from '../../types'
import { api } from '../../services/api'
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { ModalErrorAlert } from '../ModalErrorAlert';

interface Props {
  mode: 'tambah' | 'edit'
  trafo?: Transformer | null
  onClose: () => void
  onSaved: () => void
}

const emptyForm = {
  name: '',
  feeder: '',
  capacity: '',
  brand: '',
  grounding: '',
  coordinates: '',
}

export default function ModalTambahEditTrafo({ mode, trafo, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useModalAccessibility(dialogRef, onClose)

  useEffect(() => {
    if (mode === 'edit' && trafo) {
      let coordinates = ''
      if (trafo.location?.coordinates) {
        const [lon, lat] = trafo.location.coordinates
        coordinates = `${lat}, ${lon}`
      }
      setForm({
        name: trafo.name || '',
        feeder: trafo.feeder || '',
        capacity: trafo.capacity ?? (trafo.capacityKva ? String(trafo.capacityKva) : ''),
        brand: trafo.brand || '',
        grounding: trafo.grounding || '',
        coordinates,
      })
    } else {
      setForm({ ...emptyForm })
    }
    setError('')
  }, [mode, trafo])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Nama trafo wajib diisi.'); return }

    let location: { type: 'Point'; coordinates: [number, number] } | null = null;
    const coordinateText = form.coordinates.trim();
    if (coordinateText) {
      const parts = coordinateText.split(/[\s,]+/).filter(Boolean);
      const latitude = Number(parts[0]);
      const longitude = Number(parts[1]);
      if (
        parts.length !== 2 ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        setError('Format koordinat tidak valid. Contoh: 3.65562, 98.675804');
        return;
      }
      location = { type: 'Point', coordinates: [longitude, latitude] };
    }

    setLoading(true)
    try {
      const initialCapacity =
        mode === 'edit' && trafo
          ? trafo.capacity ?? (trafo.capacityKva ? String(trafo.capacityKva) : '')
          : '';
      const capacityChanged = form.capacity.trim() !== initialCapacity.trim();
      const existingLocation = mode === 'edit' ? trafo?.location : undefined;
      const locationUnchanged =
        existingLocation?.coordinates?.[0] === location?.coordinates?.[0] &&
        existingLocation?.coordinates?.[1] === location?.coordinates?.[1];
      const payload = {
        name: form.name.trim(),
        feeder: form.feeder.trim() || null,
        capacity: form.capacity.trim() || null,
        capacityKva:
          mode === 'edit' && !capacityChanged
            ? trafo?.capacityKva ?? null
            : null,
        brand: form.brand.trim() || null,
        grounding: form.grounding.trim() || null,
        location,
        rawCoordinates:
          mode === 'edit' && locationUnchanged
            ? trafo?.rawCoordinates ?? null
            : null,
      }
      if (mode === 'tambah') {
        await api.createTransformer(payload)
      } else if (trafo) {
        await api.updateTransformer(trafo.id, payload)
      }
      onSaved()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan data trafo.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const title = mode === 'tambah' ? 'Tambah Trafo Baru' : 'Edit Data Trafo'

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transformer-form-title"
        tabIndex={-1}
        className="bg-white rounded-2xl w-full shadow-2xl"
        style={{ maxWidth: 500 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 id="transformer-form-title" className="font-bold text-gray-800 flex items-center gap-2">
            <i className={`fas ${mode === 'tambah' ? 'fa-plus-circle' : 'fa-edit'} text-plnBlue`} aria-hidden="true" />
            {title}
          </h3>
          <button
            type="button"
            aria-label="Tutup form trafo"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all cursor-pointer"
            onClick={onClose}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <ModalErrorAlert message={error} />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="transformer-name" className="text-sm font-medium text-gray-700">Nama Trafo <span className="text-red-500">*</span></label>
              <input
                id="transformer-name"
                type="text"
                name="name"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                placeholder="Contoh: GI MEDAN 1"
                maxLength={200}
                value={form.name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="transformer-feeder" className="text-sm font-medium text-gray-700">ID Penyulang / Feeder</label>
              <input
                id="transformer-feeder"
                type="text"
                name="feeder"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                placeholder="Contoh: MED-001"
                value={form.feeder}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="transformer-capacity" className="text-sm font-medium text-gray-700">Kapasitas (kVA)</label>
              <input
                id="transformer-capacity"
                type="text"
                name="capacity"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                placeholder="Contoh: 100 kVA"
                value={form.capacity}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="transformer-brand" className="text-sm font-medium text-gray-700">Merek</label>
              <input
                id="transformer-brand"
                type="text"
                name="brand"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                placeholder="Contoh: Siemens"
                value={form.brand}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="transformer-grounding" className="text-sm font-medium text-gray-700">Pentanahan</label>
              <input
                id="transformer-grounding"
                type="text"
                name="grounding"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                placeholder="Contoh: grounding langsung"
                value={form.grounding}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="transformer-coordinates" className="text-sm font-medium text-gray-700">Koordinat</label>
              <input
                id="transformer-coordinates"
                type="text"
                name="coordinates"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                placeholder="Contoh: 3.65562, 98.675804 (lat, lon)"
                value={form.coordinates}
                onChange={handleChange}
              />
              <p className="text-xs text-gray-400">Format: Latitude, Longitude</p>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-50 transition-all cursor-pointer"
                onClick={onClose}
                disabled={loading}
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-plnBlue hover:bg-[#008ecf] text-white rounded-xl font-semibold text-sm transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-60"
                disabled={loading}
              >
                {loading
                  ? <><i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" />Menyimpan...</>
                  : <><i className={`fas ${mode === 'tambah' ? 'fa-plus' : 'fa-save'} mr-2`} aria-hidden="true" />{mode === 'tambah' ? 'Tambah' : 'Simpan'}</>
                }
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
