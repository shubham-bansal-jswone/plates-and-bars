/**
 * One FIFO queue for every write to today's workout (the Workout tab's hook and the avoid picker on Targets), so they
 * finish in the order the user acted. `writes` counts local edits, so a reload that straddled one is read again.
 */
export const dayQueue: { current: Promise<unknown> } = { current: Promise.resolve() };
export const dayWrites = { current: 0 };

const listeners = new Set<() => void>();

/** Calls `f` after each queued write has finished (saved or failed). Returns the unsubscribe. The home-screen widget uses it (#1181). */
export function onDayWritten(f: () => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** Queues `write`; a failure is reported through `onError` and does not stop the queue. */
export function enqueueDay(write: () => Promise<void>, onError: () => void): Promise<unknown> {
  dayWrites.current++;
  dayQueue.current = dayQueue.current.then(write).catch(onError).then(() => {
    // A listener must never break the queue.
    for (const f of listeners) {
      try {
        f();
      } catch {
        /* ignored */
      }
    }
  });
  return dayQueue.current;
}
