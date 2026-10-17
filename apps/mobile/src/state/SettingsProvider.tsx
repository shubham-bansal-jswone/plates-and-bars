import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings } from '../db/settings';
import { inTransaction, type PullDb } from '../db/outbox';
import { storeEpoch } from '../db/storeEpoch';
import type { StoreDb } from '../db/records';
import { CUSTOM_EXERCISES_MAX, type ExerciseTag, type FlexEntry, type MealPlan } from '@plate-and-bar/core';
import { defaultSettings, type Settings } from '../settings/types';
import { exerciseNamed, setCustomTags } from '../workout/catalog';
import { clearKept, keptCopy, persistKept, readKept, replayKept, type KeptEdit } from './keptEdits';

interface SettingsState {
  ready: boolean;
  settings: Settings;
  /** True after a write to SQLite failed; cleared by the next successful write. */
  saveFailed: boolean;
  /** True when the stored record could not be read: writes are refused, so defaults never replace it. */
  loadFailed: boolean;
  /** Replaces the focus muscles. The caller (the Targets screen, with core's rules) decides what is allowed. */
  setFocus(focus: readonly string[]): void;
  setRestOff(off: boolean): void;
  /** Replaces the flex entries (the Food tab plans them with core's `planFlex`/`undoFlex`). */
  setFlex(flex: readonly FlexEntry[]): void;
  /** Sets the meal-idea diet filter. */
  setDiet(diet: Settings['diet']): void;
  /** Saves the weekly meal plan. */
  setMealPlan(plan: MealPlan): void;
  /**
   * Saves a custom exercise's tags (prototype `tg-save`). Resolves once the save has decided: false when the name is refused (a
   * known exercise in another letter case, or the limit is reached, judged against the stored record) or the record cannot be
   * written at all; true when it is accepted, also if the write itself fails later (the edit is kept and shows, as offline).
   */
  addCustomTags(name: string, tags: ExerciseTag): Promise<boolean>;
  /** Merges a change into the record (the Progress check-in's adjustments and real-burn state). */
  update(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>), done?: (stored: boolean) => void): boolean;
}

const Ctx = createContext<SettingsState | null>(null);
/** Thrown inside a save that found its provider gone or the store wiped since it was queued. */
class Dropped extends Error {}
/**
 * True when a custom exercise `name` cannot be added to `have`. A name that is a known exercise in another letter case would be
 * a near-duplicate (#450): the typed-name flow adds the known one. The contract keeps at most 500 custom exercises; replacing
 * one already there is always fine.
 */
function customRefused(have: Settings['custom_tags'], name: string): boolean {
  const known = exerciseNamed(name, have);
  if (known !== undefined && known !== name) return true;
  return !Object.prototype.hasOwnProperty.call(have, name) && Object.keys(have).length >= CUSTOM_EXERCISES_MAX;
}
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Holds the local Settings record. A change shows at once and its write is queued (FIFO, each write reads
 * the latest state when it runs), so nothing waits on the network or on an earlier write.
 */
