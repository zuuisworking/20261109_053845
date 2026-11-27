import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import ModalConfirm from '../components/modals/ModalConfirm';
import ModalNotif from '../components/modals/ModalNotif';
import type { AppNotification, ConfirmNotification } from '../types/notifications';

interface NotificationContextType {
  showNotif: (title: string, message: string, type?: AppNotification['type']) => void;
  showConfirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    confirmLabel?: string,
  ) => void;
  closeNotif: () => void;
  closeConfirm: () => void;
}

export const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notification, setNotification] = useState<AppNotification | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmNotification | null>(null);

  const showNotif = (title: string, message: string, type: AppNotification['type'] = 'info') => {
    setNotification({ title, message, type });
  };

  const closeNotif = () => setNotification(null);

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    confirmLabel?: string,
  ) => {
    setConfirmation({ title, message, onConfirm, confirmLabel });
  };

  const closeConfirm = () => setConfirmation(null);

  const value = useMemo(
    () => ({ showNotif, showConfirm, closeNotif, closeConfirm }),
    [],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <ModalNotif notification={notification} onClose={closeNotif} />
      <ModalConfirm confirmation={confirmation} onClose={closeConfirm} />
    </NotificationContext.Provider>
  );
}

export function useNotification(): NotificationContextType {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotification harus digunakan di dalam NotificationProvider.');
  return context;
}
