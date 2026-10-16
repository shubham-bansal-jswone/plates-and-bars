import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings } from '../db/settings';
import type { StoreDb } from '../db/records';
import { CUSTOM_EXERCISES_MAX, type ExerciseTag, type FlexEntry, type MealPlan } from '@plate-and-bar/core';
import { defaultSettings, type Settings } from '../settings/types';
import { setCustomTags } from '../workout/catalog';

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
  /** Saves a custom exercise's tags (prototype `tg-save`); false when the record cannot be written or the limit is reached. */
  addCustomTags(name: string, tags: ExerciseTag): boolean;
  /** Merges a change into the record (the Progress check-in's adjustments and real-burn state). */
  update(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): boolean;
}

const Ctx = createContext<SettingsState | null>(null);
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Holds the local Settings record. A change shows at once and its write is queued (FIFO, each write reads
 * the latest state when it runs), so nothing waits on the network or on an earlier write.
 */
export function SettingsProvider({ db, reloadKey = 0, children }: { db: StoreDb; /** Changes when records were pulled from the server: the settings are read again (after pending local writes). */ reloadKey?: number; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const blocked = useRef(false);
  const [settings, setState] = useState<Settings>(() => defaultSettings(stamp(new Date())));
  const ref = useRef(settings);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Counts local changes, so a reload can tell that one started while it was reading (#597). */
  const writes = useRef(0);
  /** Number of reloads reading now. A change made meanwhile is applied to the stored record, not saved over it (#614). */
  const reloading = useRef(0);

  useEffect(() => {
    let live = true;
    reloading.current += 1;
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
      setCustomTags(s?.custom_tags ?? {}); // before the render that reads the catalog
      if (s) {
        ref.current = s;
        setState(s);
      }
      setReady(true);
    })()
      .catch(() => {
        if (!live) return;
        setCustomTags({}); // the record could not be read: no custom exercises rather than someone else's
        blocked.current = true;
        setLoadFailed(true);
        setReady(true);
      })
      .finally(() => void (reloading.current -= 1));
    return () => {
      live = false;
    };
  }, [db, reloadKey]);

  const change = useCallback(
    (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): boolean => {
      if (blocked.current) return false;
      const at = stamp(new Date());
      const apply = (s: Settings): Settings => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch), updated_at: at });
      const next = apply(ref.current);
      // While a reload reads, the in-memory copy may be older than the stored record (a pull just replaced it):
      // apply the edit on top of what is stored, so a field another device changed is not reverted and uploaded (#614).
      const onStored = reloading.current > 0;
      ref.current = next;
      writes.current += 1;
      setCustomTags(next.custom_tags);
      setState(next);
      queue.current = queue.current
        .then(async () => {
          const stored = onStored ? await loadSettings(db) : null;
          await saveSettings(db, stored ? apply(stored) : ref.current);
        })
        .then(() => setSaveFailed(false))
        .catch(() => setSaveFailed(true));
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
    (name: string, tags: ExerciseTag) => {
      const have = ref.current.custom_tags;
      // The contract keeps at most 500 custom exercises; replacing one already there is always fine.
      if (!Object.prototype.hasOwnProperty.call(have, name) && Object.keys(have).length >= CUSTOM_EXERCISES_MAX) return false;
      return change((s) => ({ custom_tags: { ...s.custom_tags, [name]: tags } }));
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
