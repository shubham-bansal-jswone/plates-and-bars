import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings } from '../db/settings';
import type { StoreDb } from '../db/records';
import { defaultSettings, type Settings } from '../settings/types';

interface SettingsState {
  ready: boolean;
  settings: Settings;
  /** True after a write to SQLite failed; cleared by the next successful write. */
  saveFailed: boolean;
  /** Replaces the focus muscles. The caller (the Targets screen, with core's rules) decides what is allowed. */
  setFocus(focus: readonly string[]): void;
  setRestOff(off: boolean): void;
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
    })().catch(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [db]);

  const change = useCallback(
    (patch: Partial<Settings>) => {
      const next = { ...ref.current, ...patch, updated_at: stamp(new Date()) };
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

  const value = useMemo(() => ({ ready, settings, saveFailed, setFocus, setRestOff }), [ready, settings, saveFailed, setFocus, setRestOff]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings needs a SettingsProvider');
  return v;
}
