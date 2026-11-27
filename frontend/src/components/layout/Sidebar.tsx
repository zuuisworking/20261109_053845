import React from 'react';

interface SidebarProps {
  collapsed: boolean;
  activePage: 'dashboard' | 'trafo' | 'pelanggan';
  activeTrafoView: 'semua' | 'pincang' | 'overload';
  onNavigatePage: (page: 'dashboard' | 'trafo' | 'pelanggan') => void;
  onNavigateTrafoView: (view: 'semua' | 'pincang' | 'overload') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  activePage,
  activeTrafoView,
  onNavigatePage,
  onNavigateTrafoView,
}) => {
  const [trafoMenuOpen, setTrafoMenuOpen] = React.useState(true);

  const toggleTrafoMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setTrafoMenuOpen(!trafoMenuOpen);
  };

  return (
    <aside
      id="sidebar"
      className={`${
        collapsed ? 'w-20' : 'w-64'
      } bg-gradient-to-b from-[#005b82] to-[#00A2E9] text-white flex flex-col transition-all duration-300 shadow-xl z-20`}
    >
      {/* Brand Header */}
      <div className="p-4 flex items-center gap-3 border-b border-white/10">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center p-1 bg-white/10 shrink-0">
          <img src="/logo_pln.png" alt="Logo PLN" className="w-full h-full object-contain" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="font-bold text-lg leading-tight tracking-wider">SIGAP</h1>
            <p className="text-[10px] text-blue-100 font-medium tracking-widest">ULP LABUHAN</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
        {/* Dashboard */}
        <a
          href="#dashboard"
          onClick={(e) => {
            e.preventDefault();
            onNavigatePage('dashboard');
          }}
          aria-label="Dashboard SIGAP"
          aria-current={activePage === 'dashboard' ? 'page' : undefined}
          className={`flex items-center gap-3 px-3 py-3 rounded-xl font-medium transition-all cursor-pointer ${
            activePage === 'dashboard'
              ? 'bg-white/20 text-white shadow-sm'
              : 'text-blue-100 hover:bg-white/10 hover:text-white'
          }`}
        >
          <i className="fa-solid fa-chart-pie w-5 text-center text-lg" aria-hidden="true"></i>
          {!collapsed && <span className="text-sm">Dashboard SIGAP</span>}
        </a>

        {/* Manajemen Trafo */}
        <div>
          <div
            className={`flex items-center justify-between px-3 py-3 rounded-xl font-medium transition-all ${
              activePage === 'trafo'
                ? 'bg-white/20 text-white shadow-sm'
                : 'text-blue-100 hover:bg-white/10 hover:text-white'
            }`}
          >
            <a
              href="#trafo"
              onClick={(e) => {
                e.preventDefault();
                onNavigatePage('trafo');
              }}
              aria-label="Manajemen Trafo"
              aria-current={activePage === 'trafo' ? 'page' : undefined}
              className="flex items-center gap-3 overflow-hidden cursor-pointer"
            >
              <i className="fa-solid fa-bolt w-5 text-center text-lg" aria-hidden="true"></i>
              {!collapsed && <span className="text-sm">Manajemen Trafo</span>}
            </a>
            {!collapsed && (
              <button
                type="button"
                onClick={toggleTrafoMenu}
                aria-label={trafoMenuOpen ? 'Sembunyikan submenu Manajemen Trafo' : 'Tampilkan submenu Manajemen Trafo'}
                aria-controls="trafo-submenu"
                aria-expanded={trafoMenuOpen}
                className="p-1 hover:bg-white/10 rounded cursor-pointer"
              >
                <i
                  aria-hidden="true"
                  className={`fa-solid fa-chevron-down text-xs transition-transform duration-200 ${
                    trafoMenuOpen ? 'rotate-180' : ''
                  }`}
                ></i>
              </button>
            )}
          </div>

          {/* Submenu */}
          {!collapsed && trafoMenuOpen && (
            <div id="trafo-submenu" className="pl-9 pr-2 py-1 space-y-1">
              <button
                type="button"
                aria-current={activePage === 'trafo' && activeTrafoView === 'semua' ? 'page' : undefined}
                onClick={() => {
                  onNavigatePage('trafo');
                  onNavigateTrafoView('semua');
                }}
                className={`w-full text-left py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  activePage === 'trafo' && activeTrafoView === 'semua'
                    ? 'bg-white/20 text-white'
                    : 'text-blue-100 hover:bg-white/10 hover:text-white'
                }`}
              >
                Semua Data Trafo
              </button>
              <button
                type="button"
                aria-current={activePage === 'trafo' && activeTrafoView === 'pincang' ? 'page' : undefined}
                onClick={() => {
                  onNavigatePage('trafo');
                  onNavigateTrafoView('pincang');
                }}
                className={`w-full text-left py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  activePage === 'trafo' && activeTrafoView === 'pincang'
                    ? 'bg-white/20 text-white'
                    : 'text-blue-100 hover:bg-white/10 hover:text-white'
                }`}
              >
                Data Trafo Pincang
              </button>
              <button
                type="button"
                aria-current={activePage === 'trafo' && activeTrafoView === 'overload' ? 'page' : undefined}
                onClick={() => {
                  onNavigatePage('trafo');
                  onNavigateTrafoView('overload');
                }}
                className={`w-full text-left py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  activePage === 'trafo' && activeTrafoView === 'overload'
                    ? 'bg-white/20 text-white'
                    : 'text-blue-100 hover:bg-white/10 hover:text-white'
                }`}
              >
                Data Trafo Overload
              </button>
            </div>
          )}
        </div>

        {/* Data Pelanggan & Tamu */}
        <a
          href="#pelanggan"
          onClick={(e) => {
            e.preventDefault();
            onNavigatePage('pelanggan');
          }}
          aria-label="Data Pelanggan"
          aria-current={activePage === 'pelanggan' ? 'page' : undefined}
          className={`flex items-center gap-3 px-3 py-3 rounded-xl font-medium transition-all cursor-pointer ${
            activePage === 'pelanggan'
              ? 'bg-white/20 text-white shadow-sm'
              : 'text-blue-100 hover:bg-white/10 hover:text-white'
          }`}
        >
          <i className="fa-solid fa-users w-5 text-center text-lg" aria-hidden="true"></i>
          {!collapsed && <span className="text-sm">Data Pelanggan</span>}
        </a>
      </nav>

      {/* Footer / Version */}
      {!collapsed && (
        <div className="p-4 border-t border-white/10 text-center text-[11px] text-blue-100/70">
          <p>SIGAP ULP LABUHAN</p>
          <p className="text-[10px]">v1.0.0 &copy; PLN 2026</p>
        </div>
      )}
    </aside>
  );
};
