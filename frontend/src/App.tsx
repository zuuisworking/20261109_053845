import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider, useNotification } from './context/NotificationContext';

import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { LoginPage } from './features/auth/LoginPage';
import { DashboardView } from './features/dashboard/DashboardView';
import { TransformerManagementView } from './features/transformers/TransformerManagementView';
import { CustomerAndGuestView } from './features/customers/CustomerAndGuestView';

import { ModalDetailTrafo } from './components/modals/ModalDetailTrafo';
import { ModalBebanTrafo } from './components/modals/ModalBebanTrafo';
import ModalTambahEditTrafo from './components/modals/ModalTambahEditTrafo';
import ModalTambahEditPelanggan from './components/modals/ModalTambahEditPelanggan';
import ModalImportPreview from './components/modals/ModalImportPreview';
import ModalExport from './components/modals/ModalExport';
import ModalUsername from './components/modals/ModalUsername';
import ModalPassword from './components/modals/ModalPassword';
import ModalProfile from './components/modals/ModalProfile';
import ModalRegister from './components/modals/ModalRegister';

import type { ExportDataset, Period, Transformer, Customer, TransformerView } from './types';

type ActivePage = 'dashboard' | 'trafo' | 'pelanggan';

interface ExportContext {
  target: ExportDataset;
  trafoView: TransformerView;
  period: Period;
}

const PAGE_TITLE: Record<ActivePage, string> = {
  dashboard: 'Dashboard',
  trafo: 'Manajemen Trafo',
  pelanggan: 'Data Pelanggan & Tamu',
};

