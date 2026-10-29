import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { Vibration } from 'react-native';
import { personalRecords, type ExType } from '@plate-and-bar/core';
import { loadDoneSets, loadLifts, loadSets, loadWorkout, saveLift, saveSet, saveWorkout } from '../src/db/workouts';
import { dayQueue } from '../src/workout/dayQueue';
import { CompletionPanel } from '../src/workout/CompletionPanel';
import { buildShareCard } from '../src/workout/shareModel';
import { pbToastText } from '../src/workout/copy';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import type { WorkoutSet } from '../src/workout/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { openDb } from './sync-helpers';

jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const notify = jest.fn();
const profileAt = (weight: string) => buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight, activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const OVER = { step_kg: 2.5, rep_low: 5, rep_high: 12 };

type Db = Awaited<ReturnType<typeof openDb>>;
interface Props { k: number; weight: string; unit: 'kg' | 'lb'; type: ExType | null; name: string | null; date?: string }

/** A started session; `type` overrides exercise 0's type once its name is known (set through `rerender`). */
async function started(unit: 'kg' | 'lb' = 'kg') {
  const db = await openDb();
  const base = { db, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn() };
  const view = await renderHook(
    (p: Props) => useWorkoutDay({ ...base, ...(p.date ? { date: p.date } : {}), profile: profileAt(p.weight), tune: { unit: p.unit, overrides: p.type && p.name ? { [p.name]: { type: p.type, ...OVER } } : {} }, reloadKey: p.k } as unknown as Parameters<typeof useWorkoutDay>[0]),
    { initialProps: { k: 0, weight: '82', unit, type: null, name: null } as Props },
  );
  await waitFor(() => expect(view.result.current.day.ready).toBe(true));
  await act(async () => void (await view.result.current.start('Upper A', {}, null)));
  await waitFor(async () => expect((await loadSets(db, DATE)).length).toBeGreaterThan(0));
  await act(async () => void (await dayQueue.current));
  const name = view.result.current.day.exs[0]!.name;
  notify.mockClear();
  let cur: Props = { k: 0, weight: '82', unit, type: null, name };
  const props = (p: Partial<Props>) => view.rerender((cur = { ...cur, ...p }));
  return { db, name, props, ...view };
}

/** An earlier day of `name`: a workout row, done work sets [kg, reps], and the lift record when it is the latest. */
async function seedDay(db: Db, name: string, date: string, sets: [number, number][], record = false) {
  const w = (await loadWorkout(db, DATE))!;
  await saveWorkout(db, { ...w, date, id: `w-${date}` } as typeof w);
  let i = 0;
  for (const [kg, reps] of sets) {
    const s: WorkoutSet = { id: `${date}-${i}`, version: 0, updated_at: `${date}T09:00:00Z`, deleted_at: null, workout_id: null, exercise: name, kind: 'work', set_index: i++, weight_kg: kg, reps, done: true, rate: null, t: null };
    await saveSet(db, date, s);
  }
  if (record) await saveLift(db, name, { date, sets: sets.map(([w2, r]) => ({ w: w2, r, rate: null })), form: null, n: 3, first: '2026-09-01', prev: null, hist: [{ date, e: 1 }] });
}

type Hook = Awaited<ReturnType<typeof started>>['result'];
const tickSet = async (result: Hook, j: number, w: string, r: string) => {
  await act(async () => result.current.editSet(0, 'work', j, 'w', w));
  await act(async () => result.current.editSet(0, 'work', j, 'r', r));
  await act(async () => result.current.tick(0, j));
  await act(async () => void (await dayQueue.current));
};
const toasts = () => notify.mock.calls.map(([m]) => String(m)).filter((m) => m.startsWith('New personal best'));
const pbToast = async (db: Db, name: string) => (await loadLifts(db))[name]?.pbToast;

