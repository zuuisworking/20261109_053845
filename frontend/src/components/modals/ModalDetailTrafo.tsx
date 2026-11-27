import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import type { Transformer, TransformerMeasurements } from '../../types';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { ModalErrorAlert } from '../ModalErrorAlert';
import { getAnalysisPresentation, getTransformerAnalysis } from '../../features/transformers/analysis';

interface ModalDetailTrafoProps {
  trafoId: string | null;
  onClose: () => void;
  onOpenUkurBeban: (trafoId: string) => void;
}

export const ModalDetailTrafo: React.FC<ModalDetailTrafoProps> = ({
  trafoId,
  onClose,
  onOpenUkurBeban,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [trafo, setTrafo] = useState<Transformer | null>(null);
  const [measurements, setMeasurements] = useState<TransformerMeasurements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activePeriod, setActivePeriod] = useState<'wbp' | 'lwbp'>('wbp');

  useModalAccessibility(dialogRef, onClose, Boolean(trafoId));

  useEffect(() => {
    if (!trafoId) return;

    let active = true;
    const loadDetail = async () => {
      try {
        setLoading(true);
        setError('');
        setTrafo(null);
        setMeasurements(null);
        const [transformerRes, measurementRes] = await Promise.all([
          api.getTransformerById(trafoId),
          api.getMeasurements(trafoId),
        ]);
        if (!active) return;
        if (transformerRes?.data && measurementRes?.data) {
          setTrafo(transformerRes.data);
          setMeasurements(measurementRes.data);
        } else {
          setError('Data trafo tidak dapat dimuat.');
        }
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error ? caught.message : 'Data trafo tidak dapat dimuat.',
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadDetail();
    return () => {
      active = false;
    };
  }, [trafoId]);

  if (!trafoId) return null;

  const pData = activePeriod === 'lwbp' ? measurements?.lwbp : measurements?.wbp;
  const analysis = trafo
    ? getAnalysisPresentation(getTransformerAnalysis(trafo, activePeriod))
    : null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-trafo-title"
        tabIndex={-1}
        className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="p-6 bg-gradient-to-r from-[#005b82] to-[#00A2E9] text-white flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <h3 id="detail-trafo-title" className="text-xl font-bold">{loading ? 'Memuat...' : trafo?.name}</h3>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20">
                {trafo?.capacity || (trafo?.capacityKva ? `${trafo.capacityKva} kVA` : '-')}
              </span>
            </div>
            <p className="text-xs text-blue-100 mt-1">
              Penyulang: <span className="font-semibold">{trafo?.feeder || '-'}</span> | Merek:{' '}
              <span className="font-semibold">{trafo?.brand ?? '-'}</span> |
              Grounding: <span className="font-semibold">{trafo?.grounding ?? '-'}</span>
            </p>
          </div>
          <button
            type="button" aria-label="Tutup detail trafo" onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg transition-colors cursor-pointer"
          >
            &times;
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {loading ? (
            <div className="py-16 text-center text-gray-400" aria-live="polite">
              <i className="fa-solid fa-circle-notch fa-spin text-2xl text-[#00A2E9] mb-3 block" aria-hidden="true"></i>
              Mengambil detail pengukuran trafo...
            </div>
          ) : error ? (
            <ModalErrorAlert message={error} />
          ) : (
            <>
              {/* Periode Tab Buttons */}
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActivePeriod('wbp')}
                    aria-pressed={activePeriod === 'wbp'}
                    className={`px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${
                      activePeriod === 'wbp'
                        ? 'bg-orange-500 text-white shadow-md'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    WBP (Waktu Beban Puncak)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePeriod('lwbp')}
                    aria-pressed={activePeriod === 'lwbp'}
                    className={`px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${
                      activePeriod === 'lwbp'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    LWBP (Luar Beban Puncak)
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!trafo}
                  onClick={() => {
                    if (!trafo) return;
                    onClose();
                    onOpenUkurBeban(trafo.id);
                  }}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i className="fa-solid fa-pen-to-square" aria-hidden="true"></i>
                  <span>Input Ukur Beban</span>
                </button>
              </div>

              {/* Analysis Meters Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Meter Pembebanan */}
                <div className="bg-gray-50/70 p-4 rounded-xl border border-gray-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-gray-700">Tingkat Pembebanan</span>
                    <span className="font-mono font-bold text-sm text-gray-900">
                      {analysis?.loadingPercent === null || analysis?.loadingPercent === undefined
                        ? '-'
                        : `${analysis.loadingPercent}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        (analysis?.loadingPercent || 0) > 80
                          ? 'bg-red-500'
                          : (analysis?.loadingPercent || 0) > 60
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, analysis?.loadingPercent || 0)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    Arus Nominal: {analysis?.nominalA === null || analysis?.nominalA === undefined
                      ? '-'
                      : `${analysis.nominalA.toFixed(1)} A`} | Rata-Rata:{' '}
                    {analysis?.iAvg === null || analysis?.iAvg === undefined
                      ? '-'
                      : `${analysis.iAvg.toFixed(1)} A`}
                  </p>
                </div>

                {/* Meter Ketidakseimbangan */}
                <div className="bg-gray-50/70 p-4 rounded-xl border border-gray-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-gray-700">Ketidakseimbangan Fasa</span>
                    <span className="font-mono font-bold text-sm text-gray-900">
                      {analysis?.unbalance === null || analysis?.unbalance === undefined
                        ? '-'
                        : `${analysis.unbalance}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        (analysis?.unbalance || 0) > 10 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, (analysis?.unbalance || 0) * 3)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Ambang Batas Pincang: &gt; 10%</p>
                </div>
              </div>

              {/* Status Alert Banner */}
              <div className={`p-3.5 rounded-xl border flex items-center gap-3 ${analysis?.badgeClass}`}>
                <i className="fa-solid fa-circle-exclamation text-base" aria-hidden="true"></i>
                <div>
                  <span className="font-bold mr-2">Status: {analysis?.labelStatus}</span>
                  <span className="text-[11px] opacity-90">{analysis?.rekomendasi}</span>
                </div>
              </div>

              {/* Incoming Phases R, S, T, N */}
              <div>
                <h4 className="font-bold text-gray-800 uppercase tracking-wider mb-2">
                  Arus Incoming Lapangan
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                    <span className="text-[10px] font-bold text-red-600 block">Fasa R</span>
                    <span className="text-base font-black text-gray-900">
                      {pData?.incoming?.r === null || pData?.incoming?.r === undefined
                        ? '-'
                        : `${pData.incoming.r} A`}
                    </span>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <span className="text-[10px] font-bold text-amber-600 block">Fasa S</span>
                    <span className="text-base font-black text-gray-900">
                      {pData?.incoming?.s === null || pData?.incoming?.s === undefined
                        ? '-'
                        : `${pData.incoming.s} A`}
                    </span>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                    <span className="text-[10px] font-bold text-blue-600 block">Fasa T</span>
                    <span className="text-base font-black text-gray-900">
                      {pData?.incoming?.t === null || pData?.incoming?.t === undefined
                        ? '-'
                        : `${pData.incoming.t} A`}
                    </span>
                  </div>
                  <div className="p-3 bg-gray-100 rounded-xl border border-gray-200">
                    <span className="text-[10px] font-bold text-gray-600 block">Netral (N)</span>
                    <span className="text-base font-black text-gray-900">
                      {pData?.incoming?.n === null || pData?.incoming?.n === undefined
                        ? '-'
                        : `${pData.incoming.n} A`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tegangan Antar Fasa */}
              <div>
                <h4 className="font-bold text-gray-800 uppercase tracking-wider mb-2">
                  Tegangan Fasa - Netral
                </h4>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                    <span className="text-[10px] text-gray-400 block font-semibold">Tegangan R-N</span>
                    <span className="text-sm font-bold text-gray-800">
                      {pData?.voltage?.r === null || pData?.voltage?.r === undefined
                        ? '-'
                        : `${pData.voltage.r} V`}
                    </span>
                  </div>
                  <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                    <span className="text-[10px] text-gray-400 block font-semibold">Tegangan S-N</span>
                    <span className="text-sm font-bold text-gray-800">
                      {pData?.voltage?.s === null || pData?.voltage?.s === undefined
                        ? '-'
                        : `${pData.voltage.s} V`}
                    </span>
                  </div>
                  <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                    <span className="text-[10px] text-gray-400 block font-semibold">Tegangan T-N</span>
                    <span className="text-sm font-bold text-gray-800">
                      {pData?.voltage?.t === null || pData?.voltage?.t === undefined
                        ? '-'
                        : `${pData.voltage.t} V`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Jurusan Branches Table */}
              <div>
                <h4 className="font-bold text-gray-800 uppercase tracking-wider mb-2">
                  Rincian Beban Antar Jurusan
                </h4>
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                      <tr>
                        <th className="px-3 py-2">Jurusan</th>
                        <th className="px-3 py-2 text-center">R (A)</th>
                        <th className="px-3 py-2 text-center">S (A)</th>
                        <th className="px-3 py-2 text-center">T (A)</th>
                        <th className="px-3 py-2 text-center">N (A)</th>
                        <th className="px-3 py-2">Fuse</th>
                        <th className="px-3 py-2">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {!pData?.branches || pData.branches.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-4 text-center text-gray-400">
                            Belum ada data jurusan yang dicatat.
                          </td>
                        </tr>
                      ) : (
                        pData.branches.map((j, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-bold text-gray-800">{j.name}</td>
                            <td className="px-3 py-2 text-center font-mono">{j.r}</td>
                            <td className="px-3 py-2 text-center font-mono">{j.s}</td>
                            <td className="px-3 py-2 text-center font-mono">{j.t}</td>
                            <td className="px-3 py-2 text-center font-mono">{j.n}</td>
                            <td className="px-3 py-2 text-gray-600">{j.fuse || '-'}</td>
                            <td className="px-3 py-2 text-gray-600">{j.note || '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end shrink-0">
          <button
            type="button" onClick={onClose}
            className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl transition-colors cursor-pointer text-xs"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
