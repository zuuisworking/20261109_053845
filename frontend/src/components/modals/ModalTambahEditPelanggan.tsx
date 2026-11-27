import React, { useState, useEffect, useRef } from 'react'
import { Customer } from '../../types'
import { api } from '../../services/api'
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { ModalErrorAlert } from '../ModalErrorAlert';

interface Props {
  mode: 'tambah' | 'edit'
  pelanggan?: Customer | null
  onClose: () => void
  onSaved: () => void
}

const TARIF_OPTIONS = ['R1', 'R1M', 'R2', 'R3', 'B1', 'B2', 'B3', 'I1', 'I2', 'I3', 'I4', 'P1', 'P2', 'S1', 'S2', 'S3', 'L']
const DAYA_OPTIONS = [450, 900, 1300, 2200, 3500, 4400, 5500, 6600, 7700, 10600, 11000, 13200, 16500, 23000, 33000, 41500, 53000, 66000, 82500]

const emptyForm = {
  customerId: '',
  name: '',
  address: '',
  tariff: '',
  power: '',
}

export default function ModalTambahEditPelanggan({ mode, pelanggan, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const tariffOptions = form.tariff && !TARIF_OPTIONS.includes(form.tariff)
    ? [form.tariff, ...TARIF_OPTIONS]
    : TARIF_OPTIONS

  useModalAccessibility(dialogRef, onClose)

  useEffect(() => {
    if (mode === 'edit' && pelanggan) {
      setForm({
        customerId: pelanggan.customerId || '',
        name: pelanggan.name || '',
        address: pelanggan.address || '',
        tariff: pelanggan.tariff || '',
        power: pelanggan.power || '',
      })
    } else {
      setForm({ ...emptyForm })
    }
    setError('')
  }, [mode, pelanggan])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.customerId.trim()) { setError('ID Pelanggan wajib diisi.'); return }
    if (!/^\d{12}$/.test(form.customerId.trim())) { setError('ID Pelanggan harus terdiri dari tepat 12 digit.'); return }
    if (!form.name.trim()) { setError('Nama pelanggan wajib diisi.'); return }

    const payload = {
      customerId: form.customerId.trim(),
      name: form.name.trim(),
      tariff: form.tariff.trim() || null,
      power: form.power.trim() || null,
      powerVa: null,
      address: form.address.trim() || null,
    }

    setLoading(true)
    try {
      if (mode === 'tambah') {
        await api.createCustomer(payload)
      } else if (pelanggan) {
        await api.updateCustomer(pelanggan.id, payload)
      }
      onSaved()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan data pelanggan.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const title = mode === 'tambah' ? 'Tambah Pelanggan Baru' : 'Edit Data Pelanggan'

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-form-title"
        tabIndex={-1}
        className="bg-white rounded-2xl w-full shadow-2xl"
        style={{ maxWidth: 520 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 id="customer-form-title" className="font-bold text-gray-800 flex items-center gap-2">
            <i className={`fas ${mode === 'tambah' ? 'fa-user-plus' : 'fa-user-edit'} text-plnBlue`} aria-hidden="true" />
            {title}
          </h3>
          <button
            type="button"
            aria-label="Tutup form pelanggan"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all cursor-pointer"
            onClick={onClose}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <ModalErrorAlert message={error} />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="customer-id" className="text-sm font-medium text-gray-700">ID Pelanggan <span className="text-red-500">*</span></label>
              <input
                id="customer-id"
                type="text"
                name="customerId"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all disabled:bg-gray-50 disabled:text-gray-400"
                inputMode="numeric"
                pattern="\d{12}"
                maxLength={12}
                placeholder="Contoh: 106012345678"
                value={form.customerId}
                onChange={handleChange}
                disabled={mode === 'edit'}
                required
              />
              {mode === 'edit' && <p className="text-xs text-gray-400">ID Pelanggan tidak dapat diubah.</p>}
            </div>

            <div className="space-y-1">
              <label htmlFor="customer-name" className="text-sm font-medium text-gray-700">Nama <span className="text-red-500">*</span></label>
              <input
                id="customer-name"
                type="text"
                name="name"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                maxLength={300}
                placeholder="Nama lengkap pelanggan"
                value={form.name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="customer-address" className="text-sm font-medium text-gray-700">Alamat</label>
              <textarea
                id="customer-address"
                name="address"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all resize-none"
                rows={2}
                placeholder="Alamat lengkap"
                value={form.address}
                onChange={handleChange}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="customer-tariff" className="text-sm font-medium text-gray-700">Tarif</label>
                <select
                  id="customer-tariff"
                  name="tariff"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                  value={form.tariff}
                  onChange={handleChange}
                >
                  <option value="">Tidak diisi</option>
                  {tariffOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="customer-power" className="text-sm font-medium text-gray-700">Daya (VA)</label>
                <input
                  id="customer-power"
                  name="power"
                  type="text"
                  inputMode="numeric"
                  list="customer-power-options"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                  placeholder="Contoh: 1.300"
                  value={form.power}
                  onChange={handleChange}
                />
                <datalist id="customer-power-options">
                  {DAYA_OPTIONS.map(d => <option key={d} value={String(d)}>{d.toLocaleString('id-ID')}</option>)}
                </datalist>
              </div>
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
