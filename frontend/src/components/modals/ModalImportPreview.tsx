import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { ModalErrorAlert } from '../ModalErrorAlert';
import { api, type ImportPreviewOptions } from '../../services/api';
import type {
  DatasetType,
  ImportCommitResult,
  ImportPageMeta,
  ImportPreview,
  ImportRow,
} from '../../types';

interface Props {
  defaultTarget?: DatasetType;
  onClose: () => void;
  onImported: (result: ImportCommitResult) => void;
}

const ROWS_PER_PAGE = 15;

const STATUS_COLOR: Record<string, string> = {
  insert: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  unchanged: 'bg-gray-100 text-gray-500',
  rejected: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<string, string> = {
  insert: 'Baru',
  update: 'Update',
  unchanged: 'Sama',
  rejected: 'Ditolak',
};

export default function ModalImportPreview({ defaultTarget = 'trafo', onClose, onImported }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRequestRef = useRef(0);
  const rowsRequestRef = useRef(0);
  const commitRequestRef = useRef(0);
  const [target, setTarget] = useState<DatasetType>(defaultTarget);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [rowsMeta, setRowsMeta] = useState<ImportPageMeta | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [encoding, setEncoding] = useState<'' | 'utf-8-sig' | 'cp1252' | 'auto'>('');
  const [sheet, setSheet] = useState('');
  const [mappingText, setMappingText] = useState('');
  const fileFormat = file?.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';

  const closeModal = () => {
    if (!committing) onClose();
  };

  useModalAccessibility(dialogRef, closeModal);

  useEffect(
    () => () => {
      previewRequestRef.current += 1;
      rowsRequestRef.current += 1;
      commitRequestRef.current += 1;
    },
    [],
  );

  const invalidatePendingRequests = () => {
    previewRequestRef.current += 1;
    commitRequestRef.current += 1;
    setLoading(false);
    setLoadingRows(false);
    setCommitting(false);
  };

  useEffect(() => {
    if (!preview?.importJobId) return undefined;

    const requestId = ++rowsRequestRef.current;
    setLoadingRows(true);
    api
      .getImportRows(preview.importJobId, {
        page,
        pageSize: ROWS_PER_PAGE,
      })
      .then((response) => {
        if (requestId !== rowsRequestRef.current) return;
        setRows(response.data);
        const meta = (response.meta || {}) as Partial<ImportPageMeta>;
        setRowsMeta({
          page: Number(meta.page) || page,
          pageSize: Number(meta.pageSize) || ROWS_PER_PAGE,
          total: Number(meta.total) || response.data.length,
          totalPages: Number(meta.totalPages) || 0,
        });
      })
      .catch((caught) => {
        if (requestId !== rowsRequestRef.current) return;
        setError(caught instanceof Error ? caught.message : 'Gagal memuat detail pratinjau.');
      })
      .finally(() => {
        if (requestId === rowsRequestRef.current) setLoadingRows(false);
      });

    return () => {
      rowsRequestRef.current += 1;
    };
  }, [page, preview?.importJobId]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    invalidatePendingRequests();
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    setEncoding('');
    setSheet('');
    setMappingText('');
    setPreview(null);
    setRows([]);
    setRowsMeta(null);
    setError('');
    setPage(1);

    if (selectedFile) {
      const extension = selectedFile.name.split('.').pop()?.toLowerCase();
      if (!extension || !['csv', 'xlsx'].includes(extension)) {
        setFile(null);
        setError('Format file harus CSV atau Excel (XLSX).');
      } else if (selectedFile.size > 25 * 1024 * 1024) {
        setFile(null);
        setError('Ukuran file maksimal 25 MiB.');
      }
    }
  };

  const handlePreview = async () => {
    if (!file) {
      setError('Pilih file terlebih dahulu.');
      return;
    }

    const requestId = ++previewRequestRef.current;
    setLoading(true);
    setError('');
    setPreview(null);
    try {
      let mapping: Record<string, string> | undefined;
      if (mappingText.trim()) {
        let parsedMapping: unknown;
        try {
          parsedMapping = JSON.parse(mappingText);
        } catch (_error) {
          throw new Error('Mapping kolom harus berupa objek JSON yang valid.');
        }
        if (
          !parsedMapping ||
          typeof parsedMapping !== 'object' ||
          Array.isArray(parsedMapping)
        ) {
          throw new Error('Mapping kolom harus berupa objek JSON.');
        }
        const entries = Object.entries(parsedMapping as Record<string, unknown>);
        if (entries.some(([, value]) => typeof value !== 'string' || !value.trim())) {
          throw new Error('Setiap header sumber pada mapping kolom harus berupa teks.');
        }
        mapping = Object.fromEntries(
          entries.map(([field, value]) => [field, String(value).trim()]),
        );
      }

      const options: ImportPreviewOptions = {};
      if (fileFormat === 'csv' && encoding) options.encoding = encoding;
      if (fileFormat === 'xlsx' && sheet.trim()) options.sheet = sheet.trim();
      if (mapping) options.mapping = mapping;

      const response = await api.previewImport(file, target, options);
      if (requestId !== previewRequestRef.current) return;
      if (!response.data.previewToken || !response.data.importJobId) {
        throw new Error('Pratinjau tidak memiliki token import. Periksa format file dan coba lagi.');
      }
      setPreview(response.data);
      setPage(1);
    } catch (caught) {
      if (requestId !== previewRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Gagal memproses file.');
    } finally {
      if (requestId === previewRequestRef.current) setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!preview?.previewToken || !preview.importJobId) return;

    const requestId = ++commitRequestRef.current;
    setCommitting(true);
    setError('');
    try {
      const response = await api.commitImport(
        preview.importJobId,
        preview.previewToken,
      );
      if (requestId !== commitRequestRef.current) return;
      onImported(response.data);
    } catch (caught) {
      if (requestId !== commitRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Gagal mengimpor data.');
    } finally {
      if (requestId === commitRequestRef.current) setCommitting(false);
    }
  };

  const sampleCols = useMemo(
    () => Array.from(new Set(rows.flatMap((row) => Object.keys(row.data)))),
    [rows],
  );
  const totalPages = rowsMeta?.totalPages ?? 0;
  const pagedSamples = rows;
  const summary = preview?.summary;
  const actionableRows = summary
    ? summary.insertCount + summary.updateCount
    : 0;
  const canCommit = Boolean(
    preview?.previewToken &&
      preview.importJobId &&
      actionableRows > 0 &&
      !loadingRows &&
      !committing,
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl w-full shadow-2xl overflow-hidden"
        style={{ maxWidth: preview ? 900 : 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <h3 id="import-modal-title" className="font-bold text-gray-800 flex items-center gap-2">
            <i className="fas fa-file-import text-plnBlue" aria-hidden="true" />
            Import Data
          </h3>
          <button
            type="button"
            aria-label="Tutup modal import"
            onClick={closeModal}
            disabled={committing}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <fieldset>
            <legend className="text-sm font-medium text-gray-700 mb-2">Target data:</legend>
            <div className="flex gap-4 items-center">
              {(['trafo', 'pelanggan'] as const).map((item) => (
                <label key={item} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="target"
                    value={item}
                    checked={target === item}
                    onChange={() => {
                      invalidatePendingRequests();
                      setTarget(item);
                      setFile(null);
                      setEncoding('');
                      setSheet('');
                      setMappingText('');
                      setPreview(null);
                      setRows([]);
                      setRowsMeta(null);
                      setError('');
                      setPage(1);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="accent-plnBlue"
                    disabled={committing}
                  />
                  <span className="capitalize">{item === 'trafo' ? 'Trafo' : 'Pelanggan'}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1">
            <label htmlFor="import-file" className="text-sm font-medium text-gray-700">
              File CSV / XLSX
            </label>
            <input
              ref={fileInputRef}
              id="import-file"
              type="file"
              accept=".csv,.xlsx"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-plnBlue file:text-white file:text-xs file:cursor-pointer file:font-medium hover:border-plnBlue transition-all"
              onChange={handleFileChange}
              disabled={committing}
            />
            <p className="text-xs text-gray-400">Format didukung: CSV atau Excel (.xlsx), maksimal 25 MiB.</p>

            {file && fileFormat === 'csv' && (
              <div className="space-y-1">
                <label htmlFor="import-encoding" className="text-sm font-medium text-gray-700">
                  Encoding CSV
                </label>
                <select
                  id="import-encoding"
                  value={encoding}
                  onChange={(event) =>
                    setEncoding(event.target.value as '' | 'utf-8-sig' | 'cp1252' | 'auto')
                  }
                  disabled={committing}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 bg-white disabled:opacity-60"
                >
                  <option value="">Default server</option>
                  <option value="auto">Deteksi otomatis</option>
                  <option value="utf-8-sig">UTF-8 dengan BOM</option>
                  <option value="cp1252">CP1252</option>
                </select>
              </div>
            )}

            {file && fileFormat === 'xlsx' && (
              <div className="space-y-1">
                <label htmlFor="import-sheet" className="text-sm font-medium text-gray-700">
                  Nama worksheet
                </label>
                <input
                  id="import-sheet"
                  type="text"
                  value={sheet}
                  onChange={(event) => setSheet(event.target.value)}
                  disabled={committing}
                  placeholder="Kosongkan jika workbook hanya memiliki satu worksheet data"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 disabled:opacity-60"
                />
              </div>
            )}

            {file && (
              <details className="border border-gray-200 rounded-xl px-4 py-3">
                <summary className="text-sm font-medium text-gray-700 cursor-pointer">
                  Mapping kolom lanjutan
                </summary>
                <div className="space-y-1 mt-3">
                  <label htmlFor="import-mapping" className="text-sm font-medium text-gray-700">
                    Mapping header sumber
                  </label>
                  <textarea
                    id="import-mapping"
                    value={mappingText}
                    onChange={(event) => setMappingText(event.target.value)}
                    disabled={committing}
                    rows={3}
                    placeholder='{"name":"Kode Trafo"}'
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 font-mono disabled:opacity-60"
                  />
                  <p className="text-xs text-gray-400">
                    Gunakan nama field canonical sebagai kunci dan header file sebagai nilai.
                  </p>
                </div>
              </details>
            )}
          </div>

          <ModalErrorAlert message={error} />

          {preview && summary && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { value: summary.insertCount, label: 'Baru', color: 'bg-green-50 text-green-700 border-green-200' },
                  { value: summary.updateCount, label: 'Update', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                  { value: summary.unchangedCount, label: 'Sama', color: 'bg-gray-50 text-gray-600 border-gray-200' },
                  { value: summary.rejectedCount, label: 'Ditolak', color: 'bg-red-50 text-red-700 border-red-200' },
                ].map((item) => (
                  <div key={item.label} className={`border rounded-xl p-3 text-center ${item.color}`}>
                    <div className="text-xs font-medium mb-1">{item.label}</div>
                    <div className="text-2xl font-bold">{item.value}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 text-right">
                Total: {summary.totalRows} baris | Valid: {summary.validRows}
                {rowsMeta && ` | Ditampilkan: ${rowsMeta.total} baris`}
              </p>

              {summary.rejectedCount > 0 && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-xs">
                  {summary.rejectedCount} baris ditolak dan tidak akan diimpor. Periksa kolom Keterangan pada tabel.
                </div>
              )}

              {loadingRows && (
                <div className="text-xs text-gray-500 text-center py-4">
                  <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" />
                  Memuat detail pratinjau...
                </div>
              )}

              {!loadingRows && rows.length > 0 && (
                <div className="overflow-auto rounded-xl border border-gray-200" style={{ maxHeight: 260 }}>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600">Baris</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                        {sampleCols.map((column) => (
                          <th key={column} className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">
                            {column}
                          </th>
                        ))}
                        <th className="text-left px-3 py-2 font-semibold text-gray-600">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedSamples.map((row, index) => (
                        <tr
                          key={`${row.rowNumber ?? page}-${index}`}
                          className={`border-b border-gray-100 ${row.status === 'rejected' ? 'bg-red-50' : 'hover:bg-gray-50'}`}
                        >
                          <td className="px-3 py-1.5 text-gray-500">{row.rowNumber ?? '-'}</td>
                          <td className="px-3 py-1.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[row.status] ?? STATUS_COLOR.unknown}`}>
                              {STATUS_LABEL[row.status] ?? STATUS_LABEL.rejected}
                            </span>
                          </td>
                          {sampleCols.map((column) => (
                            <td key={column} className="px-3 py-1.5 max-w-32 truncate text-gray-700">
                              {String(row.data[column] ?? '')}
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-red-600">
                            {row.issues.length
                              ? row.issues.map((issue) => issue.message).join('; ')
                              : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Hal. {page} / {totalPages}</span>
                  <div className="flex gap-2">
                    <button type="button" aria-label="Halaman sampel sebelumnya" className="px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>‹</button>
                    <button type="button" aria-label="Halaman sampel berikutnya" className="px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>›</button>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex gap-3 justify-end pt-1 flex-wrap">
            {preview && (
              <button
                type="button"
                className="px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-50 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={committing}
                onClick={() => {
                  invalidatePendingRequests();
                  setFile(null);
                  setEncoding('');
                  setSheet('');
                  setMappingText('');
                  setPreview(null);
                  setRows([]);
                  setRowsMeta(null);
                  setPage(1);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                <i className="fas fa-redo mr-2" aria-hidden="true" /> Ganti File
              </button>
            )}
            <button
              type="button"
              className="px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-50 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={closeModal}
              disabled={committing}
            >
              Batal
            </button>
            {!preview ? (
              <button
                type="button"
                className="px-5 py-2.5 bg-plnBlue hover:bg-[#008ecf] text-white rounded-xl font-semibold text-sm transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-60"
                onClick={handlePreview}
                disabled={loading || !file}
              >
                {loading ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" /> Memproses...
                  </>
                ) : (
                  <>
                    <i className="fas fa-eye mr-2" aria-hidden="true" /> Pratinjau
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="px-5 py-2.5 bg-plnBlue hover:bg-[#008ecf] text-white rounded-xl font-semibold text-sm transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-60"
                onClick={handleCommit}
                disabled={committing || !canCommit}
              >
                {committing ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" /> Mengimpor...
                  </>
                ) : (
                  <>
                    <i className="fas fa-check mr-2" aria-hidden="true" /> Konfirmasi Import ({actionableRows} baris)
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
