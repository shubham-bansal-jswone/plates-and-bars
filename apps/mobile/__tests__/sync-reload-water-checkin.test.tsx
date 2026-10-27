import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveProfile } from '../src/db/records';
import { saveSet, saveWorkout } from '../src/db/workouts';
import { saveWaterLog } from '../src/food/waterDb';
import { useWater } from '../src/food/useWater';
import { dayQueue } from '../src/workout/dayQueue';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';
import { openDb, turns } from './sync-helpers';

// Never a focus event: every update below has to come from the sync reload (dataVersion) alone.
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const notify = jest.fn();
const meta = { version: 1, updated_at: '2026-10-08T06:00:00Z', deleted_at: null };
const drink = (id: string, ml: number, at: string) => ({ id, ...meta, updated_at: at, date: DATE, ml });
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const wk = { id: null, version: 0, updated_at: 'x', deleted_at: null, date: DATE, template: 'Push B', base: 'Push B', where: null, cardio_min: null, mods: {}, exercises: [{ name: 'Barbell Bench Press', part: 1 as const, bridge: false, form: null, found_kg: null, skip_ramp: false }], ci_choice: null };
const done = (id: string) => ({ id, ...meta, workout_id: null, exercise: 'Barbell Bench Press', kind: 'work' as const, set_index: 0, weight_kg: 40, reps: 8, done: true, rate: null, t: null });
const at = (dataVersion: number, ui: React.ReactNode) => <SyncContext.Provider value={{ dataVersion } as SyncState}>{ui}</SyncContext.Provider>;

type Db = Awaited<ReturnType<typeof openDb>>;

/** The next list read is held open once it has read its rows: that read straddles whatever the test does meanwhile. */
function gated(db: Db) {
  let markHit = () => {};
  let release = () => {};
  const g = { armed: false, hit: Promise.resolve(), arm() { g.armed = true; g.hit = new Promise<void>((r) => (markHit = r)); }, release: () => release() };
  const getAllAsync = async (...a: Parameters<Db['getAllAsync']>) => {
    const rows = await db.getAllAsync(...a);
    if (!g.armed) return rows;
    g.armed = false;
    const hold = new Promise<void>((r) => (release = r));
    markHit();
    await hold;
    return rows;
  };
  return { g, db: Object.assign(Object.create(db) as Db, { getAllAsync }) };
}

describe('water reloads after a sync pull, without a focus event (#293)', () => {
  it('shows a drink pulled from another device', async () => {
    const db = await openDb();
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useWater({ db, date: DATE, now: NOW, profile, notify, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.target).not.toBeNull());
    expect(result.current.ml).toBe(0);
    await saveWaterLog(db, drink('pulled', 500, '2026-10-08T07:00:00Z'));
    await rerender({ k: 1 });
    await waitFor(() => expect(result.current.ml).toBe(500));
  });

  it('keeps a drink tapped while the reload is reading (the older read does not drop it)', async () => {
    const real = await openDb();
    const { g, db } = gated(real);
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useWater({ db, date: DATE, now: NOW, profile, notify, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.target).not.toBeNull());
    await saveWaterLog(real, drink('pulled', 500, '2026-10-08T07:00:00Z'));
    g.arm();
    await rerender({ k: 1 });
    await g.hit;
    await act(async () => result.current.add(250));
    g.release();
    await waitFor(() => expect(result.current.ml).toBe(750));
    await act(async () => turns()); // the held read lands
    expect(result.current.ml).toBe(750);
    expect(await real.getAllAsync('SELECT key FROM water_logs')).toHaveLength(2);
  });

  it('a drink undone on the device is not brought back by the reload that waits for its write', async () => {
    const real = await openDb();
    // Writes wait for `open` once it is armed, so the undo is still unwritten when the reload starts reading.
    let hold: Promise<void> | null = null;
    let open!: () => void;
    const slow = Object.assign(Object.create(real) as Db, {
      runAsync: async (...a: Parameters<Db['runAsync']>) => {
        await hold;
        return real.runAsync(...a);
      },
    });
    await saveWaterLog(real, drink('d1', 250, '2026-10-08T07:00:00Z'));
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useWater({ db: slow, date: DATE, now: NOW, profile, notify, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.ml).toBe(250));
    hold = new Promise<void>((r) => (open = r));
    await act(async () => result.current.undo());
    await rerender({ k: 1 }); // the reload starts and waits for the queued write
    await act(async () => open());
    await waitFor(async () => expect(await real.getAllAsync('SELECT key FROM water_logs WHERE data LIKE \'%"deleted_at":"%\'')).toHaveLength(1));
    await act(async () => turns()); // the reload reads now
    expect(result.current.ml).toBe(0);
  });

  it('the target follows a set that a pull marked done', async () => {
    const db = await openDb();
    const sunday = () => new Date(2026, 9, 11, 10, 0, 0); // nothing planned: only a done set raises the target
    const day = '2026-10-11';
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useWater({ db, date: day, now: sunday, profile, notify, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.target).not.toBeNull());
    expect(result.current.target?.trained).toBe(false);
    await saveWorkout(db, { ...wk, date: day });
    await saveSet(db, day, done('s1'));
    await rerender({ k: 1 });
    await waitFor(() => expect(result.current.target?.trained).toBe(true));
  });
});

