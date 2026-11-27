import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { Transformer, TransformerCounts, TransformerView } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { getAnalysisPresentation, getTransformerAnalysis } from './analysis';

interface TransformerManagementViewProps {
  currentView: 'semua' | 'pincang' | 'overload';
  period: 'wbp' | 'lwbp';
  dataRevision?: number;
  onChangeView: (view: 'semua' | 'pincang' | 'overload') => void;
  onChangePeriod: (period: 'wbp' | 'lwbp') => void;
  onOpenDetailModal: (trafoId: string) => void;
  onOpenBebanModal: (trafoId: string) => void;
  onOpenTambahModal: () => void;
  onOpenEditModal: (trafo: Transformer) => void;
  onOpenImportModal: () => void;
  onOpenExportModal: () => void;
}

export const TransformerManagementView: React.FC<TransformerManagementViewProps> = ({
  currentView,
  period,
  dataRevision = 0,
  onChangeView,
  onChangePeriod,
  onOpenDetailModal,
  onOpenBebanModal,
  onOpenTambahModal,
  onOpenEditModal,
  onOpenImportModal,
  onOpenExportModal,
}) => {
  const { user } = useAuth();
  const { showConfirm, showNotif } = useNotification();
  const canDelete = user?.role === 'superadmin';
  const [transformers, setTransformers] = useState<Transformer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const [pageSize, setPageSize] = useState(10);
  const filterKey = `${currentView}:${period}`;
  const [pageState, setPageState] = useState({ filterKey, page: 1 });
  const currentPage = pageState.filterKey === filterKey ? pageState.page : 1;
  const setCurrentPage = (next: React.SetStateAction<number>) => {
    setPageState((previous) => {
      const previousPage = previous.filterKey === filterKey ? previous.page : 1;
      const resolvedPage = typeof next === 'function' ? next(previousPage) : next;
      return { filterKey, page: Math.max(1, resolvedPage) };
    });
  };
  const [reloadKey, setReloadKey] = useState(0);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    totalItems: 0,
    totalPages: 1,
  });
  const [counts, setCounts] = useState<TransformerCounts>({
    total: 0,
    analyzable: 0,
    notAnalyzable: 0,
    pincang: 0,
    overload: 0,
  });

  useEffect(() => {
    setPageState((previous) =>
      previous.filterKey === filterKey ? previous : { filterKey, page: 1 },
    );
  }, [filterKey]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);

    const request =
      currentView === 'semua'
        ? api.getTransformers(
            {
              page: currentPage,
              pageSize,
              q: debouncedSearch,
              view: currentView,
              period,
            },
            controller.signal,
          )
        : api.getTransformerAnomalies(
            {
              category: currentView === 'pincang' ? 'unbalanced' : 'overloaded',
              page: currentPage,
              pageSize,
              q: debouncedSearch,
              period,
            },
            controller.signal,
          );

    request
      .then((response) => {
        if (!active) return;
        const nextPagination = response.data.pagination;
        const availablePages = Math.max(1, nextPagination.totalPages);
        if (currentPage > availablePages) {
          setCurrentPage(availablePages);
          return;
        }
        setTransformers(response.data.items);
        setPagination(nextPagination);
        setCounts(response.data.counts);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        showNotif(
          'Gagal Memuat Data',
          error instanceof Error ? error.message : 'Terjadi kesalahan saat memuat data trafo.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [currentView, period, debouncedSearch, pageSize, currentPage, reloadKey, dataRevision, showNotif]);

  const handleViewChange = (view: TransformerView) => {
    setCurrentPage(1);
    onChangeView(view);
  };

  const handlePeriodChange = (nextPeriod: 'wbp' | 'lwbp') => {
    setCurrentPage(1);
    onChangePeriod(nextPeriod);
  };

  const handleDelete = (trafo: Transformer) => {
    showConfirm(
      'Hapus Data Trafo?',
      `Apakah Anda yakin ingin menghapus data trafo "${trafo.name}"? Data pengukuran beban terkait juga akan dihapus.`,
      async () => {
        try {
          await api.deleteTransformer(trafo.id);
          showNotif('Berhasil', `Data trafo ${trafo.name} berhasil dihapus.`);
          setReloadKey((key) => key + 1);
        } catch (error: unknown) {
          showNotif(
            'Gagal Menghapus',
            error instanceof Error ? error.message : 'Data trafo tidak dapat dihapus.',
          );
        }
      },
      'Ya, Hapus'
    );
  };

  const getSectionTitle = () => {
    if (currentView === 'pincang') return 'Data Trafo Pincang (Ketidakseimbangan)';
    if (currentView === 'overload') return 'Data Trafo Overload (Beban Lebih)';
    return 'Manajemen Data Gardu Trafo';
  };

  const getSectionSubtitle = () => {
    const pLabel = period.toUpperCase();
    if (currentView === 'pincang') {
      return `Daftar trafo dengan ketidakseimbangan arus Incoming ${pLabel} melebihi 10%.`;
    }
    if (currentView === 'overload') {
      return `Daftar trafo dengan tingkat pembebanan Incoming ${pLabel} melebihi 80% dari arus nominal.`;
    }
    return 'Kelola data seluruh gardu trafo distribusi, kapasitas kVA, dan titik lokasi koordinat GIS.';
  };

  return (
    <div id="content-trafo" className="page-content space-y-6 fade-in">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 id="trafo-section-title" className="text-xl font-bold text-gray-800">
            {getSectionTitle()}
          </h2>
          <p id="trafo-section-subtitle" className="text-xs text-gray-400 mt-1">
            {getSectionSubtitle()}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={onOpenExportModal}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2 cursor-pointer"
          >
            <i className="fa-solid fa-file-excel" aria-hidden="true"></i>
            <span>Unduh File</span>
          </button>

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
        </div>
      </div>

      {/* Dynamic Warning Banner for Pincang / Overload */}
      {currentView !== 'semua' && (
        <div
          id="trafo-analisis-banner"
          className={`p-4 rounded-xl border flex items-center justify-between gap-4 fade-in ${
            currentView === 'pincang'
              ? 'bg-amber-50/80 border-amber-200 text-amber-800'
              : 'bg-red-50/80 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 shadow-inner ${
                currentView === 'pincang'
                  ? 'bg-amber-100 text-amber-600'
                  : 'bg-red-100 text-red-600'
              }`}
            >
              <i
                aria-hidden="true"
                className={`fa-solid ${
                  currentView === 'pincang' ? 'fa-triangle-exclamation' : 'fa-fire-flame-curved'
                }`}
              ></i>
            </div>
            <div>
              <h4 className="font-bold text-sm">
                {currentView === 'pincang'
                  ? `Analisis Ketidakseimbangan Fasa Incoming (${period.toUpperCase()})`
                  : `Analisis Pembebanan Lebih Incoming (${period.toUpperCase()})`}
              </h4>
              <p className="text-xs opacity-90">
                {currentView === 'pincang'
                  ? 'Pemerataan beban fasa mendesak dilakukan untuk menghindari panas berlebih pada netral trafo.'
                  : 'Trafo beroperasi di atas batas aman 80%. Direkomendasikan up-rating kapasitas atau pelimpahan beban.'}
              </p>
            </div>
          </div>

          {/* Basis Periode Switcher */}
          <div className="flex items-center gap-1.5 bg-white/70 p-1 rounded-lg border border-gray-200/50 shrink-0">
            <span className="text-[10px] font-bold text-gray-500 uppercase px-1">Basis:</span>
            <button
              type="button"
              onClick={() => handlePeriodChange('wbp')}
              aria-pressed={period === 'wbp'}
              className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                period === 'wbp'
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              WBP
            </button>
            <button
              type="button"
              onClick={() => handlePeriodChange('lwbp')}
              aria-pressed={period === 'lwbp'}
              className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                period === 'lwbp'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              LWBP
            </button>
          </div>
        </div>
      )}

      {/* View Tabs & Controls */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4">
          {/* Tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleViewChange('semua')}
              aria-pressed={currentView === 'semua'}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                currentView === 'semua'
                  ? 'bg-[#005b82] text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>Semua Data Trafo</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20">
                {counts.total}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleViewChange('pincang')}
              aria-pressed={currentView === 'pincang'}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                currentView === 'pincang'
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>Data Trafo Pincang</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20">
                {counts.pincang}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleViewChange('overload')}
              aria-pressed={currentView === 'overload'}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                currentView === 'overload'
                  ? 'bg-red-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>Data Trafo Overload</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20">
                {counts.overload}
              </span>
            </button>
          </div>

          {/* Search & Page Size */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <i className="fa-solid fa-magnifying-glass text-xs" aria-hidden="true"></i>
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                aria-label="Cari trafo atau penyulang"
                placeholder="Cari trafo / penyulang..."
                className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#00A2E9] focus:border-transparent w-48 sm:w-64"
              />
            </div>

            <select
              aria-label="Jumlah data per halaman"
              value={pageSize}
              onChange={(e) => {
                setPageSize(parseInt(e.target.value, 10));
                setCurrentPage(1);
              }}
              className="py-1.5 px-2 text-xs rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#00A2E9] focus:border-transparent text-gray-600 cursor-pointer"
            >
              <option value="10">10 / hal</option>
              <option value="25">25 / hal</option>
              <option value="50">50 / hal</option>
              <option value="100">100 / hal</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto rounded-xl border border-gray-100">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider sticky top-0 z-10 font-bold border-b border-gray-100">
              <tr>
                <th className="px-4 py-3.5 whitespace-nowrap">No</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Nama Trafo</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Penyulang</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Kapasitas</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Titik Koordinat</th>
                {currentView !== 'semua' && (
                  <>
                    <th className="px-4 py-3.5 whitespace-nowrap text-center">
                      Analisis Incoming ({period.toUpperCase()})
                    </th>
                    <th className="px-4 py-3.5 whitespace-nowrap text-center">Status / Rekomendasi</th>
                  </>
                )}
                <th className="px-4 py-3.5 text-center whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={currentView === 'semua' ? 6 : 8} className="px-6 py-12 text-center text-gray-400">
                    <i className="fa-solid fa-circle-notch fa-spin text-xl text-[#00A2E9] mb-2 block" aria-hidden="true"></i>
                    Memuat data trafo...
                  </td>
                </tr>
              ) : transformers.length === 0 ? (
                <tr>
                  <td colSpan={currentView === 'semua' ? 6 : 8} className="px-6 py-12 text-center text-gray-400">
                    <i className="fa-solid fa-circle-info text-xl text-gray-300 mb-2 block" aria-hidden="true"></i>
                    {currentView === 'pincang'
                      ? `Tidak ada trafo pincang (Unbalance Incoming ${period.toUpperCase()} > 10%) yang ditemukan.`
                      : currentView === 'overload'
                      ? `Tidak ada trafo overload (Pembebanan Incoming ${period.toUpperCase()} > 80%) yang ditemukan.`
                      : 'Tidak ada data trafo yang cocok.'}
                  </td>
                </tr>
              ) : (
                transformers.map((item, idx) => {
                  const globalIdx = (pagination.page - 1) * pagination.limit + idx + 1;
                  const an = getAnalysisPresentation(getTransformerAnalysis(item, period));

                  return (
                    <tr key={item.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">
                        {globalIdx}
                      </td>
                      <td className="px-4 py-3 font-bold text-gray-900 whitespace-nowrap">
                        {item.name}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-medium">
                        {item.feeder || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700">
                          {item.capacity || (item.capacityKva ? `${item.capacityKva} kVA` : '-')}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-gray-500 whitespace-nowrap max-w-xs truncate">
                        {item.rawCoordinates || '-'}
                      </td>

                      {/* Anomaly Analysis Columns */}
                      {currentView !== 'semua' && an && (
                        <>
                          <td className="px-4 py-3 whitespace-nowrap text-center">
                            <div className="inline-block text-left text-[11px] font-mono leading-tight">
                              <div>
                                R: <span className="font-semibold">{an.ir ?? '-'}{typeof an.ir === 'number' ? 'A' : ''}</span> | S:{' '}
                                <span className="font-semibold">{an.is ?? '-'}{typeof an.is === 'number' ? 'A' : ''}</span> | T:{' '}
                                <span className="font-semibold">{an.it ?? '-'}{typeof an.it === 'number' ? 'A' : ''}</span> | N:{' '}
                                <span className="font-semibold">{an.inVal ?? '-'}{typeof an.inVal === 'number' ? 'A' : ''}</span>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <span
                                  className={`px-1.5 py-0.2 rounded font-bold ${
                                    an.isPincang ? 'bg-amber-100 text-amber-700' : 'text-gray-500'
                                  }`}
                                >
                                  Unb: {an.unbalance ?? '-'}{typeof an.unbalance === 'number' ? '%' : ''}
                                </span>
                                <span
                                  className={`px-1.5 py-0.2 rounded font-bold ${
                                    an.isOverload ? 'bg-red-100 text-red-700' : 'text-gray-500'
                                  }`}
                                >
                                  Load: {an.loadingPercent ?? '-'}{typeof an.loadingPercent === 'number' ? '%' : ''}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3 whitespace-nowrap text-center">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${an.badgeClass}`}
                            >
                              {an.labelStatus}
                            </span>
                          </td>
                        </>
                      )}

                      {/* Actions */}
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            title="Detail Trafo"
                            aria-label={`Detail ${item.name}`}
                            onClick={() => onOpenDetailModal(item.id)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <i className="fa-solid fa-circle-info text-sm" aria-hidden="true"></i>
                          </button>
                          <button
                            type="button"
                            title="Ukur Beban"
                            aria-label={`Ukur beban ${item.name}`}
                            onClick={() => onOpenBebanModal(item.id)}
                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <i className="fa-solid fa-bolt text-sm" aria-hidden="true"></i>
                          </button>
                          <button
                            type="button"
                            title="Edit Data"
                            aria-label={`Edit ${item.name}`}
                            onClick={() => onOpenEditModal(item)}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <i className="fa-solid fa-pen-to-square text-sm" aria-hidden="true"></i>
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              title="Hapus"
                              aria-label={`Hapus ${item.name}`}
                              onClick={() => handleDelete(item)}
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

        {/* Pagination Footer */}
        <div className="flex items-center justify-between pt-2 text-xs text-gray-500">
          <div>
            Halaman <span className="font-bold text-gray-800">{pagination.page}</span> dari{' '}
            <span className="font-bold text-gray-800">{Math.max(1, pagination.totalPages)}</span> ({pagination.totalItems}{' '}
            Trafo)
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(Math.max(1, pagination.totalPages), p + 1))}
              disabled={pagination.page >= Math.max(1, pagination.totalPages)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer"
            >
              Berikutnya
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