describe('the personal-best toast uses the all-time rule (#1351 A4b)', () => {
  it('an all-time PR toasts, says what improved, and records the day', async () => {
    const vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]], true);
    vibrate.mockClear();
    await tickSet(result, 0, '100', '5');
    expect(toasts()).toEqual([`New personal best: ${name} 100 kg x 5, estimated 1RM 116.7 kg (+11.7 kg)`]);
    expect(vibrate.mock.calls.filter(([p]) => p === 60)).toHaveLength(1);
    expect(await pbToast(db, name)).toBe(DATE);
    vibrate.mockRestore();
  });

  it('a session that only beats the last 8 sessions is not a PR, though the stored history says it is', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-08-20', [[100, 5]]);
    for (let i = 0; i < 9; i++) await seedDay(db, name, `2026-09-${10 + i}`, [[60, 5]], i === 8);
    await saveLift(db, name, { date: '2026-09-18', sets: [{ w: 60, r: 5, rate: null }], form: null, n: 10, first: '2026-08-20', prev: null, hist: Array.from({ length: 8 }, (_, i) => ({ date: `2026-09-${11 + i}`, e: 70 })) });
    await tickSet(result, 0, '80', '5'); // beats the last 8 (70), not the 100 x 5 before them
    expect(toasts()).toEqual([]);
    expect(await pbToast(db, name)).toBeUndefined();
    expect(result.current.day.lifts[name]?.pbToast).toBeUndefined();
  });

  it('a threshold-exact day is not a PR, and a bit more is', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[100, 1]]);
    await seedDay(db, name, '2026-09-20', [[100, 1]], true);
    await tickSet(result, 0, '100.5', '1'); // exactly +0.5% (a single scores its weight)
    expect(toasts()).toEqual([]);
    await tickSet(result, 1, '100.6', '1');
    expect(toasts()).toHaveLength(1);
  });

  it('toasts once per lift per day, and an untick then a retick does not toast again', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]], true);
    await tickSet(result, 0, '100', '5');
    await tickSet(result, 1, '105', '5');
    expect(toasts()).toHaveLength(1);
    await act(async () => result.current.tick(0, 0)); // untick
    await act(async () => result.current.tick(0, 1));
    await act(async () => void (await dayQueue.current));
    expect(await pbToast(db, name)).toBe(DATE);
    await act(async () => result.current.tick(0, 0)); // retick
    await act(async () => void (await dayQueue.current));
    expect(toasts()).toHaveLength(1);
    expect(await pbToast(db, name)).toBe(DATE);
  });

  it('says it in pounds for a pound user', async () => {
    const { db, name, result } = await started('lb');
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]], true);
    await tickSet(result, 0, '100', '5');
    expect(toasts()).toEqual([`New personal best: ${name} 220.5 lb x 5, estimated 1RM 257.3 lb (+25.8 lb)`]);
  });

  it('words a total-reps lift by reps and a loaded one by 1RM (copy)', () => {
    const reps = { metric: 'reps' as const, score: 32, set: { w: 0, r: 10 }, previousBest: 29, delta: 3 };
    expect(pbToastText('Pull-up', reps, 'kg', 'bodyweight')).toBe('New personal best: Pull-up, 32 reps in total (+3)');
    expect(pbToastText('Plank', reps, 'kg', 'time')).toBe('New personal best: Plank, 32 sec in total (+3)');
    const assisted = { metric: 'assisted' as const, score: 520, set: { w: 30, r: 10 }, previousBest: 420, delta: 100 };
    expect(pbToastText('Assisted Pull-up', assisted, 'kg', 'assisted')).toBe('New personal best: Assisted Pull-up, 10 reps with 30 kg of assistance');
  });

  it('a total-reps lift toasts by reps', async () => {
    const { db, name, props, result } = await started();
    await act(async () => void (await props({ type: 'bodyweight' })));
    await seedDay(db, name, '2026-09-01', [[0, 10]]);
    await seedDay(db, name, '2026-09-20', [[0, 12]], true);
    await tickSet(result, 0, '0', '15');
    expect(toasts()).toEqual([`New personal best: ${name}, 15 reps in total (+3)`]);
  });

  it('an assisted lift rescores earlier days at the new bodyweight after a weigh-in', async () => {
    const { db, name, props, result } = await started();
    await act(async () => void (await props({ type: 'assisted' })));
    await seedDay(db, name, '2026-09-01', [[20, 8]]);
    await seedDay(db, name, '2026-09-20', [[20, 8]], true);
    await tickSet(result, 0, '12', '7'); // at 82 kg: 7 x 70 = 490 against 8 x 62 = 496
    expect(toasts()).toEqual([]);
    await act(async () => void (await props({ weight: '60' }))); // weigh-in: prior is now 8 x 40 = 320, today 7 x 48 = 336
    await tickSet(result, 1, '12', '7');
    expect(toasts()).toHaveLength(1);
  });

  it('reads the prior best once, and reads it again after a pull (dataVersion)', async () => {
    const { db, name, props, result } = await started();
    await seedDay(db, name, '2026-09-01', [[60, 5]]);
    await seedDay(db, name, '2026-09-10', [[100, 5]]);
    await seedDay(db, name, '2026-09-20', [[60, 5]], true);
    const reads = jest.spyOn(db, 'getAllAsync');
    const setReads = () => reads.mock.calls.filter(([sql]) => /json_extract\(data, '\$\.exercise'\)/.test(String(sql))).length;
    await tickSet(result, 0, '80', '5'); // not a PR: 100 x 5 is the best
    await tickSet(result, 1, '81', '5');
    expect(setReads()).toBe(1);
    expect(toasts()).toEqual([]);
    // Another device deleted that heavy day: the next read (after the pull) finds a lower best.
    for (const s of await loadSets(db, '2026-09-10')) await saveSet(db, '2026-09-10', { ...s, deleted_at: '2026-10-08T09:00:00Z' });
    await act(async () => void (await props({ k: 1 })));
    await waitFor(() => expect(result.current.day.ready).toBe(true));
    await tickSet(result, 2, '90', '5');
    expect(setReads()).toBe(2);
    expect(toasts()).toHaveLength(1);
  });

  it('an edit to an earlier day drops the cached prior best of the day viewed after it', async () => {
    const { db, name, props, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[100, 5]]);
    await tickSet(result, 0, '80', '5'); // prior 116.7: no PR, and the prior is cached
    expect(toasts()).toEqual([]);
    await act(async () => void (await props({ date: '2026-09-20' })));
    await waitFor(() => expect(result.current.day.workout?.date).toBe('2026-09-20'));
    await act(async () => result.current.tick(0, 0)); // untick the 100 x 5
    await act(async () => void (await dayQueue.current));
    await act(async () => void (await props({ date: undefined })));
    await waitFor(() => expect(result.current.day.workout?.date).toBe(DATE));
    await tickSet(result, 1, '90', '5'); // prior is now 93.3 (80 x 5): 105 beats it
    expect(toasts()).toHaveLength(1);
  });

  it('a lift with stored sets but no lift record (an import) toasts once, and its buzz once, across untick and retick', async () => {
    const vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]]);
    vibrate.mockClear();
    await tickSet(result, 0, '100', '5');
    await act(async () => result.current.tick(0, 0));
    await act(async () => void (await dayQueue.current));
    await act(async () => result.current.tick(0, 0));
    await act(async () => void (await dayQueue.current));
    expect(toasts()).toHaveLength(1);
    expect(vibrate.mock.calls.filter(([p]) => p === 60)).toHaveLength(1);
    expect(await pbToast(db, name)).toBe(DATE);
    vibrate.mockRestore();
  });

  it('a same-day record keeps an older pbToast through a tick that is not a PR', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[100, 5]]);
    await seedDay(db, name, '2026-09-20', [[100, 5]]);
    // The stored history is short, so the old last-8 check would call 60 x 5 a best; the all-time rule does not.
    await saveLift(db, name, { date: DATE, sets: [{ w: 50, r: 5, rate: null }], form: null, n: 3, first: '2026-09-01', prev: null, hist: [{ date: '2026-09-01', e: 1 }, { date: '2026-09-20', e: 1 }], pbToast: '2026-09-01' });
    await tickSet(result, 0, '60', '5');
    expect(toasts()).toEqual([]);
    expect(await pbToast(db, name)).toBe('2026-09-01');
  });

  it('a lift record already marked a personal best today does not toast again (after a remount)', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]]);
    await saveLift(db, name, { date: DATE, sets: [{ w: 50, r: 5, rate: null }], form: null, n: 3, first: '2026-09-01', prev: null, hist: [{ date: '2026-09-01', e: 1 }, { date: '2026-09-20', e: 1 }], pbToast: DATE });
    await tickSet(result, 0, '100', '5');
    expect(toasts()).toEqual([]);
    expect(await pbToast(db, name)).toBe(DATE);
  });

  it('the once-per-day guard is per date: a PR on each of two days toasts on each', async () => {
    const { db, name, props, result } = await started();
    await seedDay(db, name, '2026-08-01', [[80, 5]]);
    await seedDay(db, name, '2026-08-10', [[90, 5]]);
    await seedDay(db, name, '2026-09-20', [[50, 5]]);
    await act(async () => void (await props({ date: '2026-09-20' })));
    await waitFor(() => expect(result.current.day.workout?.date).toBe('2026-09-20'));
    await act(async () => result.current.tick(0, 0)); // untick the stored set, then log a heavier one
    await act(async () => void (await dayQueue.current));
    await tickSet(result, 0, '120', '5');
    expect(toasts()).toHaveLength(1);
    await act(async () => void (await props({ date: undefined })));
    await waitFor(() => expect(result.current.day.workout?.date).toBe(DATE));
    await tickSet(result, 0, '200', '5');
    expect(toasts()).toHaveLength(2);
  });

  it('a prior-best read that was in flight when a pull landed is not cached', async () => {
    const { db, name, props, result } = await started();
    await seedDay(db, name, '2026-09-01', [[60, 5]]);
    await seedDay(db, name, '2026-09-20', [[60, 5]], true);
    const real = db.getAllAsync.bind(db);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let reads = 0;
    db.getAllAsync = (async (sql: string, ...args: (string | number)[]) => {
      const rows = await real(sql, ...args);
      if (/json_extract\(data, '\$\.exercise'\)/.test(sql)) {
        reads++;
        if (reads === 1) await gate;
      }
      return rows;
    }) as typeof db.getAllAsync;
    await act(async () => result.current.editSet(0, 'work', 0, 'w', '50'));
    await act(async () => result.current.editSet(0, 'work', 0, 'r', '5'));
    await act(async () => result.current.tick(0, 0)); // the read starts and waits
    await act(async () => void (await props({ k: 1 }))); // a pull lands meanwhile
    await act(async () => release());
    await act(async () => void (await dayQueue.current));
    await waitFor(() => expect(result.current.day.ready).toBe(true));
    await tickSet(result, 1, '50', '5');
    expect(reads).toBe(2);
  });

  // #1372: the badges (completion panel, share picture, History) come from core's personalRecords, not from pbToast.
  /** Ticks every set of every exercise but `name`'s set `skip`: the others with 10 x 10 (no earlier history, so no PR), `name`'s with `w` x `r`. */
  const completeWith = async (result: Hook, name: string, w: string, r: string, skip: number[] = []) => {
    const exs = result.current.day.exs;
    for (let i = 0; i < exs.length; i++) {
      for (let j = 0; j < exs[i]!.sets.length; j++) {
        if (exs[i]!.name === name && skip.includes(j)) continue;
        const mine = exs[i]!.name === name;
        await act(async () => result.current.editSet(i, 'work', j, 'w', mine ? w : '10'));
        await act(async () => result.current.editSet(i, 'work', j, 'r', mine ? r : '10'));
        await act(async () => result.current.tick(i, j));
        await act(async () => void (await dayQueue.current));
      }
    }
  };
  const badges = async (db: Db, name: string, result: Hook, unit: 'kg' | 'lb' = 'kg') => {
    const exs = result.current.day.exs;
    const prs = result.current.prs;
    const history = personalRecords(await loadDoneSets(db), { [name]: 'barbell' }, 82).filter((x) => x.date === DATE).map((x) => x.lift);
    const share = buildShareCard({ date: DATE, exs, cardio: null, prs, unit }).rows.filter((x) => x.pr).map((x) => x.name);
    return { panel: [...prs], history, share };
  };

  it('a personal best shows in the completion panel, the share picture and the records alike', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]], true);
    await completeWith(result, name, '100', '5');
    await waitFor(() => expect(result.current.prs.has(name)).toBe(true));
    expect(await badges(db, name, result)).toEqual({ panel: [name], history: [name], share: [name] });
    await render(<CompletionPanel db={db} date={DATE} profileKg={82} exs={result.current.day.exs} cardio={null} prs={result.current.prs} reloadKey={0} />);
    expect(screen.getAllByText('Personal best').length).toBeGreaterThan(0);
  });

  it('tick a PR, untick it, tick a smaller set: no badge anywhere, and the toast stays once', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]], true);
    await tickSet(result, 0, '100', '5'); // PR: toasts, pbToast = today
    expect(toasts()).toHaveLength(1);
    await act(async () => result.current.tick(0, 0)); // untick
    await act(async () => void (await dayQueue.current));
    await completeWith(result, name, '60', '5'); // a smaller set on every set of the lift
    await act(async () => void (await dayQueue.current));
    expect(await pbToast(db, name)).toBe(DATE); // the toast gate is still set ...
    expect(result.current.day.lifts[name]?.pbToast).toBe(DATE);
    await waitFor(() => expect(result.current.day.exs.flatMap((e) => e.sets).every((x) => x.done)).toBe(true));
    expect(await badges(db, name, result)).toEqual({ panel: [], history: [], share: [] }); // ... but nothing says Personal best
    await render(<CompletionPanel db={db} date={DATE} profileKg={82} exs={result.current.day.exs} cardio={null} prs={result.current.prs} reloadKey={0} />);
    expect(screen.queryByText('Personal best')).toBeNull();
    expect(toasts()).toHaveLength(1);
  });

  it('Complete workout with one set of the record lift unticked: the badge shows in the panel, the records and the share picture', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]], true);
    const last = result.current.day.exs.find((e) => e.name === name)!.sets.length - 1;
    await completeWith(result, name, '100', '5', [last]); // the last set of the lift stays unticked
    expect(result.current.prs.size).toBe(0); // not complete yet
    await act(async () => void result.current.finishEarly());
    await act(async () => void (await dayQueue.current));
    await waitFor(() => expect(result.current.prs.has(name)).toBe(true));
    expect(await badges(db, name, result)).toEqual({ panel: [name], history: [name], share: [name] });
    await render(<CompletionPanel db={db} date={DATE} profileKg={82} exs={result.current.day.exs} cardio={null} prs={result.current.prs} reloadKey={0} />);
    expect(screen.getAllByText('Personal best').length).toBeGreaterThan(0);
  });

  it('Complete workout after untick and a smaller set: no badge', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]], true);
    await tickSet(result, 0, '100', '5');
    await act(async () => result.current.tick(0, 0));
    await act(async () => void (await dayQueue.current));
    await completeWith(result, name, '60', '5', [result.current.day.exs.find((e) => e.name === name)!.sets.length - 1]);
    await act(async () => void result.current.finishEarly());
    await act(async () => void (await dayQueue.current));
    await waitFor(() => expect(result.current.day.exs.length).toBeGreaterThan(0));
    expect((await badges(db, name, result)).panel).toEqual([]);
    expect((await badges(db, name, result)).history).toEqual([]);
  });

  it('an untick removes the badge', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]], true);
    await completeWith(result, name, '100', '5');
    await waitFor(() => expect(result.current.prs.has(name)).toBe(true));
    const sets = result.current.day.exs.find((e) => e.name === name)!.sets.length;
    const idx = result.current.day.exs.findIndex((e) => e.name === name);
    for (let j = 0; j < sets; j++) await act(async () => result.current.tick(idx, j));
    await act(async () => void (await dayQueue.current));
    await waitFor(() => expect(result.current.prs.size).toBe(0));
  });

  it('an imported lift (stored sets, no lift record) badges as personalRecords does', async () => {
    const { db, name, result } = await started();
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]]); // no lift record
    await completeWith(result, name, '100', '5');
    await waitFor(() => expect(result.current.prs.has(name)).toBe(true));
    expect(await badges(db, name, result)).toEqual({ panel: [name], history: [name], share: [name] });
  });

  it('a pound user: the badge follows the stored kg, the picture words the best in lb', async () => {
    const { db, name, result } = await started('lb');
    await seedDay(db, name, '2026-09-01', [[80, 5]]);
    await seedDay(db, name, '2026-09-20', [[90, 5]], true);
    await completeWith(result, name, '100', '5'); // weights are typed and stored in kg
    await waitFor(() => expect(result.current.prs.has(name)).toBe(true));
    const got = await badges(db, name, result, 'lb');
    expect(got).toEqual({ panel: [name], history: [name], share: [name] });
    const card = buildShareCard({ date: DATE, exs: result.current.day.exs, cardio: null, prs: result.current.prs, unit: 'lb' });
    expect(card.bests[result.current.day.exs.findIndex((e) => e.name === name)]).toBe('220.5 x 5');
  });


});
