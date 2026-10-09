import { pendingWrites } from '../db/pendingWrites';

/** A queue of local writes plus a count of how many were made (the "write counter"). */
export interface WriteTracker {
  /** The tail of the FIFO write queue. */
  queue: { current: Promise<unknown> };
  /** Bumps whenever a local edit is shown or queued. */
  writes: { current: number };
}

/**
 * Reads SQLite for a reload after sync pulled records, without clobbering local edits. It waits for queued writes (this screen's and the ones other screens registered with `trackWrite`), reads,
 * and throws the result away when a local edit was made while the read was in flight, then reads
 * again: a read that straddled an edit holds the old rows, and showing it would drop the edit from the screen and let a
 * later save write the old values back. `apply` runs straight after the counter check, in the same synchronous step, so no edit can slip in between. `alive()` ends the loop when the screen no longer wants the result.
 */
export async function freshRead<T>(t: WriteTracker, read: () => Promise<T>, alive: () => boolean, apply: (result: T) => void): Promise<void> {
  while (alive()) {
    const seen = t.writes.current;
    await pendingWrites(); // saves made on other screens (recipes, kitchen tests) that change what is shown
    await t.queue.current;
    const result = await read();
    // Checked and applied in one synchronous step: a local edit that resumes from an await (a session being built) cannot land between them.
    if (t.writes.current === seen) {
      if (alive()) apply(result);
      return;
    }
  }
}
