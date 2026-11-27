import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNotification } from '../../context/NotificationContext';
import { api } from '../../services/api';
import type { DashboardData, Period } from '../../types';
import { getAnalysisPresentation, getTransformerAnalysis } from '../transformers/analysis';
import { LeafletMap } from './LeafletMap';

interface DashboardViewProps {
  onOpenDetailModal: (trafoId: string) => void;
  onNavigateToTrafoView: (view: 'semua' | 'pincang' | 'overload') => void;
  onNavigateToPelanggan: () => void;
}

const EMPTY_DASHBOARD: DashboardData = {
  period: 'wbp',
  counts: {
    totalTrafo: 0,
    analyzable: 0,
    pincang: 0,
    overload: 0,
    notAnalyzable: 0,
    pelanggan: 0,
    tamu: 0,
  },
  mapPoints: [],
  pincangList: [],
  overloadList: [],
};

export function DashboardView({
  onOpenDetailModal,
  onNavigateToTrafoView,
  onNavigateToPelanggan,
}: DashboardViewProps) {
  const { showNotif } = useNotification();
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD);
  const [period, setPeriod] = useState<Period>('wbp');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);

    api
      .getDashboard(period, controller.signal)
      .then((response) => {
        if (!active) return;
        setDashboard(response.data);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        showNotif(
          'Gagal Memuat Dashboard',
          error instanceof Error ? error.message : 'Data dashboard tidak dapat dimuat.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [period, showNotif]);

  const activateCard = (action: () => void) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  };

  const counts = dashboard.counts;

  return (
    <div id="content-dashboard" className="page-content space-y-6 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-800">Ringkasan Operasional Trafo</h2>
          <p className="text-xs text-gray-400">
            Analisis dan anomali mengikuti periode {period.toUpperCase()} yang dipilih.
          </p>
        </div>
        <div
          role="group"
          aria-label="Periode analisis dashboard"
          className="inline-flex self-start rounded-xl border border-gray-200 bg-white p-1 shadow-sm"
        >
          {(['wbp', 'lwbp'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={period === option}
              onClick={() => setPeriod(option)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
                period === option
                  ? 'bg-[#00A2E9] text-white'
                  : 'text-gray-500 hover:bg-blue-50 hover:text-[#008ecf]'
              }`}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigateToTrafoView('semua')}
          onKeyDown={activateCard(() => onNavigateToTrafoView('semua'))}
          className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
        >
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
              Total Gardu Trafo
            </p>
            <h3 className="text-2xl font-black text-gray-800 group-hover:text-[#00A2E9] transition-colors">
              {loading ? '...' : counts.totalTrafo.toLocaleString('id-ID')}
            </h3>
            <p className="text-[11px] text-gray-400 mt-1">Terdata di ULP Labuhan</p>
          </div>
          <div className="w-12 h-12 bg-blue-50 text-[#00A2E9] rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform">
            <i className="fa-solid fa-bolt" aria-hidden="true"></i>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigateToTrafoView('pincang')}
          onKeyDown={activateCard(() => onNavigateToTrafoView('pincang'))}
          className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
        >
          <div>
            <p className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-1">
              Trafo Pincang / Asimetris
            </p>
            <h3 className="text-2xl font-black text-amber-600 group-hover:scale-105 transition-transform">
              {loading ? '...' : counts.pincang.toLocaleString('id-ID')}
            </h3>
            <p className="text-[11px] text-gray-400 mt-1">Unbalance Incoming di atas 10%</p>
          </div>
          <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform">
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigateToTrafoView('overload')}
          onKeyDown={activateCard(() => onNavigateToTrafoView('overload'))}
          className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
        >
          <div>
            <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-1">
              Trafo Overload / Beban Lebih
            </p>
            <h3 className="text-2xl font-black text-red-600 group-hover:scale-105 transition-transform">
              {loading ? '...' : counts.overload.toLocaleString('id-ID')}
            </h3>
            <p className="text-[11px] text-gray-400 mt-1">Pembebanan di atas 80% Kapasitas</p>
          </div>
          <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform">
            <i className="fa-solid fa-fire-flame-curved" aria-hidden="true"></i>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigateToTrafoView('semua')}
          onKeyDown={activateCard(() => onNavigateToTrafoView('semua'))}
          className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
        >
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
              Tidak Dapat Dinilai
            </p>
            <h3 className="text-2xl font-black text-gray-700 group-hover:text-[#00A2E9] transition-colors">
              {loading ? '...' : counts.notAnalyzable.toLocaleString('id-ID')}
            </h3>
            <p className="text-[11px] text-gray-400 mt-1">
              {counts.analyzable.toLocaleString('id-ID')} dapat dinilai · Data {period.toUpperCase()} belum lengkap
            </p>
          </div>
          <div className="w-12 h-12 bg-gray-50 text-gray-500 rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-105 transition-transform">
            <i className="fa-solid fa-circle-question" aria-hidden="true"></i>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={onNavigateToPelanggan}
          onKeyDown={activateCard(onNavigateToPelanggan)}
          className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
        >
          <div>
            <p className="text-xs font-bold text-[#00B4CB] uppercase tracking-wider mb-1">
              Pelanggan & Tamu
            </p>
            <h3 className="text-2xl font-black text-gray-800 group-hover:text-[#00B4CB] transition-colors">
              {loading ? '...' : counts.pelanggan.toLocaleString('id-ID')}
            </h3>
            <p className="text-[11px] text-gray-400 mt-1">
              {counts.tamu.toLocaleString('id-ID')} Data Tamu GForm
            </p>
          </div>
          <div className="w-12 h-12 bg-teal-50 text-[#00B4CB] rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform">
            <i className="fa-solid fa-users" aria-hidden="true"></i>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-gray-800 text-base">Sebaran Trafo & Jaringan GIS</h3>
              <p className="text-xs text-gray-400">
                Peta Geografis Interaktif OpenStreetMap ULP Labuhan
              </p>
            </div>
            <a
              href="https://www.google.com/maps/d/edit?mid=1W2Q_OM3XcDTQjAtgMl-FoEE9HZPTuTM&usp=sharing"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#00A2E9] hover:underline flex items-center gap-1 font-semibold"
            >
              <span>Buka Google My Maps</span>
              <i className="fa-solid fa-arrow-up-right-from-square text-[10px]" aria-hidden="true"></i>
            </a>
          </div>

          <div className="flex-1 w-full" style={{ minHeight: '400px' }}>
            <LeafletMap points={dashboard.mapPoints} onSelectTrafo={onOpenDetailModal} />
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-sm text-gray-800 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" aria-hidden="true"></span>
                Trafo Pincang Terkini ({period.toUpperCase()})
              </h4>
              <button
                type="button"
                onClick={() => onNavigateToTrafoView('pincang')}
                className="text-xs text-amber-600 font-semibold hover:underline cursor-pointer"
              >
                Lihat Semua
              </button>
            </div>

            {dashboard.pincangList.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">Tidak ada trafo pincang saat ini.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {dashboard.pincangList.map((transformer) => {
                  const analysis = getAnalysisPresentation(getTransformerAnalysis(transformer, period));
                  return (
                    <button
                      type="button"
                      key={transformer.id}
                      onClick={() => onOpenDetailModal(transformer.id)}
                      className="py-2.5 w-full flex items-center justify-between hover:bg-gray-50 px-2 rounded-lg transition-colors cursor-pointer text-left"
                    >
                      <span>
                        <span className="font-bold text-xs text-gray-800 block">{transformer.name}</span>
                        <span className="text-[10px] text-gray-400">{transformer.feeder || '-'}</span>
                      </span>
                      <span className="text-xs font-mono font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        {analysis?.unbalance === null || analysis?.unbalance === undefined
                          ? '-'
                          : `${analysis.unbalance}%`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-sm text-gray-800 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" aria-hidden="true"></span>
                Trafo Overload Terkini ({period.toUpperCase()})
              </h4>
              <button
                type="button"
                onClick={() => onNavigateToTrafoView('overload')}
                className="text-xs text-red-600 font-semibold hover:underline cursor-pointer"
              >
                Lihat Semua
              </button>
            </div>

            {dashboard.overloadList.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">Tidak ada trafo overload saat ini.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {dashboard.overloadList.map((transformer) => {
                  const analysis = getAnalysisPresentation(getTransformerAnalysis(transformer, period));
                  return (
                    <button
                      type="button"
                      key={transformer.id}
                      onClick={() => onOpenDetailModal(transformer.id)}
                      className="py-2.5 w-full flex items-center justify-between hover:bg-gray-50 px-2 rounded-lg transition-colors cursor-pointer text-left"
                    >
                      <span>
                        <span className="font-bold text-xs text-gray-800 block">{transformer.name}</span>
                        <span className="text-[10px] text-gray-400">{transformer.feeder || '-'}</span>
                      </span>
                      <span className="text-xs font-mono font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                        {analysis?.loadingPercent === null || analysis?.loadingPercent === undefined
                          ? '-'
                          : `${analysis.loadingPercent}%`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