function AppContent() {
  const { user, loading, updateUser } = useAuth();
  const { showNotif } = useNotification();

  const [activePage, setActivePage] = useState<ActivePage>('dashboard');
  const [activeTrafoView, setActiveTrafoView] = useState<TransformerView>('semua');
  const [activePeriod, setActivePeriod] = useState<Period>('wbp');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);

  const [detailTrafoId, setDetailTrafoId] = useState<string | null>(null);
  const [bebanTrafoId, setBebanTrafoId] = useState<string | null>(null);
  const [tambahTrafo, setTambahTrafo] = useState(false);
  const [editTrafo, setEditTrafo] = useState<Transformer | null>(null);

  const [tambahPelanggan, setTambahPelanggan] = useState(false);
  const [editPelanggan, setEditPelanggan] = useState<Customer | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importTarget, setImportTarget] = useState<'trafo' | 'pelanggan'>('trafo');
  const [showExport, setShowExport] = useState(false);
  const [exportContext, setExportContext] = useState<ExportContext>({
    target: 'trafo',
    trafoView: 'semua',
    period: 'wbp',
  });

  const [showUsername, setShowUsername] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <i className="fas fa-bolt text-4xl animate-pulse" style={{ color: '#00A2E9' }} aria-hidden="true" />
          <p className="text-gray-500 text-sm">Memuat SIGAP...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const openImport = (target: 'trafo' | 'pelanggan') => {
    setImportTarget(target);
    setShowImport(true);
  };

  const openTransformerExport = () => {
    setExportContext({ target: 'trafo', trafoView: activeTrafoView, period: activePeriod });
    setShowExport(true);
  };

  const openCustomerExport = (target: ExportDataset) => {
    setExportContext({ target, trafoView: 'semua', period: 'wbp' });
    setShowExport(true);
  };

  const navigateToTrafoView = (view: TransformerView) => {
    setActiveTrafoView(view);
    setActivePage('trafo');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        collapsed={sidebarCollapsed}
        activePage={activePage}
        activeTrafoView={activeTrafoView}
        onNavigatePage={setActivePage}
        onNavigateTrafoView={navigateToTrafoView}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Header
          pageTitle={PAGE_TITLE[activePage]}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
          onOpenProfileModal={() => setShowProfile(true)}
          onOpenUsernameModal={() => setShowUsername(true)}
          onOpenPasswordModal={() => setShowPassword(true)}
          onOpenRegisterModal={() => setShowRegister(true)}
        />

        <main style={{ flex: 1, overflow: 'auto' }}>
          {activePage === 'dashboard' && (
            <DashboardView
              onOpenDetailModal={setDetailTrafoId}
              onNavigateToTrafoView={navigateToTrafoView}
              onNavigateToPelanggan={() => setActivePage('pelanggan')}
            />
          )}
          {activePage === 'trafo' && (
            <TransformerManagementView
              currentView={activeTrafoView}
              period={activePeriod}
              dataRevision={dataRevision}
              onChangeView={setActiveTrafoView}
              onChangePeriod={setActivePeriod}
              onOpenDetailModal={setDetailTrafoId}
              onOpenBebanModal={setBebanTrafoId}
              onOpenTambahModal={() => setTambahTrafo(true)}
              onOpenEditModal={setEditTrafo}
              onOpenImportModal={() => openImport('trafo')}
              onOpenExportModal={openTransformerExport}
            />
          )}
          {activePage === 'pelanggan' && (
            <CustomerAndGuestView
              dataRevision={dataRevision}
              onOpenTambahModal={() => setTambahPelanggan(true)}
              onOpenEditModal={setEditPelanggan}
              onOpenImportModal={() => openImport('pelanggan')}
              onOpenExportModal={openCustomerExport}
            />
          )}
        </main>
      </div>

      <ModalDetailTrafo
        trafoId={detailTrafoId}
        onClose={() => setDetailTrafoId(null)}
        onOpenUkurBeban={(id) => {
          setDetailTrafoId(null);
          setBebanTrafoId(id);
        }}
      />

      <ModalBebanTrafo
        trafoId={bebanTrafoId}
        onClose={() => setBebanTrafoId(null)}
        onSaved={() => {
          setBebanTrafoId(null);
          setDataRevision((revision) => revision + 1);
        }}
      />

      {tambahTrafo && (
        <ModalTambahEditTrafo
          mode="tambah"
          onClose={() => setTambahTrafo(false)}
          onSaved={() => {
            setTambahTrafo(false);
            setDataRevision((revision) => revision + 1);
            showNotif('Berhasil', 'Trafo berhasil ditambahkan.');
          }}
        />
      )}

      {editTrafo && (
        <ModalTambahEditTrafo
          mode="edit"
          trafo={editTrafo}
          onClose={() => setEditTrafo(null)}
          onSaved={() => {
            setEditTrafo(null);
            setDataRevision((revision) => revision + 1);
            showNotif('Berhasil', 'Data trafo berhasil diperbarui.');
          }}
        />
      )}

      {tambahPelanggan && (
        <ModalTambahEditPelanggan
          mode="tambah"
          onClose={() => setTambahPelanggan(false)}
          onSaved={() => {
            setTambahPelanggan(false);
            setDataRevision((revision) => revision + 1);
            showNotif('Berhasil', 'Pelanggan berhasil ditambahkan.');
          }}
        />
      )}

      {editPelanggan && (
        <ModalTambahEditPelanggan
          mode="edit"
          pelanggan={editPelanggan}
          onClose={() => setEditPelanggan(null)}
          onSaved={() => {
            setEditPelanggan(null);
            setDataRevision((revision) => revision + 1);
            showNotif('Berhasil', 'Data pelanggan berhasil diperbarui.');
          }}
        />
      )}

      {showImport && (
        <ModalImportPreview
          defaultTarget={importTarget}
          onClose={() => setShowImport(false)}
          onImported={(result) => {
            setShowImport(false);
            setDataRevision((revision) => revision + 1);
            showNotif(
              'Import Selesai',
              `${(result.result.insertedCount + result.result.updatedCount).toLocaleString('id-ID')} baris berhasil diimpor.`,
            );
          }}
        />
      )}

      {showExport && (
        <ModalExport
          defaultTarget={exportContext.target}
          defaultTrafoView={exportContext.trafoView}
          defaultPeriod={exportContext.period}
          onClose={() => setShowExport(false)}
        />
      )}

      {showUsername && (
        <ModalUsername
          onClose={() => setShowUsername(false)}
          onSaved={(updated) => {
            updateUser(updated);
            setShowUsername(false);
            showNotif('Berhasil', 'Username berhasil diubah.');
          }}
        />
      )}

      {showPassword && (
        <ModalPassword
          onClose={() => setShowPassword(false)}
          onSaved={() => {
            setShowPassword(false);
            showNotif('Berhasil', 'Password berhasil diubah. Silakan masuk kembali.');
          }}
        />
      )}

      {showProfile && (
        <ModalProfile
          onClose={() => setShowProfile(false)}
          onSaved={(updated) => {
            updateUser(updated);
            showNotif('Berhasil', 'Profil berhasil diperbarui.');
          }}
        />
      )}

      {showRegister && user.role === 'superadmin' && (
        <ModalRegister
          onClose={() => setShowRegister(false)}
          onRegistered={() => {
            setShowRegister(false);
            showNotif('Berhasil', 'Admin baru berhasil didaftarkan.');
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <AppContent />
      </NotificationProvider>
    </AuthProvider>
  );
}
