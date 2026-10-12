import { BUNDLED, type BundleMeta } from './bundled';
import { deleteStored, loadStored, type ContentDb } from './store';

const later = (a: string, b: string): boolean => Date.parse(a) > Date.parse(b);

/**
 * True when a stored server copy should be used over the bundled one: the name is known, the build supports its
 * schema_version and its updated_at is later than the bundled copy's (the contract's rule; bytes are not compared, so a
 * server revert to the shipped bytes, which carries a later date, is kept like any other later copy).
 */
export function beatsBundled(name: string, copy: BundleMeta): boolean {
  const bundled = BUNDLED[name];
  return !!bundled && copy.schema_version === bundled.schema_version && later(copy.updated_at, bundled.updated_at);
}

const active = new Map<string, unknown>();
let generation = 0;

/** Changes each time `loadContent` runs; readers key their memo on it. */
export const contentGeneration = (): number => generation;

/**
 * App start: keeps each stored server copy that beats this build's bundled copy and discards the rest (so an app
 * upgrade drops copies the new build has caught up with). Failures leave the bundled copies in use.
 * The result is read with `bundle()`; a copy fetched later applies on the next launch, so screens never change under the user.
 */
export async function loadContent(db: ContentDb): Promise<void> {
  active.clear();
  try {
    for (const row of await loadStored(db)) {
      try {
        if (!beatsBundled(row.name, row)) {
          await deleteStored(db, row.name);
          continue;
        }
        active.set(row.name, JSON.parse(row.body));
      } catch {
        // an unreadable row is skipped; the bundled copy stays in use
      }
    }
  } catch {
    // store unavailable: bundled copies
  } finally {
    generation++; // after the awaited load, so nothing cached while it ran outlives it
  }
}

/** The copy to use for `name`: the server copy chosen at app start if there is one, otherwise the bundled `fallback` (the build-time import). */
export function bundle<T>(name: string, fallback: T): T {
  return (active.has(name) ? active.get(name) : fallback) as T;
}
