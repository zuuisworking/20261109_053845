import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import type {
  MeasurementBranch,
  SaveMeasurementRequest,
  Transformer,
  TransformerWritePayload,
} from '../../types';
import { useNotification } from '../../context/NotificationContext';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { ModalErrorAlert } from '../ModalErrorAlert';

const numericInputValue = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

const dateInputValue = (value: string | null | undefined): string => {
  if (!value) return '';
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

const timeInputValue = (value: string | null | undefined): string => {
  if (!value) return '';
  const match = String(value).match(/^((?:[01]\d|2[0-3]):[0-5]\d)/);
  return match ? match[1] : '';
};

interface ModalBebanTrafoProps {
  trafoId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export const ModalBebanTrafo: React.FC<ModalBebanTrafoProps> = ({
  trafoId,
  onClose,
  onSaved,
}) => {
  const { showNotif } = useNotification();
  const dialogRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [trafoName, setTrafoName] = useState('');
  const [activeTab, setActiveTab] = useState<'wbp' | 'lwbp'>('wbp');

  useModalAccessibility(dialogRef, onClose, Boolean(trafoId));

  // Shared Header Info
  const [merek, setMerek] = useState('');
  const [grounding, setGrounding] = useState('');
  const initialMetadataRef = useRef<{ brand: string | null; grounding: string | null }>({
    brand: null,
    grounding: null,
  });
  const transformerRef = useRef<Transformer | null>(null);

  // WBP State
  const [wbpVR, setWbpVR] = useState('');
  const [wbpVS, setWbpVS] = useState('');
  const [wbpVT, setWbpVT] = useState('');
  const [wbpIR, setWbpIR] = useState('');
  const [wbpIS, setWbpIS] = useState('');
  const [wbpIT, setWbpIT] = useState('');
  const [wbpIN, setWbpIN] = useState('');
  const [wbpDate, setWbpDate] = useState('');
  const [wbpTime, setWbpTime] = useState('');
  const [wbpBranches, setWbpBranches] = useState<MeasurementBranch[]>([]);

  // LWBP State
  const [lwbpVR, setLwbpVR] = useState('');
  const [lwbpVS, setLwbpVS] = useState('');
  const [lwbpVT, setLwbpVT] = useState('');
  const [lwbpIR, setLwbpIR] = useState('');
  const [lwbpIS, setLwbpIS] = useState('');
  const [lwbpIT, setLwbpIT] = useState('');
  const [lwbpIN, setLwbpIN] = useState('');
  const [lwbpDate, setLwbpDate] = useState('');
  const [lwbpTime, setLwbpTime] = useState('');
  const [lwbpBranches, setLwbpBranches] = useState<MeasurementBranch[]>([]);

  useEffect(() => {
    if (trafoId) {
      void loadData(trafoId);
    }
    return () => {
      loadRequestRef.current += 1;
    };
  }, [trafoId]);

  const loadData = async (id: string) => {
    const requestId = ++loadRequestRef.current;
    try {
      setLoading(true);
      setLoaded(false);
      setError('');
      setActiveTab('wbp');
      setMerek('');
      setGrounding('');
      initialMetadataRef.current = { brand: null, grounding: null };
      transformerRef.current = null;
      setWbpVR('');
      setWbpVS('');
      setWbpVT('');
      setWbpIR('');
      setWbpIS('');
      setWbpIT('');
      setWbpIN('');
      setWbpDate('');
      setWbpTime('');
      setWbpBranches([]);
      setLwbpVR('');
      setLwbpVS('');
      setLwbpVT('');
      setLwbpIR('');
      setLwbpIS('');
      setLwbpIT('');
      setLwbpIN('');
      setLwbpDate('');
      setLwbpTime('');
      setLwbpBranches([]);

      const [transformerRes, measurementRes] = await Promise.all([
        api.getTransformerById(id),
        api.getMeasurements(id),
      ]);
      if (requestId !== loadRequestRef.current) return;
      if (!transformerRes?.data || !measurementRes?.data) {
        throw new Error('Data pengukuran tidak dapat dimuat.');
      }

      const transformer = transformerRes.data;
      transformerRef.current = transformer;
      const brand = transformer.brand ?? null;
      const groundingValue = transformer.grounding ?? null;
      setTrafoName(transformer.name);
      setMerek(brand ?? '');
      setGrounding(groundingValue ?? '');
      initialMetadataRef.current = { brand, grounding: groundingValue };

      const { wbp, lwbp } = measurementRes.data;
      if (wbp) {
        setWbpVR(numericInputValue(wbp.voltage.r));
        setWbpVS(numericInputValue(wbp.voltage.s));
        setWbpVT(numericInputValue(wbp.voltage.t));
        setWbpIR(numericInputValue(wbp.incoming.r));
        setWbpIS(numericInputValue(wbp.incoming.s));
        setWbpIT(numericInputValue(wbp.incoming.t));
        setWbpIN(numericInputValue(wbp.incoming.n));
        setWbpDate(dateInputValue(wbp.measurementDate));
        setWbpTime(timeInputValue(wbp.measurementTime));
        setWbpBranches(wbp.branches.map((branch) => ({ ...branch })));
      }

      if (lwbp) {
        setLwbpVR(numericInputValue(lwbp.voltage.r));
        setLwbpVS(numericInputValue(lwbp.voltage.s));
        setLwbpVT(numericInputValue(lwbp.voltage.t));
        setLwbpIR(numericInputValue(lwbp.incoming.r));
        setLwbpIS(numericInputValue(lwbp.incoming.s));
        setLwbpIT(numericInputValue(lwbp.incoming.t));
        setLwbpIN(numericInputValue(lwbp.incoming.n));
        setLwbpDate(dateInputValue(lwbp.measurementDate));
        setLwbpTime(timeInputValue(lwbp.measurementTime));
        setLwbpBranches(lwbp.branches.map((branch) => ({ ...branch })));
      }
      setLoaded(true);
    } catch (caught: unknown) {
      if (requestId !== loadRequestRef.current) return;
      const message = caught instanceof Error ? caught.message : 'Data pengukuran tidak dapat dimuat.';
      setError(message);
      showNotif('Gagal Memuat', message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  };

  const handleAddBranch = () => {
    const branchCount = activeTab === 'wbp' ? wbpBranches.length : lwbpBranches.length;
    const newBranch: MeasurementBranch = {
      name: `Jurusan ${String.fromCharCode(65 + branchCount)}`,
      r: null,
      s: null,
      t: null,
      n: null,
      fuse: null,
      note: null,
    };

    if (activeTab === 'wbp') {
      setWbpBranches([...wbpBranches, newBranch]);
    } else {
      setLwbpBranches([...lwbpBranches, newBranch]);
    }
  };

  const handleRemoveBranch = (idx: number) => {
    if (activeTab === 'wbp') {
      setWbpBranches(wbpBranches.filter((_, i) => i !== idx));
    } else {
      setLwbpBranches(lwbpBranches.filter((_, i) => i !== idx));
    }
  };

  const handleUpdateBranchField = (
    idx: number,
    field: keyof MeasurementBranch,
    value: string | number | null,
  ) => {
    if (activeTab === 'wbp') {
      const copy = [...wbpBranches];
      copy[idx] = { ...copy[idx], [field]: value } as MeasurementBranch;
      setWbpBranches(copy);
    } else {
      const copy = [...lwbpBranches];
      copy[idx] = { ...copy[idx], [field]: value } as MeasurementBranch;
      setLwbpBranches(copy);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trafoId) return;

    const voltageInputs = activeTab === 'wbp'
      ? [wbpVR, wbpVS, wbpVT]
      : [lwbpVR, lwbpVS, lwbpVT];
    const currentInputs = activeTab === 'wbp'
      ? [wbpIR, wbpIS, wbpIT, wbpIN]
      : [lwbpIR, lwbpIS, lwbpIT, lwbpIN];
    const parsedVoltage = voltageInputs.map((value) => Number(value));
    const parsedCurrent = currentInputs.map((value) => Number(value));

    if (
      voltageInputs.some((value) => value.trim() === '') ||
      parsedVoltage.some((value) => !Number.isFinite(value) || value < 0 || value > 500)
    ) {
      setError('Tegangan R, S, dan T wajib diisi dengan angka antara 0 dan 500 V.');
      return;
    }
    if (
      currentInputs.some((value) => value.trim() === '') ||
      parsedCurrent.some((value) => !Number.isFinite(value) || value < 0)
    ) {
      setError('Arus incoming R, S, T, dan N wajib diisi dengan angka nol atau lebih besar.');
      return;
    }

    const measurementDate = activeTab === 'wbp' ? wbpDate : lwbpDate;
    const measurementTime = activeTab === 'wbp' ? wbpTime : lwbpTime;
    const activeBranches = activeTab === 'wbp' ? wbpBranches : lwbpBranches;
    const branches = activeBranches.map((branch) => ({
      name: branch.name?.trim() || null,
      r: branch.r,
      s: branch.s,
      t: branch.t,
      n: branch.n,
      fuse: branch.fuse?.trim() || null,
      note: branch.note?.trim() || null,
    }));

    const payload: SaveMeasurementRequest = {
      period: activeTab,
      voltage: {
        r: parsedVoltage[0],
        s: parsedVoltage[1],
        t: parsedVoltage[2],
      },
      incoming: {
        r: parsedCurrent[0],
        s: parsedCurrent[1],
        t: parsedCurrent[2],
        n: parsedCurrent[3],
      },
      branches,
      measurementDate: measurementDate.trim() || null,
      measurementTime: measurementTime.trim() || null,
    };

    const nextBrand = merek.trim() || null;
    const nextGrounding = grounding.trim() || null;
    const metadataChanges: { brand?: string | null; grounding?: string | null } = {};
    if (nextBrand !== initialMetadataRef.current.brand) metadataChanges.brand = nextBrand;
    if (nextGrounding !== initialMetadataRef.current.grounding) {
      metadataChanges.grounding = nextGrounding;
    }

    setSaving(true);
    setError('');
    let metadataSaved = false;
    try {
      if (Object.keys(metadataChanges).length > 0) {
        const transformer = transformerRef.current;
        if (!transformer) {
          throw new Error('Data trafo tidak dapat dimuat untuk pembaruan metadata.');
        }
        const payload: TransformerWritePayload = {
          name: transformer.name,
          feeder: transformer.feeder ?? null,
          capacity: transformer.capacity ?? null,
          capacityKva: transformer.capacityKva ?? null,
          brand: nextBrand,
          grounding: nextGrounding,
          location: transformer.location ?? null,
          rawCoordinates: transformer.rawCoordinates ?? null,
        };
        await api.updateTransformer(trafoId, payload);
        transformerRef.current = { ...transformer, brand: nextBrand, grounding: nextGrounding };
        initialMetadataRef.current = { brand: nextBrand, grounding: nextGrounding };
        metadataSaved = true;
      }
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : 'Metadata trafo tidak dapat disimpan.';
      const metadataError = `Metadata trafo gagal disimpan. Pengukuran belum disimpan. ${message}`;
      setError(metadataError);
      showNotif('Gagal Menyimpan', metadataError);
      setSaving(false);
      return;
    }

    try {
      await api.saveMeasurement(trafoId, payload);
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : 'Data pengukuran tidak dapat disimpan.';
      if (metadataSaved) {
        const partialSaveMessage = `Penyimpanan sebagian berhasil: metadata trafo telah disimpan, tetapi data pengukuran belum berhasil disimpan. ${message} Silakan coba lagi untuk menyimpan pengukuran.`;
        setError(partialSaveMessage);
        showNotif('Penyimpanan Sebagian Berhasil', partialSaveMessage);
      } else {
        setError(message);
        showNotif('Gagal Menyimpan', message);
      }
      setSaving(false);
      return;
    }

    setSaving(false);
    showNotif('Tersimpan', `Data pengukuran beban ${activeTab.toUpperCase()} berhasil disimpan ke database.`);
    onSaved();
    onClose();
  };

  if (!trafoId) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="measurement-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-[#005b82] to-[#00A2E9] text-white flex items-center justify-between shrink-0">
          <div>
            <h3 id="measurement-modal-title" className="text-xl font-bold">Input &amp; Edit Pengukuran Beban</h3>
            <p className="text-xs text-blue-100 mt-1">
              Trafo: <span className="font-bold underline">{trafoName}</span>
            </p>
          </div>
          <button
            type="button" aria-label="Tutup input pengukuran" onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg transition-colors cursor-pointer"
          >
            &times;
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
            {loading ? (
              <div className="py-16 text-center text-gray-400" aria-live="polite">
                <i className="fa-solid fa-circle-notch fa-spin text-2xl text-[#00A2E9] mb-3 block" aria-hidden="true"></i>
                Memuat data formulir pengukuran...
              </div>
            ) : !loaded && error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 space-y-3">
                <ModalErrorAlert
                  message={error}
                  className="border-0 bg-transparent px-0 py-0"
                />
                <button
                  type="button"
                  onClick={() => trafoId && loadData(trafoId)}
                  className="px-3 py-1.5 border border-red-200 bg-white text-red-700 rounded-lg font-semibold hover:bg-red-100 transition-colors"
                >
                  Coba lagi
                </button>
              </div>
            ) : (
              <>
                <ModalErrorAlert message={error} />

                {/* Brand & Grounding */}
                <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div>
                    <label htmlFor="measurement-brand" className="block text-gray-700 font-bold mb-1">Merek Trafo</label>
                    <input
                      id="measurement-brand"
                      type="text"
                      value={merek}
                      onChange={(e) => setMerek(e.target.value)}
                      className="w-full p-2 bg-white rounded-lg border border-gray-200 font-semibold"
                      placeholder="Contoh: Voltra, Sintra, Trafindo"
                    />
                  </div>
                  <div>
                    <label htmlFor="measurement-grounding" className="block text-gray-700 font-bold mb-1">Kondisi Grounding</label>
                    <select
                      id="measurement-grounding"
                      value={grounding}
                      onChange={(e) => setGrounding(e.target.value)}
                      className="w-full p-2 bg-white rounded-lg border border-gray-200 font-semibold cursor-pointer"
                    >
                      <option value="">Tidak diisi</option>
                      <option value="Ada">Ada</option>
                      <option value="Tidak Ada">Tidak Ada</option>
                      <option value="Rusak">Rusak / Perlu Perbaikan</option>
                    </select>
                  </div>
                </div>

                {/* Periode Tabs */}
                <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('wbp')}
                    aria-pressed={activeTab === 'wbp'}
                    className={`px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${
                      activeTab === 'wbp'
                        ? 'bg-orange-500 text-white shadow-md'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    WBP (Waktu Beban Puncak)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('lwbp')}
                    aria-pressed={activeTab === 'lwbp'}
                    className={`px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${
                      activeTab === 'lwbp'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    LWBP (Luar Beban Puncak)
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="measurement-date" className="block text-gray-500 font-medium mb-1">
                      Tanggal Pengukuran
                    </label>
                    <input
                      id="measurement-date"
                      type="date"
                      value={activeTab === 'wbp' ? wbpDate : lwbpDate}
                      onChange={(e) => {
                        activeTab === 'wbp' ? setWbpDate(e.target.value) : setLwbpDate(e.target.value);
                      }}
                      className="w-full p-2 rounded-lg border border-gray-200 font-semibold"
                    />
                  </div>
                  <div>
                    <label htmlFor="measurement-time" className="block text-gray-500 font-medium mb-1">
                      Jam Pengukuran
                    </label>
                    <input
                      id="measurement-time"
                      type="time"
                      value={activeTab === 'wbp' ? wbpTime : lwbpTime}
                      onChange={(e) => {
                        activeTab === 'wbp' ? setWbpTime(e.target.value) : setLwbpTime(e.target.value);
                      }}
                      className="w-full p-2 rounded-lg border border-gray-200 font-semibold"
                    />
                  </div>
                </div>

                {/* Tegangan Inputs */}
                <div>
                  <h4 className="font-bold text-gray-800 uppercase tracking-wider mb-2">
                    Tegangan Fasa - Netral (Volt)
                  </h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="measurement-voltage-r" className="block text-gray-500 font-medium mb-1">Tegangan R-N</label>
                      <input
                        id="measurement-voltage-r"
                        type="number"
                        min={0}
                        max={500}
                        value={activeTab === 'wbp' ? wbpVR : lwbpVR}
                        onChange={(e) => {
                          activeTab === 'wbp' ? setWbpVR(e.target.value) : setLwbpVR(e.target.value);
                        }}
                        required
                        className="w-full p-2 rounded-lg border border-gray-200 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label htmlFor="measurement-voltage-s" className="block text-gray-500 font-medium mb-1">Tegangan S-N</label>
                      <input
                        id="measurement-voltage-s"
                        type="number"
                        min={0}
                        max={500}
                        value={activeTab === 'wbp' ? wbpVS : lwbpVS}
                        onChange={(e) => {
                          activeTab === 'wbp' ? setWbpVS(e.target.value) : setLwbpVS(e.target.value);
                        }}
                        required
                        className="w-full p-2 rounded-lg border border-gray-200 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label htmlFor="measurement-voltage-t" className="block text-gray-500 font-medium mb-1">Tegangan T-N</label>
                      <input
                        id="measurement-voltage-t"
                        type="number"
                        min={0}
                        max={500}
                        value={activeTab === 'wbp' ? wbpVT : lwbpVT}
                        onChange={(e) => {
                          activeTab === 'wbp' ? setWbpVT(e.target.value) : setLwbpVT(e.target.value);
                        }}
                        required
                        className="w-full p-2 rounded-lg border border-gray-200 font-mono font-bold"
                      />
                    </div>
                  </div>
                </div>

                {/* Incoming Current Inputs */}
                <div>
                  <h4 className="font-bold text-gray-800 uppercase tracking-wider mb-2">
                    Arus Incoming Trafo (Ampere)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label htmlFor="measurement-current-r" className="block text-red-600 font-bold mb-1">Incoming R (A)</label>
                      <input
                        id="measurement-current-r"
                        type="number"
                        min={0}
                        value={activeTab === 'wbp' ? wbpIR : lwbpIR}
                        onChange={(e) => {
                          activeTab === 'wbp' ? setWbpIR(e.target.value) : setLwbpIR(e.target.value);
                        }}
                        required
                        className="w-full p-2 rounded-lg border border-red-200 bg-red-50/30 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label htmlFor="measurement-current-s" className="block text-amber-600 font-bold mb-1">Incoming S (A)</label>
                      <input
                        id="measurement-current-s"
                        type="number"
                        min={0}
                        value={activeTab === 'wbp' ? wbpIS : lwbpIS}
                        onChange={(e) => {
                          activeTab === 'wbp' ? setWbpIS(e.target.value) : setLwbpIS(e.target.value);
                        }}
                        required
                        className="w-full p-2 rounded-lg border border-amber-200 bg-amber-50/30 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label htmlFor="measurement-current-t" className="block text-blue-600 font-bold mb-1">Incoming T (A)</label>
                      <input
                        id="measurement-current-t"
                        type="number"
                        min={0}
                        value={activeTab === 'wbp' ? wbpIT : lwbpIT}
                        onChange={(e) => {
                          activeTab === 'wbp' ? setWbpIT(e.target.value) : setLwbpIT(e.target.value);
                        }}
                        required
                        className="w-full p-2 rounded-lg border border-blue-200 bg-blue-50/30 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label htmlFor="measurement-current-n" className="block text-gray-600 font-bold mb-1">Incoming N (A)</label>
                      <input
                        id="measurement-current-n"
                        type="number"
                        min={0}
                        value={activeTab === 'wbp' ? wbpIN : lwbpIN}
                        onChange={(e) => {
                          activeTab === 'wbp' ? setWbpIN(e.target.value) : setLwbpIN(e.target.value);
                        }}
                        required
                        className="w-full p-2 rounded-lg border border-gray-200 bg-gray-50 font-mono font-bold"
                      />
                    </div>
                  </div>
                </div>

                {/* Dynamic Jurusan Branches */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-bold text-gray-800 uppercase tracking-wider">
                      Rincian Jurusan / Percabangan
                    </h4>
                    <button
                      type="button"
                      onClick={handleAddBranch}
                      className="px-2.5 py-1 bg-blue-50 text-[#00A2E9] hover:bg-blue-100 rounded-lg font-bold transition-colors cursor-pointer"
                    >
                      <i className="fa-solid fa-plus mr-1" aria-hidden="true"></i> Tambah Jurusan
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {(activeTab === 'wbp' ? wbpBranches : lwbpBranches).map((j, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex flex-col md:flex-row items-center gap-2"
                      >
                        <input
                          type="text"
                          aria-label={`Nama jurusan ${idx + 1}`}
                          value={j.name ?? ''}
                          onChange={(e) => handleUpdateBranchField(idx, 'name', e.target.value)}
                          placeholder="Nama Jurusan"
                          className="w-full md:w-32 p-1.5 bg-white rounded border border-gray-200 font-bold"
                        />
                        <div className="grid grid-cols-4 gap-1.5 flex-1 w-full">
                          <input
                            type="number"
                            min={0}
                            aria-label={`Arus fasa R jurusan ${idx + 1}`}
                            value={j.r ?? ''}
                            onChange={(e) =>
                              handleUpdateBranchField(
                                idx,
                                'r',
                                e.target.value === '' ? null : Number(e.target.value),
                              )
                            }
                            placeholder="R"
                            title="Fasa R"
                            className="p-1.5 bg-white rounded border border-gray-200 text-center font-mono"
                          />
                          <input
                            type="number"
                            min={0}
                            aria-label={`Arus fasa S jurusan ${idx + 1}`}
                            value={j.s ?? ''}
                            onChange={(e) =>
                              handleUpdateBranchField(
                                idx,
                                's',
                                e.target.value === '' ? null : Number(e.target.value),
                              )
                            }
                            placeholder="S"
                            title="Fasa S"
                            className="p-1.5 bg-white rounded border border-gray-200 text-center font-mono"
                          />
                          <input
                            type="number"
                            min={0}
                            aria-label={`Arus fasa T jurusan ${idx + 1}`}
                            value={j.t ?? ''}
                            onChange={(e) =>
                              handleUpdateBranchField(
                                idx,
                                't',
                                e.target.value === '' ? null : Number(e.target.value),
                              )
                            }
                            placeholder="T"
                            title="Fasa T"
                            className="p-1.5 bg-white rounded border border-gray-200 text-center font-mono"
                          />
                          <input
                            type="number"
                            min={0}
                            aria-label={`Arus netral jurusan ${idx + 1}`}
                            value={j.n ?? ''}
                            onChange={(e) =>
                              handleUpdateBranchField(
                                idx,
                                'n',
                                e.target.value === '' ? null : Number(e.target.value),
                              )
                            }
                            placeholder="N"
                            title="Netral"
                            className="p-1.5 bg-white rounded border border-gray-200 text-center font-mono"
                          />
                        </div>
                        <input
                          type="text"
                          aria-label={`Fuse jurusan ${idx + 1}`}
                          value={j.fuse ?? ''}
                          onChange={(e) => handleUpdateBranchField(idx, 'fuse', e.target.value)}
                          placeholder="Fuse"
                          className="w-full md:w-20 p-1.5 bg-white rounded border border-gray-200 text-center"
                        />
                        <button
                          type="button"
                          aria-label={`Hapus jurusan ${idx + 1}`}
                          onClick={() => handleRemoveBranch(idx)}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer"
                        >
                          <i className="fa-solid fa-trash" aria-hidden="true"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2 shrink-0">
            <button
              type="button" onClick={onClose}
              className="px-5 py-2 border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-100 transition-colors cursor-pointer text-xs"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || loading || !loaded}
              className="px-6 py-2 bg-[#00A2E9] hover:bg-[#008ecf] text-white font-bold rounded-xl transition-all shadow-md active:scale-95 cursor-pointer text-xs disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan Pengukuran'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
