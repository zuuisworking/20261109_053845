import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { ModalErrorAlert } from '../ModalErrorAlert';
import { api } from '../../services/api';

interface Props {
  onClose: () => void;
  onRegistered: () => void;
}

export default function ModalRegister({ onClose, onRegistered }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({ adminId: '', username: '', fullName: '', password: '', konfirmasi: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);

  useModalAccessibility(dialogRef, onClose);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
    setError('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.adminId.trim()) {
      setError('ID Admin wajib diisi.');
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(form.adminId.trim())) {
      setError('ID Admin harus 3-64 karakter dan hanya memuat huruf, angka, titik, garis, atau garis bawah.');
      return;
    }
    if (!form.username.trim()) {
      setError('Username wajib diisi.');
      return;
    }
    if (form.username.trim().length < 3) {
      setError('Username minimal 3 karakter.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password minimal 8 karakter.');
      return;
    }
    if (/\s/.test(form.password)) {
      setError('Password tidak boleh mengandung spasi.');
      return;
    }
    if (!/[a-z]/.test(form.password) || !/[A-Z]/.test(form.password) || !/\d/.test(form.password)) {
      setError('Password harus memuat huruf kecil, huruf besar, dan angka.');
      return;
    }
    if (form.password !== form.konfirmasi) {
      setError('Konfirmasi password tidak cocok.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await api.registerAdmin({
        adminId: form.adminId.trim(),
        username: form.username.trim(),
        password: form.password,
        fullName: form.fullName.trim() || undefined,
      });
      onRegistered();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal mendaftarkan admin.');
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
        aria-labelledby="register-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl w-full shadow-2xl"
        style={{ maxWidth: 460 }}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 id="register-modal-title" className="font-bold text-gray-800 flex items-center gap-2">
            <i className="fas fa-user-plus text-plnBlue" aria-hidden="true" />
            Daftarkan Admin Baru
          </h3>
          <button
            type="button"
            aria-label="Tutup modal daftarkan admin"
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
              <label htmlFor="admin-id" className="text-sm font-medium text-gray-700">
                ID Admin <span className="text-red-500">*</span>
              </label>
              <input id="admin-id" type="text" name="adminId" autoComplete="off" minLength={3} maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all" placeholder="Contoh: admin02" value={form.adminId} onChange={handleChange} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="admin-username" className="text-sm font-medium text-gray-700">
                Username <span className="text-red-500">*</span>
              </label>
              <input id="admin-username" type="text" name="username" autoComplete="off" minLength={3} maxLength={64} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all" placeholder="Nama tampilan admin" value={form.username} onChange={handleChange} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="admin-full-name" className="text-sm font-medium text-gray-700">
                Nama Lengkap
              </label>
              <input id="admin-full-name" type="text" name="fullName" autoComplete="name" maxLength={120} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all" placeholder="Opsional" value={form.fullName} onChange={handleChange} />
            </div>
            <div className="space-y-1">
              <label htmlFor="admin-password" className="text-sm font-medium text-gray-700">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input id="admin-password" type={showPass ? 'text' : 'password'} name="password" autoComplete="new-password" className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm pr-10 focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all" placeholder="Minimal 8 karakter" value={form.password} onChange={handleChange} minLength={8} maxLength={128} required />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer" onClick={() => setShowPass((visible) => !visible)} aria-label={showPass ? 'Sembunyikan password admin' : 'Tampilkan password admin'}>
                  <i className={`fas ${showPass ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="admin-password-confirmation" className="text-sm font-medium text-gray-700">
                Konfirmasi Password <span className="text-red-500">*</span>
              </label>
              <input id="admin-password-confirmation" type="password" name="konfirmasi" autoComplete="new-password" maxLength={128} className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all" placeholder="Ulangi password" value={form.konfirmasi} onChange={handleChange} required />
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <button type="button" className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-50 transition-all cursor-pointer" onClick={onClose} disabled={loading}>Batal</button>
              <button type="submit" className="px-5 py-2.5 bg-plnBlue hover:bg-[#008ecf] text-white rounded-xl font-semibold text-sm transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-60" disabled={loading}>
                {loading ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" /> Mendaftarkan...
                  </>
                ) : (
                  <>
                    <i className="fas fa-user-plus mr-2" aria-hidden="true" /> Daftarkan
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
