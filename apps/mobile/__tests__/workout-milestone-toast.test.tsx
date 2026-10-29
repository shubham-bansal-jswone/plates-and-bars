import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { loadSets, loadWorkout, saveLift, saveSet, saveWorkout, type WorkoutDb } from '../src/db/workouts';
import * as workoutsDb from '../src/db/workouts';
import * as progressDb from '../src/db/progress';
import { dayQueue, dayWrites } from '../src/workout/dayQueue';
import { CompletionPanel } from '../src/workout/CompletionPanel';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import type { WorkoutSet } from '../src/workout/types';
import { parseShown } from '../src/progress/milestoneStore';
import { KEY_MILESTONES_SHOWN, getKv } from '../src/sync/store';
import { bumpStoreEpoch } from '../src/db/storeEpoch';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { openDb } from './sync-helpers';

jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const notify = jest.fn();
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
// Every lift is a barbell for these tests, whatever the library says, so the plate steps apply to exercise 0.
const OVER = { step_kg: 2.5, rep_low: 5, rep_high: 12 };

type Db = Awaited<ReturnType<typeof openDb>>;
const base = (db: Db) => ({ db, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), profile });
interface P { k: number; date?: string }
const hookOf = (db: Db, unit: 'kg' | 'lb', name: string | null) => (p?: P) =>
  useWorkoutDay({ ...base(db), ...(p?.date ? { date: p.date } : {}), tune: { unit, overrides: name ? { [name]: { type: 'barbell', ...OVER } } : {} }, reloadKey: p?.k ?? 0 } as unknown as Parameters<typeof useWorkoutDay>[0]);

/** The first exercise's name is only known once a session has started, so the name is found on a first pass, then the hook is mounted again with its override. */
async function started(unit: 'kg' | 'lb' = 'kg', before?: (db: Db, name: string) => Promise<void>) {
  const db = await openDb();
  const probe = await renderHook(hookOf(db, unit, null));
  await waitFor(() => expect(probe.result.current.day.ready).toBe(true));
  await act(async () => void (await probe.result.current.start('Upper A', {}, null)));
  await waitFor(async () => expect((await loadSets(db, DATE)).length).toBeGreaterThan(0));
  await act(async () => void (await dayQueue.current));
  const name = probe.result.current.day.exs[0]!.name;
  await probe.unmount();
  await db.runAsync('DELETE FROM settings WHERE key = ?', KEY_MILESTONES_SHOWN); // the probe seeded an empty set: this device is on its first run again
  // Old history is stored after the session exists but before the hook that seeds is mounted; the key is still unset.
  await before?.(db, name);
  const view = await renderHook(hookOf(db, unit, name), { initialProps: { k: 0 } as P });
  await waitFor(() => expect(view.result.current.day.ready).toBe(true));
  await act(async () => void (await dayQueue.current));
  notify.mockClear();
  return { db, name, ...view };
}

async function seedDay(db: Db, name: string, date: string, sets: [number, number][]) {
  const w = (await loadWorkout(db, DATE))!;
  await saveWorkout(db, { ...w, date, id: `w-${date}` } as typeof w);
  let i = 0;
  for (const [kg, reps] of sets) {
    const s: WorkoutSet = { id: `${date}-${name}-${i}`, version: 0, updated_at: `${date}T09:00:00Z`, deleted_at: null, workout_id: null, exercise: name, kind: 'work', set_index: i++, weight_kg: kg, reps, done: true, rate: null, t: null };
    await saveSet(db, date, s);
  }
}

/** The milestone step runs off the day queue: let it settle. */
type Hook = Awaited<ReturnType<typeof started>>['result'];
const settle = (result: Hook) => act(async () => void (await result.current.msSettled()));
const tickSet = async (result: Hook, j: number, w: string, r: string) => {
  await act(async () => result.current.editSet(0, 'work', j, 'w', w));
  await act(async () => result.current.editSet(0, 'work', j, 'r', r));
  await act(async () => result.current.tick(0, j));
  await act(async () => void (await dayQueue.current));
  await settle(result);
};
const untick = async (result: Hook, j: number) => {
  await act(async () => result.current.tick(0, j));
  await act(async () => void (await dayQueue.current));
  await settle(result);
};
const msToasts = () => notify.mock.calls.map(([m]) => String(m)).filter((m) => m.startsWith('Milestone:'));
const prToasts = () => notify.mock.calls.map(([m]) => String(m)).filter((m) => m.startsWith('New personal best'));
const shown = async (db: WorkoutDb) => parseShown(await getKv(db, KEY_MILESTONES_SHOWN));

