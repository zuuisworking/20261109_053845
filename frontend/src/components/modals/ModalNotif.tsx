import { useRef } from 'react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import type { AppNotification } from '../../types/notifications';

interface ModalNotifProps {
  notification: AppNotification | null;
  onClose: () => void;
}

export default function ModalNotif({ notification, onClose }: ModalNotifProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, onClose, Boolean(notification));

  if (!notification) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-title"
        aria-describedby="notification-message"
        tabIndex={-1}
        className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center transform scale-100 transition-all"
      >
        <div className="w-14 h-14 bg-blue-50 text-plnBlue rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-100 text-xl shadow-inner">
          <i className="fa-solid fa-circle-info" aria-hidden="true"></i>
        </div>
        <h3 id="notification-title" className="text-lg font-bold text-gray-800 mb-2">
          {notification.title}
        </h3>
        <div
          id="notification-message"
          className="text-sm text-gray-600 whitespace-pre-line leading-relaxed max-h-64 overflow-y-auto mb-6"
        >
          {notification.message}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 bg-plnBlue hover:bg-[#008ecf] text-white font-semibold rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
        >
          Mengerti
        </button>
      </div>
    </div>
  );
}
