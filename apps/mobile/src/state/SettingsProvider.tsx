import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings } from '../db/settings';
import type { StoreDb } from '../db/records';
import type { FlexEntry } from '@plate-and-bar/core';
import { defaultSettings, type Settings } from '../settings/types';

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
  /** Merges a change into the record (the Progress check-in's adjustments and real-burn state). */
  update(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): void;
}

const Ctx = createContext<SettingsState | null>(null);
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Holds the local Settings record. A change shows at once and its write is queued (FIFO, each write reads
 * the latest state when it runs), so nothing waits on the network or on an earlier write.
 */
export function SettingsProvider({ db, children }: { db: StoreDb; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const blocked = useRef(false);
  const [settings, setState] = useState<Settings>(() => defaultSettings(stamp(new Date())));
  const ref = useRef(settings);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    (async () => {
      const s = await loadSettings(db);
      if (!live) return;
      if (s) {
        ref.current = s;
        setState(s);
      }
      setReady(true);
    })().catch(() => {
      if (!live) return;
      blocked.current = true;
      setLoadFailed(true);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [db]);

  const change = useCallback(
    (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => {
      if (blocked.current) return;
      const next = { ...ref.current, ...(typeof patch === 'function' ? patch(ref.current) : patch), updated_at: stamp(new Date()) };
      ref.current = next;
      setState(next);
      queue.current = queue.current
        .then(() => saveSettings(db, ref.current))
        .then(() => setSaveFailed(false))
        .catch(() => setSaveFailed(true));
    },
    [db],
  );
  const setFocus = useCallback((focus: readonly string[]) => change({ focus: [...focus] }), [change]);
  const setRestOff = useCallback((rest_off: boolean) => change({ rest_off }), [change]);

  const setFlex = useCallback((flex: readonly FlexEntry[]) => change({ flex: [...flex] }), [change]);

  const value = useMemo(() => ({ ready, settings, saveFailed, loadFailed, setFocus, setRestOff, setFlex, update: change }), [ready, settings, saveFailed, loadFailed, setFocus, setRestOff, setFlex, change]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings needs a SettingsProvider');
  return v;
}
