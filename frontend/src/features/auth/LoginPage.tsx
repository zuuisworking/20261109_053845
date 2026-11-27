import { useState, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

export function LoginPage() {
  const { login } = useAuth();
  const { showNotif } = useNotification();
  const [idadmin, setIdadmin] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!idadmin.trim() || !password) {
      showNotif('Peringatan', 'ID Admin dan Kata Sandi wajib diisi!');
      return;
    }

    setLoading(true);
    try {
      await login(idadmin.trim(), password);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terjadi kesalahan saat memvalidasi akun.';
      showNotif('Gagal Masuk', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="login-section" className="h-screen w-full flex items-center justify-center bg-pln-login relative overflow-hidden">
      <div className="glass-panel w-full max-w-md rounded-2xl shadow-2xl p-8 relative z-10 mx-4 border border-white/50">
        <div className="text-center mb-6">
          <img
            src="/logo_pln.png"
            alt="Logo PLN"
            className="h-32 mx-auto mb-4 object-contain transition-all"
          />
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">SIGAP</h1>
          <p className="text-sm text-gray-500 mt-1">
            Sistem Informasi Gardu & Analisis Pelanggan
          </p>
          <div className="mt-3 inline-block px-3 py-1 bg-blue-50 text-plnBlue text-xs font-semibold rounded-full border border-blue-100">
            ULP Labuhan
          </div>
        </div>

        <div className="fade-in">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="idadmin" className="block text-sm font-medium text-gray-700 mb-1">
                ID Admin
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <i className="fa-regular fa-id-badge text-gray-400" aria-hidden="true"></i>
                </div>
                <input
                  type="text"
                  id="idadmin"
                  name="idadmin"
                  autoComplete="username"
                  value={idadmin}
                  onChange={(event) => setIdadmin(event.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-plnBlue focus:border-plnBlue outline-none transition-all text-sm"
                  placeholder="Masukkan ID Admin"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Kata Sandi
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <i className="fa-solid fa-lock text-gray-400" aria-hidden="true"></i>
                </div>
                <input
                  type="password"
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-plnBlue focus:border-plnBlue outline-none transition-all text-sm"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-plnBlue hover:bg-plnDark text-white font-semibold py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all duration-300 disabled:opacity-75 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <i className="fa-solid fa-circle-notch fa-spin mr-2" aria-hidden="true"></i>
                  Memvalidasi...
                </>
              ) : (
                <>
                  Masuk ke Sistem <i className="fa-solid fa-arrow-right-to-bracket ml-2" aria-hidden="true"></i>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