describe('the quiet milestone toast (#1351 A9)', () => {
  it('first run marks the milestones already earned as shown, so old history never toasts', async () => {
    const { db, name, result } = await started('kg', (d, n) => seedDay(d, n, '2026-09-01', [[130, 5]])); // an old best of about 151 kg: nothing today is a personal best
    expect([...(await shown(db))!].sort()).toEqual(['plates-1', 'plates-2']);
    await tickSet(result, 0, '100', '5');
    expect(msToasts()).toEqual([]);
    expect(result.current.earned).toEqual([]);
    await tickSet(result, 1, '140', '1'); // a genuinely new one
    expect(msToasts()).toEqual([`Milestone: Three plates a side, ${name}, 140 kg`]);
    expect([...(await shown(db))!].sort()).toEqual(['plates-1', 'plates-2', 'plates-3']);
  });

  it('a new milestone toasts once, with title and detail, and not again after a remount', async () => {
    const { db, name, result, unmount } = await started();
    await tickSet(result, 0, '60', '5');
    expect(msToasts()).toEqual([`Milestone: One plate a side, ${name}, 60 kg`]);
    expect(result.current.earned.map((m) => m.id)).toEqual(['plates-1']);
    await unmount();
    notify.mockClear();
    const again = await renderHook(hookOf(db, 'kg', name));
    await waitFor(() => expect(again.result.current.day.ready).toBe(true));
    await tickSet(again.result, 1, '60', '5');
    expect(msToasts()).toEqual([]);
    expect(again.result.current.earned).toEqual([]);
  });

  it('an untick earns and un-shows nothing, and a retick does not toast again', async () => {
    const { db, result } = await started();
    await tickSet(result, 0, '60', '5');
    expect(msToasts()).toHaveLength(1);
    await untick(result, 0);
    expect(await shown(db)).toEqual(new Set(['plates-1']));
    expect(result.current.earned.map((m) => m.id)).toEqual(['plates-1']);
    await untick(result, 0); // retick
    expect(msToasts()).toHaveLength(1);
  });

  it('at most one toast per tick: two new on one date toast the higher step, and both are listed', async () => {
    const { db, name, result } = await started();
    await tickSet(result, 0, '100', '5'); // one and two plates a side on the same day
    expect(msToasts()).toEqual([`Milestone: Two plates a side, ${name}, 100 kg`]);
    expect(result.current.earned.map((m) => m.id).sort()).toEqual(['plates-1', 'plates-2']);
    expect([...(await shown(db))!].sort()).toEqual(['plates-1', 'plates-2']);
  });

  it('the personal-best toast wins the tick, the milestone goes to the completion panel', async () => {
    const { name, result } = await started('kg', async (d, n) => {
      await seedDay(d, n, '2026-09-01', [[40, 5]]);
      await seedDay(d, n, '2026-09-20', [[50, 5]]);
      await saveLift(d, n, { date: '2026-09-20', sets: [{ w: 50, r: 5, rate: null }], form: null, n: 3, first: '2026-09-01', prev: null, hist: [{ date: '2026-09-20', e: 58 }] });
    });
    await tickSet(result, 0, '60', '5');
    expect(prToasts()).toHaveLength(1);
    expect(msToasts()).toEqual([]);
    expect(result.current.earned.map((m) => m.id)).toEqual(['plates-1']);
    const ex = result.current.day.exs[0]!;
    await render(<CompletionPanel db={{} as WorkoutDb} date={DATE} profileKg={82} earned={result.current.earned} exs={[{ ...ex, sets: ex.sets.map((x) => ({ ...x, done: true })) }]} cardio={null} prs={result.current.prs} reloadKey={0} />);
    expect(screen.getByLabelText(`Milestone: One plate a side, ${name}, 60 kg`)).toBeTruthy();
  });

  it('says it in pounds for a pound user, without 45 lb plates', async () => {
    const { name, result } = await started('lb');
    await tickSet(result, 0, '60', '5');
    expect(msToasts()).toEqual([`Milestone: One plate a side, ${name}, 132.3 lb`]);
  });

  it('a pull after a fresh sign-in is seeded silently: no toast for old milestones, and the panel stays empty', async () => {
    const { db, name, result, rerender } = await started(); // empty store: seeded with nothing
    await seedDay(db, name, '2026-09-01', [[130, 5]]); // the pulled history
    await rerender({ k: 1 });
    await act(async () => void (await dayQueue.current));
    expect([...(await shown(db))!].sort()).toEqual(['plates-1', 'plates-2']);
    await tickSet(result, 0, '100', '5');
    expect(msToasts()).toEqual([]);
    expect(result.current.earned).toEqual([]);
  });

  it('history written by another screen after the first seed (an import) is seeded silently', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[130, 5]]);
    dayWrites.current++; // writeImport goes through the day queue counter
    await tickSet(result, 0, '100', '5');
    expect(msToasts()).toEqual([]);
    expect(result.current.earned).toEqual([]);
    await tickSet(result, 1, '140', '1'); // today's own new one still toasts
    expect(msToasts()).toEqual([`Milestone: Three plates a side, ${name}, 140 kg`]);
  });

  it('a tick reads no history: the all-history loaders are not called', async () => {
    const { result } = await started();
    const spies = [jest.spyOn(workoutsDb, 'loadDoneSets'), jest.spyOn(workoutsDb, 'loadSessionLog'), jest.spyOn(progressDb, 'loadWeights')];
    await tickSet(result, 0, '60', '5');
    expect(msToasts()).toHaveLength(1);
    for (const sp of spies) expect(sp).not.toHaveBeenCalled();
    spies.forEach((sp) => sp.mockRestore());
  });

  it('only a tick looks: a rate change on a set edited to a plate weight toasts nothing, the next tick does', async () => {
    const { result, name } = await started();
    await tickSet(result, 0, '50', '5');
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '60'));
    await act(async () => result.current.rate(0, 0, 'right'));
    await act(async () => void (await dayQueue.current));
    expect(msToasts()).toEqual([]);
    expect(result.current.earned).toEqual([]);
    await tickSet(result, 1, '60', '5');
    expect(msToasts()).toEqual([`Milestone: One plate a side, ${name}, 60 kg`]);
  });

  it('earned holds only the viewed date: another date shows none', async () => {
    const { result, rerender } = await started();
    await tickSet(result, 0, '60', '5');
    expect(result.current.earned).toHaveLength(1);
    await rerender({ k: 0, date: '2026-10-07' });
    expect(result.current.earned).toEqual([]);
  });

  it('a tick never waits on a history read: the queue finishes while the reload read is held, the toast follows', async () => {
    const { db, result, rerender } = await started();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const real = workoutsDb.loadDoneSets;
    const spy = jest.spyOn(workoutsDb, 'loadDoneSets').mockImplementation(async (...a) => {
      await gate;
      return real(...a);
    });
    await rerender({ k: 1 }); // a tab return starts a reload read, now held
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '60'));
    await act(async () => result.current.editSet(0, 'work', 0, 'r', '5'));
    await act(async () => result.current.tick(0, 0));
    await act(async () => void (await dayQueue.current)); // would hang if the tick waited on the read
    expect((await loadSets(db, DATE)).some((x) => x.done)).toBe(true);
    expect(msToasts()).toEqual([]);
    await act(async () => release());
    await settle(result);
    expect(msToasts()).toHaveLength(1);
    spy.mockRestore();
  });

  it('a day change while the milestone step waits drops it: no toast and no listing', async () => {
    const { result, rerender } = await started();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const real = workoutsDb.loadDoneSets;
    const spy = jest.spyOn(workoutsDb, 'loadDoneSets').mockImplementation(async (...a) => {
      await gate;
      return real(...a);
    });
    await rerender({ k: 1 });
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '60'));
    await act(async () => result.current.editSet(0, 'work', 0, 'r', '5'));
    await act(async () => result.current.tick(0, 0));
    await act(async () => void (await dayQueue.current));
    await rerender({ k: 1, date: '2026-10-07' });
    spy.mockRestore();
    await act(async () => release());
    await settle(result);
    expect(msToasts()).toEqual([]);
    expect(result.current.earned).toEqual([]);
  });

  it('the reload seed leaves the viewed day out: a qualifying set stored on it and not yet announced still toasts on the next tick', async () => {
    const { db, name, result, rerender } = await started();
    await seedDay(db, name, DATE, [[60, 5]]); // the day already holds a done plate set whose own tick has not been evaluated
    await rerender({ k: 1 });
    await settle(result);
    expect(await shown(db)).toEqual(new Set());
    await tickSet(result, 0, '60', '5');
    expect(msToasts()).toEqual([`Milestone: One plate a side, ${name}, 60 kg`]);
  });

  it('today counts in the session log: after 9 earlier sessions the first tick toasts the 10th workout', async () => {
    const { result } = await started('kg', async (d, n) => {
      for (let i = 1; i <= 9; i++) await seedDay(d, n, `2026-09-${String(i).padStart(2, '0')}`, [[20, 5]]);
    });
    await tickSet(result, 0, '20', '5');
    expect(msToasts()).toEqual(['Milestone: 10th workout, 10 workouts completed']);
  });

  /** Holds every all-history read until `release()`. */
  const hold = () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const real = workoutsDb.loadDoneSets;
    const spy = jest.spyOn(workoutsDb, 'loadDoneSets').mockImplementation(async (...a) => {
      await gate;
      return real(...a);
    });
    return { release: () => act(async () => release()), restore: () => spy.mockRestore() };
  };
  const edit = async (result: Hook, j: number, w: string, r: string) => {
    await act(async () => result.current.editSet(0, 'work', j, 'w', w));
    await act(async () => result.current.editSet(0, 'work', j, 'r', r));
    await act(async () => result.current.tick(0, j));
    await act(async () => void (await dayQueue.current));
  };

  it('a tick id written while a newer reload is in flight is not lost: the next tick does not announce it again', async () => {
    const { db, result, rerender } = await started();
    const h = hold();
    await rerender({ k: 1 }); // a reload read, held
    await edit(result, 0, '60', '5'); // its evaluation waits on that read
    await rerender({ k: 2 }); // another reload starts before the evaluation has written its id
    await h.release();
    await settle(result);
    h.restore();
    await tickSet(result, 1, '60', '5');
    expect(msToasts().map((m) => m.split(',')[0])).toEqual(['Milestone: One plate a side']);
    expect([...(await shown(db))!]).toEqual(['plates-1']);
  });

  it('a wipe during a pending evaluation writes and announces nothing, and the new account first milestone still toasts', async () => {
    const { db, name, result, rerender } = await started();
    const h = hold();
    await rerender({ k: 1 });
    await edit(result, 0, '60', '5'); // waits for the held read
    bumpStoreEpoch(); // sign-out wipe
    await db.runAsync('DELETE FROM settings WHERE key = ?', KEY_MILESTONES_SHOWN);
    await h.release();
    await settle(result);
    h.restore();
    expect(msToasts()).toEqual([]);
    expect(result.current.earned).toEqual([]);
    expect(await getKv(db, KEY_MILESTONES_SHOWN)).toBeNull(); // the old account's ids are not written into the new one
    await rerender({ k: 2 }); // the new account
    await settle(result);
    await tickSet(result, 1, '60', '5');
    expect(msToasts()).toEqual([`Milestone: One plate a side, ${name}, 60 kg`]);
  });

  it('a failed evaluation does not stop the later ones', async () => {
    const { name, result } = await started();
    notify.mockImplementationOnce(() => {
      throw new Error('toast failed');
    });
    await tickSet(result, 0, '60', '5'); // its toast throws
    notify.mockClear();
    await tickSet(result, 1, '100', '5');
    expect(msToasts()).toEqual([`Milestone: Two plates a side, ${name}, 100 kg`]);
  });

  it('ticks are evaluated in order, even while the reload read is held', async () => {
    const { result, rerender } = await started();
    const h = hold();
    await rerender({ k: 1 });
    await edit(result, 0, '60', '5');
    await edit(result, 1, '100', '5');
    await h.release();
    await settle(result);
    h.restore();
    expect(msToasts().map((m) => m.split(',')[0])).toEqual(['Milestone: One plate a side', 'Milestone: Two plates a side']);
  });

  it('an id is cached as shown only after its write succeeds: a failed write stays unshown and toasts on a later tick', async () => {
    const { db, name, result } = await started();
    const real = db.runAsync.bind(db);
    let fail = true;
    db.runAsync = (async (sql: string, ...a: never[]) => (fail && /INSERT OR REPLACE INTO settings/.test(sql) && a[0] === KEY_MILESTONES_SHOWN ? Promise.reject(new Error('full')) : real(sql, ...a))) as typeof db.runAsync;
    await tickSet(result, 0, '60', '5');
    expect(msToasts()).toEqual([]);
    expect(result.current.earned).toEqual([]);
    expect(await shown(db)).toEqual(new Set());
    fail = false;
    await tickSet(result, 1, '60', '5');
    expect(msToasts()).toEqual([`Milestone: One plate a side, ${name}, 60 kg`]);
  });
});
