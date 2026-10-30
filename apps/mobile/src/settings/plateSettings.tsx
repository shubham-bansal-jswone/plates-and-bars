import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_BAR, DEFAULT_PLATES, type WeightUnit } from '@plate-and-bar/core';
import type { StoreDb } from '../db/records';
import { KEY_PLATES, getKv, setKv } from '../sync/store';

/** Bar weight and the plates the gym has, in the unit's own numbers (45 lb is 45, not 20.4). */
export interface UnitPlates {
  bar: number;
  plates: readonly number[];
}
export type PlateSettings = Record<WeightUnit, UnitPlates>;

export const defaultPlateSettings = (): PlateSettings => ({
  kg: { bar: DEFAULT_BAR.kg, plates: DEFAULT_PLATES.kg },
  lb: { bar: DEFAULT_BAR.lb, plates: DEFAULT_PLATES.lb },
});

/** Bar weights the store accepts back (and the sheet accepts typed): a plain number from 0 to 1000. */
export const BAR_MAX = 1000;
const sane = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= BAR_MAX;

/** A stored value read back: anything damaged falls back to that unit's defaults, so a bad row never breaks the sheet. */
export function parsePlateSettings(raw: string | null): PlateSettings {
  const out = defaultPlateSettings();
  if (!raw) return out;
  try {
    const j = JSON.parse(raw) as Partial<Record<WeightUnit, Partial<UnitPlates>>>;
    for (const u of ['kg', 'lb'] as const) {
      const e = j?.[u];
      if (e && sane(e.bar) && Array.isArray(e.plates) && e.plates.every((p) => sane(p) && p > 0)) out[u] = { bar: e.bar, plates: e.plates };
    }
  } catch {
    // damaged: defaults
  }
  return out;
}

export async function loadPlateSettings(db: StoreDb): Promise<PlateSettings> {
  return parsePlateSettings(await getKv(db, KEY_PLATES));
}

interface Value {
  settings: PlateSettings;
  /** Shows at once; the write to SQLite follows and never waits on the network. */
  set: (unit: WeightUnit, next: UnitPlates) => void;
}

const Ctx = createContext<Value | null>(null);

/** The plate calculator's bar and plates. Core's defaults without a provider (jest, a sheet rendered alone); changes then only last while mounted. */
export function usePlateSettings(): Value {
  const own = useContext(Ctx);
  const [local, setLocal] = useState<PlateSettings>(defaultPlateSettings);
  const setOwn = useCallback((unit: WeightUnit, next: UnitPlates) => setLocal((cur) => ({ ...cur, [unit]: next })), []);
  return own ?? { settings: local, set: setOwn };
}

/** Holds the device-local plate settings (#1176): read once from the key/value table, defaults until read. */
export function PlateSettingsProvider({ db, children }: { db: StoreDb; children: ReactNode }) {
  const [settings, setSettings] = useState<PlateSettings>(defaultPlateSettings);
  const touched = useRef(false); // an edit made before the read finished wins over it
  const latest = useRef(settings);
  useEffect(() => {
    let live = true;
    loadPlateSettings(db)
      .then((s) => {
        if (live && !touched.current) {
          latest.current = s;
          setSettings(s);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [db]);
  const set = useCallback(
    (unit: WeightUnit, next: UnitPlates) => {
      touched.current = true;
      const all = { ...latest.current, [unit]: next };
      latest.current = all;
      setSettings(all);
      void setKv(db, KEY_PLATES, JSON.stringify(all)).catch(() => undefined);
    },
    [db],
  );
  const value = useMemo(() => ({ settings, set }), [settings, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
