import { useRef, useState, type FormEvent } from 'react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { ModalErrorAlert } from '../ModalErrorAlert';
import { api } from '../../services/api';
import type { User } from '../../types';

interface Props {
  onClose: () => void;
  onSaved: (updated: Partial<User>) => void;
}

export default function ModalUsername({ onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useModalAccessibility(dialogRef, onClose);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim()) {
      setError('Username tidak boleh kosong.');
      return;
    }
    if (username.trim().length < 3) {
      setError('Username minimal 3 karakter.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await api.changeUsername(username.trim());
      onSaved(response.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal mengubah username.');
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
        aria-labelledby="username-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl w-full shadow-2xl"
        style={{ maxWidth: 400 }}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 id="username-modal-title" className="font-bold text-gray-800 flex items-center gap-2">
            <i className="fas fa-user-edit text-plnBlue" aria-hidden="true" />
            Ganti Username
          </h3>
          <button
            type="button"
            aria-label="Tutup modal ganti username"
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
              <label htmlFor="new-username" className="text-sm font-medium text-gray-700">
                Username baru <span className="text-red-500">*</span>
              </label>
              <input
                id="new-username"
                type="text"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
                placeholder="Masukkan username baru"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setError('');
                }}
                autoFocus
                autoComplete="username"
                minLength={3}
                maxLength={64}
                required
              />
              <p className="text-xs text-gray-400">Minimal 3 karakter.</p>
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
                    <i className="fas fa-save mr-2" aria-hidden="true" /> Simpan
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
