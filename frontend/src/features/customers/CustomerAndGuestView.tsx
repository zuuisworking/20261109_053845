import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Customer, ExportDataset, GuestVisit } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

interface CustomerAndGuestViewProps {
  dataRevision?: number;
  onOpenTambahModal: () => void;
  onOpenEditModal: (cust: Customer) => void;
  onOpenImportModal: () => void;
  onOpenExportModal: (target: ExportDataset) => void;
}

export const CustomerAndGuestView: React.FC<CustomerAndGuestViewProps> = ({
  dataRevision = 0,
  onOpenTambahModal,
  onOpenEditModal,
  onOpenImportModal,
  onOpenExportModal,
}) => {
  const { user } = useAuth();
  const { showConfirm, showNotif } = useNotification();
  const canDelete = user?.role === 'superadmin';
  const [activeTab, setActiveTab] = useState<'pelanggan' | 'tamu'>('pelanggan');

  // Customer State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custLoading, setCustLoading] = useState(true);
  const [custSearch, setCustSearch] = useState('');
  const debouncedCustSearch = useDebouncedValue(custSearch, 350);
  const [custPage, setCustPage] = useState(1);
  const [custReloadKey, setCustReloadKey] = useState(0);
  const [custPagination, setCustPagination] = useState({
    page: 1,
    limit: 10,
    totalItems: 0,
    totalPages: 1,
  });

  // Guest State
  const [guests, setGuests] = useState<GuestVisit[]>([]);
  const [guestLoading, setGuestLoading] = useState(true);
  const [guestSearch, setGuestSearch] = useState('');
  const debouncedGuestSearch = useDebouncedValue(guestSearch, 350);
  const [guestPage, setGuestPage] = useState(1);
  const [guestReloadKey, setGuestReloadKey] = useState(0);
  const [guestPagination, setGuestPagination] = useState({
    page: 1,
    limit: 10,
    totalItems: 0,
    totalPages: 1,
  });
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'pelanggan') return;

    let active = true;
    const controller = new AbortController();
    setCustLoading(true);
    api
      .getCustomers(
        {
          page: custPage,
          pageSize: 10,
          q: debouncedCustSearch,
        },
        controller.signal,
      )
      .then((response) => {
        if (!active) return;
        const nextPagination = response.data.pagination;
        const availablePages = Math.max(1, nextPagination.totalPages);
        if (custPage > availablePages) {
          setCustPage(availablePages);
          return;
        }
        setCustomers(response.data.items);
        setCustPagination(nextPagination);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        showNotif(
          'Gagal Memuat Data',
          error instanceof Error ? error.message : 'Data pelanggan tidak dapat dimuat.',
        );
      })
      .finally(() => {
        if (active) setCustLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [activeTab, custPage, debouncedCustSearch, custReloadKey, dataRevision, showNotif]);

  useEffect(() => {
    if (activeTab !== 'tamu') return;

    let active = true;
    const controller = new AbortController();
    setGuestLoading(true);
    api
      .getGuests(
        {
          page: guestPage,
          pageSize: 10,
          q: debouncedGuestSearch,
        },
        controller.signal,
      )
      .then((response) => {
        if (!active) return;
        const nextPagination = response.data.pagination;
        const availablePages = Math.max(1, nextPagination.totalPages);
        if (guestPage > availablePages) {
          setGuestPage(availablePages);
          return;
        }
        setGuests(response.data.items);
        setGuestPagination(nextPagination);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        showNotif(
          'Gagal Memuat Data Tamu',
          error instanceof Error ? error.message : 'Data tamu tidak dapat dimuat.',
        );
      })
      .finally(() => {
        if (active) setGuestLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [activeTab, guestPage, debouncedGuestSearch, guestReloadKey, showNotif]);

  const handleSyncGForm = async () => {
    setSyncing(true);
    try {
      const res = await api.syncGuests();
      showNotif('Sinkronisasi Berhasil', res.message || 'Data tamu berhasil disinkronkan.');
      setLastSyncTime(new Date().toLocaleTimeString('id-ID'));
      setGuestReloadKey((key) => key + 1);
    } catch (error: unknown) {
      showNotif(
        'Gagal Sinkronisasi',
        error instanceof Error ? error.message : 'Pastikan URL Apps Script benar dan dapat diakses.',
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteCustomer = (cust: Customer) => {
    showConfirm(
      'Hapus Data Pelanggan?',
      `Apakah Anda yakin ingin menghapus pelanggan "${cust.name}" (${cust.customerId})?`,
      async () => {
        try {
          await api.deleteCustomer(cust.id);
          showNotif('Berhasil', `Data pelanggan ${cust.name} berhasil dihapus.`);
          setCustReloadKey((key) => key + 1);
        } catch (error: unknown) {
          showNotif(
            'Gagal Menghapus',
            error instanceof Error ? error.message : 'Data pelanggan tidak dapat dihapus.',
          );
        }
      },
      'Ya, Hapus'
    );
  };

  return (
    <div id="content-pelanggan" className="page-content space-y-6 fade-in">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Manajemen Data Pelanggan &amp; Tamu</h2>
          <p className="text-xs text-gray-400 mt-1">
            Kelola direktori pelanggan ULP Labuhan dan sinkronisasi buku tamu dinas Google Form.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => onOpenExportModal(activeTab === 'pelanggan' ? 'pelanggan' : 'tamu')}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2 cursor-pointer"
          >
            <i className="fa-solid fa-file-excel" aria-hidden="true"></i>
            <span>Unduh File</span>
          </button>

          {activeTab === 'pelanggan' && (
            <>
              <button
                type="button"
                onClick={onOpenImportModal}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2 cursor-pointer"
              >
                <i className="fa-solid fa-file-import" aria-hidden="true"></i>
                <span>Impor File</span>
              </button>

              <button
                type="button"
                onClick={onOpenTambahModal}
                className="px-4 py-2 bg-[#00A2E9] hover:bg-[#008ecf] text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 flex items-center gap-2 cursor-pointer"
              >
                <i className="fa-solid fa-plus" aria-hidden="true"></i>
                <span>Tambah</span>
              </button>
            </>
          )}

          {activeTab === 'tamu' && (
            <button
              type="button"
              onClick={handleSyncGForm}
              disabled={syncing}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-75"
            >
              <i className={`fa-solid ${syncing ? 'fa-circle-notch fa-spin' : 'fa-arrows-rotate'}`} aria-hidden="true"></i>
              <span>{syncing ? 'Menyinkronkan...' : 'Sinkronkan GForm'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs & Content */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-4">
        {/* Navigation Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('pelanggan')}
              aria-pressed={activeTab === 'pelanggan'}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'pelanggan'
                  ? 'bg-[#005b82] text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <i className="fa-solid fa-users" aria-hidden="true"></i>
              <span>Data Pelanggan</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20">
                {custPagination.totalItems}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tamu')}
              aria-pressed={activeTab === 'tamu'}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'tamu'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <i className="fa-solid fa-clipboard-user" aria-hidden="true"></i>
              <span>Data Tamu (Google Form)</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20">
                {guestPagination.totalItems.toLocaleString('id-ID')}
              </span>
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
              <i className="fa-solid fa-magnifying-glass text-xs" aria-hidden="true"></i>
            </span>
            <input
              type="text"
              value={activeTab === 'pelanggan' ? custSearch : guestSearch}
              onChange={(e) => {
                if (activeTab === 'pelanggan') {
                  setCustSearch(e.target.value);
                  setCustPage(1);
                } else {
                  setGuestSearch(e.target.value);
                  setGuestPage(1);
                }
              }}
              aria-label={activeTab === 'pelanggan' ? 'Cari pelanggan' : 'Cari tamu'}
              placeholder={
                activeTab === 'pelanggan' ? 'Cari ID / Nama / Alamat...' : 'Cari tamu / keperluan...'
              }
              className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#00A2E9] focus:border-transparent w-full sm:w-64"
            />
          </div>
        </div>

        {/* Tab 1: Pelanggan Table */}
        {activeTab === 'pelanggan' && (
          <div className="space-y-4">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto rounded-xl border border-gray-100">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider sticky top-0 z-10 font-bold border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3.5 whitespace-nowrap">No</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">ID Pelanggan</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">Nama Pelanggan</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">Tarif / Daya</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">Alamat</th>
                    <th className="px-4 py-3.5 text-center whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {custLoading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                        <i className="fa-solid fa-circle-notch fa-spin text-xl text-[#00A2E9] mb-2 block" aria-hidden="true"></i>
                        Memuat data pelanggan...
                      </td>
                    </tr>
                  ) : customers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                        <i className="fa-solid fa-circle-info text-xl text-gray-300 mb-2 block" aria-hidden="true"></i>
                        Tidak ada data pelanggan yang cocok.
                      </td>
                    </tr>
                  ) : (
                    customers.map((c, idx) => {
                      const globalIdx = (custPagination.page - 1) * custPagination.limit + idx + 1;
                      return (
                        <tr key={c.id} className="hover:bg-blue-50/40 transition-colors">
                          <td className="px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">
                            {globalIdx}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-[#00A2E9] whitespace-nowrap">
                            {c.customerId}
                          </td>
                          <td className="px-4 py-3 font-bold text-gray-900 whitespace-nowrap">
                            {c.name}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700">
                              {c.tariff || '-'} / {c.power || '-'} VA
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600 max-w-md truncate">
                            {c.address || '-'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                title="Edit Pelanggan"
                                aria-label={`Edit ${c.name}`}
                                onClick={() => onOpenEditModal(c)}
                                className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                              >
                                <i className="fa-solid fa-pen-to-square text-sm" aria-hidden="true"></i>
                              </button>
                              {canDelete && (
                                <button
                                  type="button"
                                  title="Hapus Pelanggan"
                                  aria-label={`Hapus ${c.name}`}
                                  onClick={() => handleDeleteCustomer(c)}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                >
                                  <i className="fa-solid fa-trash text-sm" aria-hidden="true"></i>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-2 text-xs text-gray-500">
              <div>
                Halaman <span className="font-bold text-gray-800">{custPagination.page}</span> dari{' '}
                <span className="font-bold text-gray-800">{Math.max(1, custPagination.totalPages)}</span> (
                {custPagination.totalItems.toLocaleString('id-ID')} Pelanggan)
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCustPage((p) => Math.max(1, p - 1))}
                  disabled={custPagination.page <= 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  onClick={() => setCustPage((p) => Math.min(Math.max(1, custPagination.totalPages), p + 1))}
                  disabled={custPagination.page >= Math.max(1, custPagination.totalPages)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Tamu Google Form Table */}
        {activeTab === 'tamu' && (
          <div className="space-y-4">
            {lastSyncTime && (
              <div className="text-xs text-purple-700 bg-purple-50 px-3 py-2 rounded-xl flex items-center justify-between">
                <span>
                  <i className="fa-solid fa-clock-rotate-left mr-1" aria-hidden="true"></i> Sinkronisasi terakhir: {lastSyncTime}
                </span>
              </div>
            )}

            <div className="overflow-x-auto max-h-[600px] overflow-y-auto rounded-xl border border-gray-100">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider sticky top-0 z-10 font-bold border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3.5 whitespace-nowrap">No</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">Waktu Kunjungan</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">Nama Tamu</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">No Handphone</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">ID Pelanggan</th>
                    <th className="px-4 py-3.5 whitespace-nowrap">Keperluan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {guestLoading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                        <i className="fa-solid fa-circle-notch fa-spin text-xl text-purple-600 mb-2 block" aria-hidden="true"></i>
                        Memuat data buku tamu...
                      </td>
                    </tr>
                  ) : guests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                        <i className="fa-solid fa-circle-info text-xl text-gray-300 mb-2 block" aria-hidden="true"></i>
                        Belum ada data tamu yang tercatat. Silakan klik &quot;Sinkronkan GForm&quot;.
                      </td>
                    </tr>
                  ) : (
                    guests.map((g, idx) => (
                      <tr key={g.id || idx} className="hover:bg-purple-50/40 transition-colors">
                        <td className="px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">
                          {(guestPagination.page - 1) * guestPagination.limit + idx + 1}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                          {g.timestamp || '-'}
                        </td>
                        <td className="px-4 py-3 font-bold text-gray-900 whitespace-nowrap">
                          {g.guestName || '-'}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-700 whitespace-nowrap">
                          {g.phone || '-'}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-[#00A2E9] whitespace-nowrap">
                          {g.customerId || '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-700 max-w-sm truncate">
                          {g.purpose || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2 text-xs text-gray-500">
              <div>
                Halaman <span className="font-bold text-gray-800">{guestPagination.page}</span> dari{' '}
                <span className="font-bold text-gray-800">{Math.max(1, guestPagination.totalPages)}</span> (
                {guestPagination.totalItems.toLocaleString('id-ID')} Tamu)
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGuestPage((pageNumber) => Math.max(1, pageNumber - 1))}
                  disabled={guestPagination.page <= 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  onClick={() => setGuestPage((pageNumber) => Math.min(guestPagination.totalPages, pageNumber + 1))}
                  disabled={guestPagination.page >= guestPagination.totalPages}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
