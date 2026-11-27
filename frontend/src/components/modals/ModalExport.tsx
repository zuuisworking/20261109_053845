import { useRef, useState } from 'react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { ModalErrorAlert } from '../ModalErrorAlert';
import { api } from '../../services/api';
import type { ExportDataset, ExportFormat, Period, TransformerView } from '../../types';

interface Props {
  defaultTarget?: ExportDataset;
  defaultTrafoView?: TransformerView;
  defaultPeriod?: Period;
  onClose: () => void;
}

export default function ModalExport({
  defaultTarget = 'trafo',
  defaultTrafoView = 'semua',
  defaultPeriod = 'wbp',
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [target, setTarget] = useState<ExportDataset>(defaultTarget);
  const [trafoView, setTrafoView] = useState<TransformerView>(defaultTrafoView);
  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useModalAccessibility(dialogRef, onClose);

  const handleExport = async () => {
    setLoading(true);
    setError('');
    try {
      if (target === 'trafo') {
        await api.exportTransformers(format, trafoView, period);
      } else if (target === 'pelanggan') {
        await api.exportCustomers(format);
      } else {
        await api.exportGuests(format);
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal mengekspor data.');
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
        aria-labelledby="export-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl w-full shadow-2xl"
        style={{ maxWidth: 440 }}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 id="export-modal-title" className="font-bold text-gray-800 flex items-center gap-2">
            <i className="fas fa-file-export text-plnBlue" aria-hidden="true" />
            Export Data
          </h3>
          <button
            type="button"
            aria-label="Tutup modal export"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all cursor-pointer"
            onClick={onClose}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <fieldset>
            <legend className="text-sm font-medium text-gray-700 mb-2">Data yang diekspor</legend>
            <div className="flex gap-4 flex-wrap">
              {(['trafo', 'pelanggan', 'tamu'] as const).map((item) => (
                <label key={item} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="target"
                    value={item}
                    checked={target === item}
                    onChange={() => setTarget(item)}
                    className="accent-plnBlue"
                  />
                  <span className="capitalize">{item === 'trafo' ? 'Trafo' : item === 'pelanggan' ? 'Pelanggan' : 'Tamu'}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {target === 'trafo' && (
            <>
              <fieldset>
                <legend className="text-sm font-medium text-gray-700 mb-2">Filter trafo</legend>
                <div className="flex gap-4 flex-wrap">
                  {(['semua', 'pincang', 'overload'] as const).map((view) => (
                    <label key={view} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="trafoView"
                        value={view}
                        checked={trafoView === view}
                        onChange={() => setTrafoView(view)}
                        className="accent-plnBlue"
                      />
                      <span>{view === 'semua' ? 'Semua' : view === 'pincang' ? 'Pincang' : 'Overload'}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-medium text-gray-700 mb-2">Periode pengukuran</legend>
                <div className="flex gap-4">
                  {(['wbp', 'lwbp'] as const).map((item) => (
                    <label key={item} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="period"
                        value={item}
                        checked={period === item}
                        onChange={() => setPeriod(item)}
                        className="accent-plnBlue"
                      />
                      <span>{item === 'wbp' ? 'WBP' : 'LWBP'}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          <fieldset>
            <legend className="text-sm font-medium text-gray-700 mb-2">Format file</legend>
            <div className="flex gap-5">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" name="format" value="xlsx" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} className="accent-plnBlue" />
                <span><i className="fas fa-file-excel mr-1 text-green-600" aria-hidden="true" />Excel (.xlsx)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="radio" name="format" value="csv" checked={format === 'csv'} onChange={() => setFormat('csv')} className="accent-plnBlue" />
                <span><i className="fas fa-file-csv mr-1 text-blue-600" aria-hidden="true" />CSV (.csv)</span>
              </label>
            </div>
          </fieldset>

          <ModalErrorAlert message={error} />

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
              type="button"
              className="px-5 py-2.5 bg-plnBlue hover:bg-[#008ecf] text-white rounded-xl font-semibold text-sm transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-60"
              onClick={handleExport}
              disabled={loading}
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" /> Mengekspor...
                </>
              ) : (
                <>
                  <i className="fas fa-download mr-2" aria-hidden="true" /> Export
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
