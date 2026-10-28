import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_WEIGHT_UNIT, type WeightUnit } from '@plate-and-bar/core';
import type { StoreDb } from '../db/records';
import { KEY_WEIGHT_UNIT, getKv, setKv } from '../sync/store';

/** A stored value read as a unit: anything but `lb` is the default, so a damaged row never breaks a screen. */
export const parseWeightUnit = (raw: string | null): WeightUnit => (raw === 'lb' ? 'lb' : DEFAULT_WEIGHT_UNIT);

export async function loadWeightUnit(db: StoreDb): Promise<WeightUnit> {
  return parseWeightUnit(await getKv(db, KEY_WEIGHT_UNIT));
}

export async function saveWeightUnit(db: StoreDb, unit: WeightUnit): Promise<void> {
  await setKv(db, KEY_WEIGHT_UNIT, unit);
}

interface Value {
  unit: WeightUnit;
  /** Shows at once; the write to SQLite follows and never waits on the network. Weights stay kg in storage. */
  setUnit: (unit: WeightUnit) => void;
}

const Ctx = createContext<Value | null>(null);

/** The weight unit for display and typing. kg without a provider (jest, a screen rendered alone). */
export function useWeightUnit(): Value {
  return useContext(Ctx) ?? { unit: DEFAULT_WEIGHT_UNIT, setUnit: () => undefined };
}

/** Holds the device-local weight unit (#1185): read once from the key/value table, kg until it is read or when none is saved. */
export function WeightUnitProvider({ db, children }: { db: StoreDb; children: ReactNode }) {
  const [unit, setUnitState] = useState<WeightUnit>(DEFAULT_WEIGHT_UNIT);
  const touched = useRef(false); // a choice made before the read finished wins over it
  useEffect(() => {
    let live = true;
    loadWeightUnit(db)
      .then((u) => live && setUnitState((cur) => (touched.current ? cur : u)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [db]);
  const setUnit = useCallback(
    (next: WeightUnit) => {
      touched.current = true;
      setUnitState(next);
      void saveWeightUnit(db, next).catch(() => undefined);
    },
    [db],
  );
  const value = useMemo(() => ({ unit, setUnit }), [unit, setUnit]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
