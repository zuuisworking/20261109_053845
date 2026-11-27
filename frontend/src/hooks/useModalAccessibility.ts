import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const modalStack: symbol[] = [];

export function useModalAccessibility(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
): void {
  const closeRef = useRef(onClose);
  const tokenRef = useRef<symbol>(Symbol('modal'));

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;

    const token = tokenRef.current;
    const dialog = dialogRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const isTopModal = () => modalStack[modalStack.length - 1] === token;

    modalStack.push(token);

    if (isTopModal()) {
      const focusable = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable ?? dialog)?.focus({ preventScroll: true });
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal()) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
      );
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      const wasTopModal = isTopModal();
      const stackIndex = modalStack.lastIndexOf(token);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);

      document.removeEventListener('keydown', handleKeyDown);
      if (wasTopModal) {
        previouslyFocused?.focus({ preventScroll: true });
      }
    };
  }, [active, dialogRef]);
}
