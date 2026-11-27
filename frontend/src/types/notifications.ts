export interface AppNotification {
  title: string;
  message: string;
  type?: 'success' | 'error' | 'info';
}

export interface ConfirmNotification {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}
