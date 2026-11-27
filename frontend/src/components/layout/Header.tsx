import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

interface HeaderProps {
  pageTitle: string;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenProfileModal: () => void;
  onOpenUsernameModal: () => void;
  onOpenPasswordModal: () => void;
  onOpenRegisterModal: () => void;
}

export function Header({
  pageTitle,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenProfileModal,
  onOpenUsernameModal,
  onOpenPasswordModal,
  onOpenRegisterModal,
}: HeaderProps) {
  const { user, logout } = useAuth();
  const { showNotif } = useNotification();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dropdownOpen) {
        setDropdownOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [dropdownOpen]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const firstMenuItem = dropdownRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstMenuItem?.focus();
  }, [dropdownOpen]);

  const avatarInitials = (user?.username || user?.adminId || 'AS')
    .substring(0, 2)
    .toUpperCase();

  const handleLogout = async () => {
    setDropdownOpen(false);
    try {
      await logout();
    } catch (error) {
      showNotif(
        'Gagal Keluar',
        error instanceof Error ? error.message : 'Sesi tidak dapat berakhir. Silakan coba kembali.',
      );
    }
  };

  const openModal = (callback: () => void) => {
    setDropdownOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    callback();
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const menuItems = Array.from(
      dropdownRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (menuItems.length === 0) return;

    event.preventDefault();
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % menuItems.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + menuItems.length) % menuItems.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = menuItems.length - 1;
    menuItems[nextIndex]?.focus();
  };

  return (
    <header className="h-16 bg-white border-b border-gray-200/80 flex items-center justify-between px-6 z-10 shrink-0">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-controls="sidebar"
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? 'Tampilkan navigasi sidebar' : 'Sembunyikan navigasi sidebar'}
          className="text-gray-500 hover:text-[#00A2E9] p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <i className="fa-solid fa-bars text-lg" aria-hidden="true"></i>
        </button>
        <h2 id="page-title" className="text-xl font-bold text-gray-800">
          {pageTitle}
        </h2>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200/70 px-3 py-1.5 rounded-full text-xs font-semibold text-gray-600">
          <span className="pulse-dot" aria-hidden="true"></span>
          <span>Live Monitoring</span>
        </div>

        <div className="relative" ref={dropdownRef}>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setDropdownOpen((open) => !open)}
            aria-haspopup="menu"
            aria-controls="profile-menu"
            aria-expanded={dropdownOpen}
            aria-label={dropdownOpen ? 'Tutup menu profil' : 'Buka menu profil'}
            className="flex items-center gap-3 p-1.5 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <div className="text-right hidden sm:block">
              <span className="block text-sm font-bold text-gray-800 leading-tight">
                {user?.username || 'Admin SIGAP'}
              </span>
              <span className="text-[11px] text-gray-400 font-medium">Administrator</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#005b82] to-[#00A2E9] text-white flex items-center justify-center font-bold text-sm shadow-md overflow-hidden">
              {user?.avatar ? (
                <img src={user.avatar} alt={`Foto profil ${user.username}`} className="w-full h-full object-cover" />
              ) : (
                avatarInitials
              )}
            </div>
          </button>

          {dropdownOpen && (
            <div
              id="profile-menu"
              role="menu"
              aria-label="Menu profil"
              onKeyDown={handleMenuKeyDown}
              className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-50 fade-in"
            >
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-xs text-gray-400">ID Admin:</p>
                <p className="text-sm font-bold text-[#00A2E9]">{user?.adminId || 'admin'}</p>
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={() => openModal(onOpenProfileModal)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50/60 hover:text-[#00A2E9] transition-colors cursor-pointer text-left"
              >
                <i className="fa-solid fa-user-gear w-4 text-center" aria-hidden="true"></i> Ubah Profil
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => openModal(onOpenUsernameModal)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50/60 hover:text-[#00A2E9] transition-colors cursor-pointer text-left"
              >
                <i className="fa-solid fa-user-pen w-4 text-center" aria-hidden="true"></i> Ganti Username
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => openModal(onOpenPasswordModal)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50/60 hover:text-[#00A2E9] transition-colors cursor-pointer text-left"
              >
                <i className="fa-solid fa-key w-4 text-center" aria-hidden="true"></i> Ganti Sandi
              </button>

              {user?.role === 'superadmin' && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openModal(onOpenRegisterModal)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50/60 hover:text-[#00A2E9] transition-colors cursor-pointer text-left"
                >
                  <i className="fa-solid fa-user-plus w-4 text-center" aria-hidden="true"></i> Tambah Admin
                </button>
              )}

              <div className="border-t border-gray-100 my-1"></div>

              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors cursor-pointer text-left"
              >
                <i className="fa-solid fa-right-from-bracket w-4 text-center" aria-hidden="true"></i> Keluar
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
