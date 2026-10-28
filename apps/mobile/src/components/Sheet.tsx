import { useEffect, useRef, type ReactNode } from 'react';
import { Modal, Platform } from 'react-native';
import { PaddedWindow } from './bottomInset';
import { useSheetAnimation } from './reducedMotion';

/** The element that has focus now (what opened a sheet), where there is a DOM. */
const activeElement = (): HTMLElement | null => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);

/**
 * On the web, a dialog should start with focus on its title (screen readers then read it first). react-native-web marks the
 * dialog (role, focus trap) active some time after `onShow`, and the trap then focuses the first button: the title takes focus
 * only once the dialog exists and the trap has put focus inside it. Returns whether it did; false means "not yet" (or no DOM).
 */
export function focusSheetTitle(title: string): boolean {
  if (typeof document === 'undefined') return false;
  const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => d.getAttribute('aria-label') === title);
  // Unquoted on purpose: the heading-levels guard flags the quoted form as an assignment of the role.
  const heading = dialog?.querySelector<HTMLElement>('[role=heading]');
  if (!dialog || !heading || !dialog.contains(document.activeElement)) return false;
  heading.setAttribute('tabindex', '-1'); // focusable by script, not in the tab order
  heading.focus();
  return true;
}

const TICK_MS = 16;
// About two seconds, then leave focus where the trap put it: a slow first paint on a loaded device can take longer than a
// second, and the fix would become a coin flip. Closing the sheet cancels the retry (the unmount cleanup clears it).
const GIVE_UP_TICKS = 125;

/**
 * Every full-screen sheet: a modal with an accessible name (`title`, the same text as its heading) so the web dialog is
 * announced by name, initial focus on that heading on the web, and focus returned to the opener on close.
 */
export function SheetModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const animation = useSheetAnimation();
  const opener = useRef<HTMLElement | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = Platform.OS === 'web' ? activeElement() : null; // before the modal takes focus
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Read through a ref: a sheet whose title changes while the retry runs still searches for the name on screen, not the
  // one captured when `onShow` fired. Synced in an effect (React forbids writing a ref during render).
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title;
  });
  // Unmount only (not on a title change): give focus back to the opener and cancel a pending title focus.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      opener.current?.focus();
    },
    [],
  );
  // Modal's `onShow` is when the slide animation ends and the dialog is switched on, which React renders a little later.
  const onShow = () => {
    if (Platform.OS !== 'web') return;
    clearTimeout(timer.current);
    const attempt = (left: number) => {
      if (!focusSheetTitle(titleRef.current) && left > 0) timer.current = setTimeout(() => attempt(left - 1), TICK_MS);
    };
    attempt(GIVE_UP_TICKS);
  };
  // `aria-label` reaches the web dialog (react-native-web passes extra props on). Native starts on the title already (and a
  // modal labelled like the button that opened it would only be a second match for that label).
  const named = (Platform.OS === 'web' ? { 'aria-label': title } : {}) as object;
  return (
    <Modal visible animationType={animation} onRequestClose={onClose} onShow={onShow} {...named}>
      <PaddedWindow>{children}</PaddedWindow>
    </Modal>
  );
}