export function SettingsProvider({ db, reloadKey = 0, children }: { db: StoreDb & PullDb; /** Changes when records were pulled from the server: the settings are read again (after pending local writes). */ reloadKey?: number; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const blocked = useRef(false);
  const [settings, setState] = useState<Settings>(() => defaultSettings(stamp(new Date())));
  const ref = useRef(settings);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Counts local changes, so a reload can tell that one started while it was reading (#597). */
  const writes = useRef(0);
  /** Changes made and not yet finished writing (saved or failed). */
  const pending = useRef(0);
  /** Edits whose write failed: the next save applies them again, once each, so a later edit does not drop them. A field a pull changed since is not applied (#651). Kept on the device too, so a restart does not lose them. */
  const unsaved = useRef<KeptEdit[]>([]);
  /** True while the kept edits are written down in the device store. */
  const persisted = useRef(false);
  /** False once this provider is gone (sign-out or wipe remounts it): its queued saves must not write for an account that is no longer here (#645). */
  const mounted = useRef(true);
  /** The wipe count when this provider started: a save finding another one belongs to a wiped account. */
  const epoch = useRef(storeEpoch());
  const stale = () => !mounted.current || storeEpoch() !== epoch.current;
  const booted = useRef(false);
  if (!booted.current) {
    booted.current = true;
    // First in the queue: no save or reload runs before the edits kept from an earlier run are known.
    queue.current = readKept(db).then((k) => {
      unsaved.current = [...k, ...unsaved.current];
      persisted.current = k.length > 0;
    });
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      // Local edits still being written land first, so a reload never reads around them. An edit made while the
      // read was running is newer than what was read (and its save may not have landed yet): read again after it.
      let s: Settings | null;
      for (;;) {
        const seen = writes.current;
        await queue.current;
        s = await loadSettings(db);
        if (!live) return;
        if (seen === writes.current) break;
      }
      // Always set, also to none: after a wipe the store is empty and the previous user's custom exercises must go (#448).
      // Edits whose write failed show on top of the record (the next save writes them): the screen does not drop what is kept.
      if (s) {
        const before = persisted.current ? keptCopy(unsaved.current) : null;
        s = replayKept(s, unsaved.current);
        // A field a pull changed was dropped from the kept edits: the saved copy drops it too, or a restart would read it again.
        if (before !== null && keptCopy(unsaved.current) !== before) {
          // On the queue, like the saves: one that ran meanwhile has already cleared the kept edits, and this does not write them back.
          queue.current = queue.current.then(() =>
            inTransaction(db, async (txn) => {
              if (stale()) throw new Dropped();
              if (persisted.current) await persistKept(txn, unsaved.current);
            }).catch(() => undefined),
          );
          await queue.current;
          if (!live) return;
        }
      }
      setCustomTags(s?.custom_tags ?? {}); // before the render that reads the catalog
      if (s) {
        ref.current = s;
        setState(s);
      }
      setReady(true);
    })().catch(() => {
      if (!live) return;
      setCustomTags({}); // the record could not be read: no custom exercises rather than someone else's
      blocked.current = true;
      setLoadFailed(true);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [db, reloadKey]);

  const change = useCallback(
    (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>), done?: (stored: boolean) => void): boolean => {
      if (blocked.current) return false;
      const at = stamp(new Date());
      const apply = (s: Settings): Settings => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch), updated_at: at });
      // The edit shows at once. Its save applies it, once, to the record in the store, not to this copy: a pull may
      // have replaced the record since (a field another device changed must not be reverted and uploaded, #614).
      const next = apply(ref.current);
      ref.current = next;
      writes.current += 1;
      pending.current += 1;
      setCustomTags(next.custom_tags);
      setState(next);
      // A callback that throws must not reject the save queue: the next write would be skipped and reported as failed.
      const tell = (ok: boolean) => {
        try {
          done?.(ok);
        } catch (e) {
          // Reported outside the save queue, so the dev error screen and Sentry still see it.
          setTimeout(() => {
            throw e;
          });
        }
      };
      queue.current = queue.current
        .then(async () => {
          if (stale()) throw new Dropped();
          unsaved.current.push({ f: apply, at });
          // Read, apply and write in one transaction: a pull cannot store the other device's record in between
          // (this save would then write the older record back, with its old version). A pull that comes after
          // finds this save queued and leaves the record for the next push to settle.
          let saved!: Settings;
          await inTransaction(db, async (txn) => {
            const stored = (await loadSettings(txn)) ?? defaultSettings(at);
            // Checked here, with the write lock held and after the read: a wipe or sign-out that ran meanwhile has already
            // committed, and nothing of this save may land for the old account (nor reach the outbox through the triggers).
            if (stale()) throw new Dropped();
            saved = replayKept(stored, unsaved.current);
            await saveSettings(txn, saved);
            if (persisted.current) await clearKept(txn);
          });
          unsaved.current = [];
          persisted.current = false;
          return saved;
        })
        .then(
          (saved) => {
            tell(true); // told also when this provider has gone: the record was written
            if (!mounted.current) return;
            setSaveFailed(false);
            pending.current -= 1;
            // The last of the queued edits has landed: what shows is what is stored (it keeps the pulled fields and version).
            if (pending.current === 0) {
              ref.current = saved;
              setCustomTags(saved.custom_tags);
              setState(saved);
            }
          },
          async (e) => {
            // The account is gone: nothing to show, keep or write; the caller is told nothing was stored.
            if (e instanceof Dropped) return tell(false);
            pending.current -= 1;
            setSaveFailed(true);
            tell(false);
            // Written down so an app restart does not lose them; if this fails too they stay in memory.
            // With the lock held, and not for an account that a sign-out or wipe has meanwhile removed: that wipe took the lock
            // first and deleted the kept edits, so writing them now would hand them to the next account (#645).
            await inTransaction(db, async (txn) => {
              if (stale()) throw new Dropped();
              await persistKept(txn, unsaved.current);
            })
              .then(() => void (persisted.current = true))
              .catch(() => undefined);
          },
        );
      return true;
    },
    [db],
  );
  const setFocus = useCallback((focus: readonly string[]) => change({ focus: [...focus] }), [change]);
  const setRestOff = useCallback((rest_off: boolean) => change({ rest_off }), [change]);

  const setFlex = useCallback((flex: readonly FlexEntry[]) => change({ flex: [...flex] }), [change]);

  const setDiet = useCallback((diet: Settings['diet']) => change({ diet }), [change]);

  const setMealPlan = useCallback((meal_plan: MealPlan) => change({ meal_plan }), [change]);

  const addCustomTags = useCallback(
    (name: string, tags: ExerciseTag): Promise<boolean> => {
      // Refused at once against what is shown, and again inside the save against the record re-read there: a pull may have
      // stored a name this copy does not have yet (#664), and the save is where the record is known. The caller waits for
      // that decision, so a refused name is not added to the workout either.
      if (customRefused(ref.current.custom_tags, name)) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        let refused = false;
        const queued = change(
          (s) => {
            if (!customRefused(s.custom_tags, name)) return { custom_tags: { ...s.custom_tags, [name]: tags } };
            refused = true;
            return {};
          },
          // Not stored is a refusal, a write that failed (accepted all the same, as offline) or a save dropped with its account (not accepted).
          (stored) => resolve(!refused && (stored || !stale())),
        );
        if (!queued) resolve(false);
      });
    },
    [change],
  );

  const value = useMemo(() => ({ ready, settings, saveFailed, loadFailed, setFocus, setRestOff, setFlex, setDiet, setMealPlan, addCustomTags, update: change }), [ready, settings, saveFailed, loadFailed, setFocus, setRestOff, setFlex, setDiet, setMealPlan, addCustomTags, change]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings needs a SettingsProvider');
  return v;
}

/** Like `useSettings`, but null outside a provider: a card sheet opened where settings are not available just skips read tracking. */
export function useOptionalSettings(): SettingsState | null {
  return useContext(Ctx);
}