describe('check-in and coverage reload after a sync pull, without a focus event (#293)', () => {
  it('the check-in counts a session that arrived', async () => {
    const db = memoryDb();
    await saveProfile(db, profile);
    const ui = (k: number) => at(k, withProfile(db, <ProgressScreen db={db} now={NOW} />));
    const view = await render(ui(0));
    expect(await screen.findByLabelText(/^sessions: 0 \/ \d+$/)).toBeTruthy();
    await saveWorkout(db, { ...wk, cardio_min: 30 });
    await saveSet(db, DATE, done('s1'));
    await view.rerender(ui(1));
    expect(await screen.findByLabelText(/^sessions: 1 \/ \d+$/)).toBeTruthy();
  });

  it('the check-in waits for a queued workout write before it reads', async () => {
    const db = memoryDb();
    await saveProfile(db, profile);
    const ui = (k: number) => at(k, withProfile(db, <ProgressScreen db={db} now={NOW} />));
    const view = await render(ui(0));
    expect(await screen.findByLabelText(/^sessions: 0 \/ \d+$/)).toBeTruthy();
    let release = () => {};
    dayQueue.current = dayQueue.current.then(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    await saveWorkout(db, { ...wk });
    await view.rerender(ui(1));
    await act(async () => turns()); // the reload is waiting on the queue
    await saveSet(db, DATE, done('s1')); // lands "while the queued write runs"
    release();
    expect(await screen.findByLabelText(/^sessions: 1 \/ \d+$/)).toBeTruthy();
  });

  it('the coverage meters show sets that arrived', async () => {
    const db = memoryDb();
    await saveProfile(db, profile);
    const ui = (k: number) => at(k, withProfile(db, <TargetsScreen db={db} now={() => new Date(2026, 9, 8)} />));
    const view = await render(ui(0));
    expect(await screen.findByLabelText(/^Done in the last 7 days, Chest: 0 sets/)).toBeTruthy();
    db.rows.set(`workouts:${DATE}`, JSON.stringify(wk));
    for (let j = 0; j < 3; j++) db.sets.set(`s${j}`, { date: DATE, kind: 'work', done: 1, deleted: 0, data: JSON.stringify({ exercise: 'Barbell Bench Press', kind: 'work', done: true, deleted_at: null }) });
    await view.rerender(ui(1));
    expect(await screen.findByLabelText(/^Done in the last 7 days, Chest: 3 sets/)).toBeTruthy();
  });
});
