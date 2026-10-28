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
  // Only while it has focus: left on, the focus trap's walk would land on the title again at every wrap (#1275). Removed after
  // the blur has been handled, not during it: the trap's Shift+Tab handler runs right after the blur and, with the title still
  // focusable, wraps from it to the last control (a sync removal sent the first Shift+Tab forward to the first control).
  heading.addEventListener(
    'blur',
    () =>
      setTimeout(() => {
        if (document.activeElement !== heading) heading.removeAttribute('tabindex');
      }, 0),
    { once: true },
  );
  heading.focus();
  return true;
}

// What a browser focuses on its own and what react-native-web marks tabbable (it sets `tabindex`), so a stop on anything else is not a control.
const FOCUSABLE = 'a[href],area[href],button,input,select,textarea,summary,iframe,audio[controls],video[controls],[contenteditable]';

/**
 * Chromium lets script focus a scrolling container (the sheet's page ScrollView is `overflow: auto`). react-native-web's focus
 * trap walks the dialog with `element.focus()` and keeps the first element that accepts it, so on a wrap it stopped on that
 * unlabelled full-screen div instead of the first or last control, and Shift+Tab then stayed on it (#1275). A focus event on an
 * element that is neither natively focusable nor given a `tabindex` is such a container: drop focus at once, so the trap's own
 * check fails and it carries on to the next element (the title takes focus through `tabindex="-1"`, which is allowed).
 */
export function refuseScrollerFocus(event: { target: EventTarget | null }): void {
  const el = event.target;
  if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return;
  if (el.hasAttribute('tabindex') || el.matches(FOCUSABLE)) return;
  el.blur();
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
  // Web only, while the sheet is open (capture: focus does not bubble). Registered after react-native-web's trap, which lives below.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    // One function per sheet: the browser keeps a single copy of a listener registered twice with the same function, so a shared
    // one would be removed for every open sheet when the top one of a stack closes.
    const guard = (event: Event) => refuseScrollerFocus(event);
    document.addEventListener('focus', guard, true);
    return () => document.removeEventListener('focus', guard, true);
  }, []);
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
