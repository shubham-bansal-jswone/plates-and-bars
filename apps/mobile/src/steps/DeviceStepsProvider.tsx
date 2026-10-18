import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { localDate } from '../setup/logic';
import type { PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';
import { storeEpoch } from '../db/storeEpoch';
import { STEPS_COPY } from './copy';
import { deviceStepsSupported, readStepCounter, requestStepPermission, stepPermissionGranted, stepSensorPresent } from './sensor';
import { loadStepsOn, saveStepsOn, syncDeviceSteps } from './store';

export type TurnOnResult = 'on' | 'no-sensor' | 'denied';

interface Value {
  /** This build can use a step sensor (Android with the module). False on web, iOS and Expo Go: the section is hidden. */
  supported: boolean;
  on: boolean;
  /** On, but the permission was taken away in the phone's settings. */
  permissionLost: boolean;
  /** Bumps when a reading changed a day note; screens add it to their reload key. */
  version: number;
  turnOn: () => Promise<TurnOnResult>;
  turnOff: () => Promise<void>;
}

const Ctx = createContext<Value | null>(null);

/** 0 without a provider (jest, web). */
export const useStepsVersion = (): number => useContext(Ctx)?.version ?? 0;
/** Null outside a provider (jest, a local-only build): the section hides itself. */
export const useDeviceSteps = (): Value | null => useContext(Ctx);

/** How often the running app checks whether the local day changed (a one-minute interval, not one long timer to midnight). */
const DAY_CHECK_MS = 60_000;

const realNow = (): Date => new Date();

interface Props {
  db: StoreDb & PullDb;
  children: ReactNode;
  /** Clock, injectable for tests (keep it the same function between renders). */
  now?: () => Date;
}

/**
 * Device steps (#300). The toggle is off by default and kept on this device. While on, a reading of the phone's step counter is taken when
 * the app opens, when it returns to the foreground and when the local day changes while it runs (no background task); each one goes through core's
 * `advanceSteps` and is written with `steps_source: 'device'`. Readings never block the UI: they run in the background of the screen and
 * a failure is silent (the manual boxes are always there).
 */
export function DeviceStepsProvider({ db, children, now = realNow }: Props) {
  const supported = useMemo(() => deviceStepsSupported(), []);
  const [on, setOn] = useState(false);
  const [permissionLost, setPermissionLost] = useState(false);
  const [version, setVersion] = useState(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  // Writes of this provider run one after another, and a turn-off drops any reading still waiting.
  const gen = useRef(0);
  // A wipe remounts this provider (it sits under the stores keyed by the sync epoch); a reading still in flight then drops its write.
  useEffect(() => () => void gen.current++, []);

  const read = useCallback(() => {
    const mine = gen.current;
    chain.current = chain.current
      .then(async () => {
        if (mine !== gen.current) return;
        if (!(await stepPermissionGranted())) return void setPermissionLost(true);
        setPermissionLost(false);
        const d = now();
        const epoch = storeEpoch();
        const stale = () => mine !== gen.current || storeEpoch() !== epoch; // turned off, unmounted or the store wiped since this reading started
        const changed = await syncDeviceSteps(
          db,
          async () => {
            const r = await readStepCounter();
            return stale() ? null : r;
          },
          { today: localDate(d), msSinceMidnight: d.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), stamp: d.toISOString().replace(/\.\d{3}Z$/, 'Z') },
          stale,
        );
        if (changed && !stale()) setVersion((n) => n + 1);
      })
      .catch(() => undefined);
    return chain.current;
  }, [db, now]);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    loadStepsOn(db)
      .then((v) => live && setOn(v))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [db, supported]);

  useEffect(() => {
    if (!supported || !on) return;
    void read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void read());
    let day = localDate(now());
    const timer = setInterval(() => {
      const today = localDate(now());
      if (today === day) return;
      day = today;
      void read();
    }, DAY_CHECK_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [supported, on, read, now]);

  const turnOn = useCallback(async (): Promise<TurnOnResult> => {
    if (!(await stepSensorPresent())) return 'no-sensor';
    if (!(await requestStepPermission(STEPS_COPY.rationale))) return 'denied';
    await saveStepsOn(db, true);
    gen.current++;
    setPermissionLost(false);
    setOn(true);
    return 'on';
  }, [db]);

  const turnOff = useCallback(async () => {
    gen.current++;
    setOn(false);
    setPermissionLost(false);
    await saveStepsOn(db, false);
  }, [db]);

  const value = useMemo(() => ({ supported, on, permissionLost, version, turnOn, turnOff }), [supported, on, permissionLost, version, turnOn, turnOff]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
