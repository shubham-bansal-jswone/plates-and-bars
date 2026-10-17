import { useEffect } from 'react';

// A message posted on one screen and shown on the next (setup saves, then the Food tab toasts). The Food tab stays
// mounted, so it listens; if it is not mounted yet it takes the message when it mounts.
let pending: string | null = null;
const listeners = new Set<() => void>();

export function postToast(message: string): void {
  pending = message;
  listeners.forEach((l) => l());
}

/** Calls `show` with a posted message, once. */
export function usePendingToast(show: (message: string) => void): void {
  useEffect(() => {
    const run = () => {
      if (pending === null) return;
      const m = pending;
      pending = null;
      show(m);
    };
    run();
    listeners.add(run);
    return () => void listeners.delete(run);
  }, [show]);
}
