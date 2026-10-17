import { useEffect, useRef, type ReactNode } from 'react';
import { Modal, Platform } from 'react-native';

/** The element that has focus now (what opened a sheet), where there is a DOM. */
const activeElement = (): HTMLElement | null => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);

/**
 * On the web, a dialog should start with focus on its title (screen readers then read it first). react-native-web puts focus
 * on the first button, so once it has done so the title takes it. A no-op where there is no DOM (native).
 */
export function focusSheetTitle(title: string): void {
  if (typeof document === 'undefined') return;
  const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => d.getAttribute('aria-label') === title);
  const heading = dialog?.querySelector<HTMLElement>('[role="heading"]');
  if (!heading) return;
  heading.setAttribute('tabindex', '-1'); // focusable by script, not in the tab order
  heading.focus();
}

/**
 * Every full-screen sheet: a modal with an accessible name (`title`, the same text as its heading) so the web dialog is
 * announced by name, initial focus on that heading on the web, and focus returned to the opener on close.
 */
export function SheetModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const opener = useRef<HTMLElement | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = Platform.OS === 'web' ? activeElement() : null; // before the modal takes focus
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // The modal's content mounts after this effect, and its focus trap moves focus when it does: wait a tick, then take focus.
    const t = setTimeout(() => focusSheetTitle(title), 0);
    return () => {
      clearTimeout(t);
      opener.current?.focus();
    };
  }, [title]);
  // `aria-label` reaches the web dialog (react-native-web passes extra props on). Native starts on the title already (and a
  // modal labelled like the button that opened it would only be a second match for that label).
  const named = (Platform.OS === 'web' ? { 'aria-label': title } : {}) as object;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} {...named}>
      {children}
    </Modal>
  );
}
