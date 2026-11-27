import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { ModalErrorAlert } from '../ModalErrorAlert';
import { api } from '../../services/api';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export default function ModalPassword({ onClose, onSaved }: Props) {
  const { clearSession } = useAuth();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({ passwordLama: '', passwordBaru: '', konfirmasi: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);

  useModalAccessibility(dialogRef, onClose);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
    setError('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.passwordLama) {
      setError('Password lama wajib diisi.');
      return;
    }
    if (form.passwordBaru.length < 8) {
      setError('Password baru minimal 8 karakter.');
      return;
    }
    if (/\s/.test(form.passwordBaru)) {
      setError('Password baru tidak boleh mengandung spasi.');
      return;
    }
    if (!/[a-z]/.test(form.passwordBaru) || !/[A-Z]/.test(form.passwordBaru) || !/\d/.test(form.passwordBaru)) {
      setError('Password baru harus memuat huruf kecil, huruf besar, dan angka.');
      return;
    }
    if (form.passwordBaru !== form.konfirmasi) {
      setError('Konfirmasi password tidak cocok.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await api.changePassword(form.passwordLama, form.passwordBaru);
      clearSession();
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal mengubah password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl w-full shadow-2xl"
        style={{ maxWidth: 420 }}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 id="password-modal-title" className="font-bold text-gray-800 flex items-center gap-2">
            <i className="fas fa-lock text-plnBlue" aria-hidden="true" />
            Ganti Password
          </h3>
          <button
            type="button"
            aria-label="Tutup modal ganti password"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all cursor-pointer"
            onClick={onClose}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5">
          <ModalErrorAlert message={error} className="mb-4" />
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="old-password" className="text-sm font-medium text-gray-700">
                Password lama <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="old-password"
                  type={showOld ? 'text' : 'password'}
                  name="passwordLama"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm pr-10 focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                  placeholder="Masukkan password lama"
                  value={form.passwordLama}
                  onChange={handleChange}
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                  onClick={() => setShowOld((visible) => !visible)}
                  aria-label={showOld ? 'Sembunyikan password lama' : 'Tampilkan password lama'}
                >
                  <i className={`fas ${showOld ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="new-password" className="text-sm font-medium text-gray-700">
                Password baru <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showNew ? 'text' : 'password'}
                  name="passwordBaru"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm pr-10 focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                  placeholder="Minimal 8 karakter"
                  value={form.passwordBaru}
                  onChange={handleChange}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                  onClick={() => setShowNew((visible) => !visible)}
                  aria-label={showNew ? 'Sembunyikan password baru' : 'Tampilkan password baru'}
                >
                  <i className={`fas ${showNew ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="confirm-password" className="text-sm font-medium text-gray-700">
                Konfirmasi password baru <span className="text-red-500">*</span>
              </label>
              <input
                id="confirm-password"
                type="password"
                name="konfirmasi"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                placeholder="Ulangi password baru"
                value={form.konfirmasi}
                onChange={handleChange}
                autoComplete="new-password"
                maxLength={128}
                required
              />
            </div>

            <div className="flex gap-3 justify-end pt-1">
              <button type="button" className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-50 transition-all cursor-pointer" onClick={onClose} disabled={loading}>
                Batal
              </button>
              <button type="submit" className="px-5 py-2.5 bg-plnBlue hover:bg-[#008ecf] text-white rounded-xl font-semibold text-sm transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-60" disabled={loading}>
                {loading ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" /> Menyimpan...
                  </>
                ) : (
                  <>
                    <i className="fas fa-lock mr-2" aria-hidden="true" /> Simpan
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
