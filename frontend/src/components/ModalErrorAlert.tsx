import { useEffect, useRef } from 'react';

interface ModalErrorAlertProps {
  message: string;
  className?: string;
}

export function ModalErrorAlert({ message, className = '' }: ModalErrorAlertProps) {
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!message) return;
    alertRef.current?.focus({ preventScroll: false });
  }, [message]);

  if (!message) return null;

  return (
    <div
      ref={alertRef}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      tabIndex={-1}
      className={`bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2 ${className}`}
    >
      <i className="fas fa-exclamation-circle" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
