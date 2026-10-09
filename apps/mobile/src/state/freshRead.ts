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
 * and throws the result away when a local edit was made (or `settled()` is false) while the read was in flight, then reads
 * again: a read that straddled an edit holds the old rows, and showing it would drop the edit from the screen and let a
 * later save write the old values back. `alive()` ends the loop when the screen no longer wants the result.
 */
export async function freshRead<T>(t: WriteTracker, read: () => Promise<T>, alive: () => boolean, settled: () => boolean = () => true): Promise<T | undefined> {
  while (alive()) {
    const seen = t.writes.current;
    await pendingWrites(); // saves made on other screens (recipes, kitchen tests) that change what is shown
    await t.queue.current;
    if (!settled()) {
      await new Promise((r) => setTimeout(r, 20));
      continue;
    }
    const result = await read();
    if (t.writes.current === seen && settled()) return result;
  }
  return undefined;
}
