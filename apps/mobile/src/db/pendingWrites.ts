/**
 * Writes made outside the Food screen that change what Food shows (recipes and kitchen tests save foods and log entries).
 * Each hook registers its queue tail here, and Food's re-read waits for all of it, so the day never shows between two
 * statements of a save, whichever way the user left the screen (button, swipe, hardware or browser back).
 */
const pending = new Set<Promise<unknown>>();

/** Registers a write; it leaves the registry when it settles. */
export function trackWrite(p: Promise<unknown>): void {
  const done = p.then(
    () => undefined,
    () => undefined,
  );
  pending.add(done);
  void done.then(() => pending.delete(done));
}

/** Resolves when every registered write has settled, including ones registered while waiting. */
export async function pendingWrites(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
