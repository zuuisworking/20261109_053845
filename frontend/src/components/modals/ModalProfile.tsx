import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { ModalErrorAlert } from '../ModalErrorAlert';
import { api } from '../../services/api';
import type { User } from '../../types';

interface ModalProfileProps {
  onClose: () => void;
  onSaved: (updated: Partial<User>) => void;
}

export default function ModalProfile({ onClose, onSaved }: ModalProfileProps) {
  const { user } = useAuth();
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useModalAccessibility(dialogRef, onClose);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(user?.avatar || '');
      return;
    }
    const objectUrl = URL.createObjectURL(avatarFile);
    setAvatarPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [avatarFile, user?.avatar]);

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setError('');
    if (!file) {
      setAvatarFile(null);
      return;
    }
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedTypes.has(file.type)) {
      setAvatarFile(null);
      setError('Format avatar harus PNG, JPG, atau WebP.');
      event.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarFile(null);
      setError('Ukuran avatar maksimal 2 MiB.');
      event.target.value = '';
      return;
    }
    setAvatarFile(file);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Format email tidak valid.');
      return;
    }

    setLoading(true);
    try {
      const profileResponse = await api.updateProfile({
        fullName: fullName.trim() || null,
        email: email.trim() || null,
      });
      const updatedUser: Partial<User> = profileResponse.data
        ? {
            fullName: profileResponse.data.fullName,
            email: profileResponse.data.email,
            avatar: profileResponse.data.avatar,
          }
        : { fullName: fullName.trim() || null, email: email.trim() || null };

      if (avatarFile) {
        const avatarResponse = await api.uploadAvatar(avatarFile);
        updatedUser.avatar = avatarResponse.data.avatar || avatarResponse.data.user?.avatar || updatedUser.avatar;
        if (avatarResponse.data.user) {
          updatedUser.fullName = avatarResponse.data.user.fullName;
          updatedUser.email = avatarResponse.data.user.email;
          updatedUser.role = avatarResponse.data.user.role;
        }
      }

      onSaved(updatedUser);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal memperbarui profil.');
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
        aria-labelledby="profile-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl w-full shadow-2xl"
        style={{ maxWidth: 480 }}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 id="profile-modal-title" className="font-bold text-gray-800 flex items-center gap-2">
            <i className="fas fa-user-gear text-plnBlue" aria-hidden="true" />
            Ubah Profil
          </h3>
          <button
            type="button"
            aria-label="Tutup modal ubah profil"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all cursor-pointer"
            onClick={onClose}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <ModalErrorAlert message={error} />

          <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="w-16 h-16 rounded-xl overflow-hidden bg-gradient-to-tr from-[#005b82] to-[#00A2E9] text-white flex items-center justify-center font-bold text-xl shrink-0">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Pratinjau avatar" className="w-full h-full object-cover" />
              ) : (
                (user?.username || user?.adminId || 'AS').substring(0, 2).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <label htmlFor="profile-avatar" className="block text-sm font-medium text-gray-700 mb-1">
                Foto Profil
              </label>
              <input
                ref={fileInputRef}
                id="profile-avatar"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarChange}
                className="block w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-plnBlue file:text-white file:text-xs file:cursor-pointer"
              />
              <p className="text-[11px] text-gray-400 mt-1">PNG, JPG, atau WebP. Maksimal 2 MiB.</p>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="profile-full-name" className="text-sm font-medium text-gray-700">
              Nama Lengkap
            </label>
            <input
              id="profile-full-name"
              type="text"
              value={fullName}
              onChange={(event) => {
                setFullName(event.target.value);
                setError('');
              }}
              autoComplete="name"
              maxLength={120}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
              placeholder="Nama lengkap administrator"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="profile-email" className="text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError('');
              }}
              autoComplete="email"
              maxLength={254}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-plnBlue/30 focus:border-plnBlue transition-all"
              placeholder="email@pln.co.id"
            />
          </div>

          <div className="flex gap-3 justify-end pt-1">
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
  );
}
