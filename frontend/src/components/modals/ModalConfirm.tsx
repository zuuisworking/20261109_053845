import { useRef } from 'react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import type { ConfirmNotification } from '../../types/notifications';

interface ModalConfirmProps {
  confirmation: ConfirmNotification | null;
  onClose: () => void;
}

export default function ModalConfirm({ confirmation, onClose }: ModalConfirmProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, onClose, Boolean(confirmation));

  if (!confirmation) return null;

  const handleConfirm = () => {
    confirmation.onConfirm();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-message"
        tabIndex={-1}
        className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center transform scale-100 transition-all"
      >
        <div className="w-14 h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100 text-xl shadow-inner">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        </div>
        <h3 id="confirmation-title" className="text-lg font-bold text-gray-800 mb-2">
          {confirmation.title}
        </h3>
        <p id="confirmation-message" className="text-sm text-gray-600 leading-relaxed mb-6">
          {confirmation.message}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
          >
            {confirmation.confirmLabel || 'Ya, Lanjutkan'}
          </button>
        </div>
      </div>
    </div>
  );
}
