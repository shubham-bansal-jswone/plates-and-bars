import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { dedupeExercises, TEMPLATES } from '@plate-and-bar/core';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { buildSession } from '../src/workout/buildSession';
import { cantChange } from '../src/workout/cantApply';
import { dedupeStored, exercisesFrom, mergeWorkout, unionWorkout } from '../src/workout/model';
import type { Workout, WorkoutExercise, WorkoutSet } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';
import { loadSets, loadWorkout, saveSet, saveWorkout } from '../src/db/workouts';
import { dayQueue } from '../src/workout/dayQueue';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import { openDb } from './sync-helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

// A session never holds one exercise name twice (#1340, owner decision; closes #1329). Core owns the rule (dedupeExercises); these
// are the places it is applied in the app: the plan build, the can't-do swap, a sync merge, an import (import-workouts.test.tsx) and load.
const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const ex = (name: string, o: Partial<WorkoutExercise> = {}): WorkoutExercise => ({ name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false, ...o });
const row = (exercises: WorkoutExercise[], o: Partial<Workout> = {}): Workout => ({
  id: null, version: 2, updated_at: '2026-10-08T08:00:00Z', deleted_at: null, date: DATE, template: 'Upper A', base: 'Upper A', where: null, cardio_min: null,
  mods: { deload: false, light: false, reentry: 0, short: false, where: 'gym' }, exercises, ci_choice: null, ...o,
});
const names = (w: Workout) => w.exercises.map((e) => e.name);
const set = (id: string, exercise: string, i: number): WorkoutSet => ({ id, version: 1, updated_at: '2026-10-08T08:00:00Z', deleted_at: null, workout_id: null, exercise, kind: 'work', set_index: i, weight_kg: 50, reps: 8, done: false, rate: null, t: null });
const profile = (where: 'gym' | 'dumbbells' | 'bodyweight', exp: 'new' | 'some' | 'exp') =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where, days: 6, exp, minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

describe('the plan build never repeats a name', () => {
  it('every template, place, session length and focus yields each name once', () => {
    const where = ['gym', 'dumbbells', 'bodyweight'] as const;
    for (const template of Object.keys(TEMPLATES)) {
      for (const w of where) {
        for (const minutes of [30, 45, 60, 90]) {
          for (const focus of [[], ['chest'], ['abs', 'biceps', 'quads']]) {
            for (const rot of [0, 1, 2, 3]) {
              const sessions = Object.fromEntries(Array.from({ length: rot }, (_, k) => [`2026-09-${10 + k}`, { t: template, base: template, sets: 3 }]));
              const built = buildSession({
                template, date: DATE, profile: { ...profile(w, 'some'), minutes } as never, where: w, sessions: sessions as never, lifts: {}, ciChoice: null, checkin: { time: null } as never,
                focus, exclusions: [], swaps: [], adjustments: {},
              });
              const list = built.exercises.map((e) => e.name);
              expect(new Set(list).size).toBe(list.length);
            }
          }
        }
      }
    }
  });

  it('a swap that lands on another template exercise, bridging or not, still shows it once', () => {
    const base = { template: 'Upper A', date: DATE, profile: profile('gym', 'some'), where: 'gym' as const, sessions: {}, lifts: {}, ciChoice: null, checkin: { time: null } as never, focus: [], exclusions: [], adjustments: {} };
    for (const [from, to, until] of [['Rope Pushdown', 'Machine Chest Press', null], ['Machine Chest Press', 'Lat Pulldown', '2026-10-20'], ['Lat Pulldown', 'Machine Chest Press', '2026-10-20']] as const) {
      const swaps = [{ id: 'x', version: 1, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, from, to, bridge_until: until }] as never;
      const list = buildSession({ ...base, swaps }).exercises.map((e) => e.name);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('can\'t-do swap refuses a name already in the session', () => {
  const draft = { name: 'Row', reason: 'dislike', dur: 'today', scope: 'exercise', key: 'Row' } as never;
  it('the stored change is empty: no exercise, set or tombstone changes', () => {
    const w = row([ex('Bench'), ex('Row'), ex('Curl')]);
    const sets = [set('a', 'Bench', 0), set('r', 'Row', 0), set('c', 'Curl', 0)];
    const ch = cantChange(w, sets, 1, draft, 'Curl', 'gym', [], {}, DATE, '2026-10-08T10:00:00Z');
    expect(ch.exercises.map((e) => e.name)).toEqual(['Bench', 'Row', 'Curl']);
    expect([ch.added.length, ch.removed.length, ch.changed.length]).toEqual([0, 0, 0]);
    expect(ch.sets.map((s) => s.id)).toEqual(['a', 'r', 'c']);
  });
  it('a name not in the session still swaps', () => {
    const w = row([ex('Bench'), ex('Row')]);
    const ch = cantChange(w, [set('a', 'Bench', 0), set('r', 'Row', 0)], 1, draft, 'Curl', 'gym', [], {}, DATE, '2026-10-08T10:00:00Z');
    expect(ch.exercises.map((e) => e.name)).toEqual(['Bench', 'Curl']);
  });
});

describe('sync merge ends with one entry per name', () => {
  const base = row([ex('Bench'), ex('Row')]);
  it('two devices that each added the same exercise: one, not two', () => {
    const theirs = row([ex('Bench'), ex('Row'), ex('Curl')]);
    const mine = row([ex('Bench'), ex('Row'), ex('Curl')]);
    expect(names(mergeWorkout(base, mine, theirs))).toEqual(['Bench', 'Row', 'Curl']);
  });
  it('a stored copy that already repeats a name comes out once, in the first place', () => {
    const theirs = row([ex('Bench'), ex('Row'), ex('Bench', { form: 'no' })]);
    const out = mergeWorkout(base, row([ex('Bench'), ex('Row')]), theirs);
    expect(out.exercises).toEqual([ex('Bench'), ex('Row')]);
  });
  it('a merge that drops a member of a superset repairs the group', () => {
    const theirs = row([ex('A', { group: 'g' }), ex('B', { group: 'g' }), ex('A', { group: 'h' })]);
    const out = mergeWorkout(row([]), row([]), theirs);
    expect(out.exercises.map((e) => [e.name, e.group ?? null])).toEqual([['A', 'g'], ['B', 'g']]);
  });
  it('the union of two unrelated copies is deduped too', () => {
    const out = unionWorkout(row([ex('Bench'), ex('Bench')]), row([ex('Row')], { updated_at: '2026-10-08T07:00:00Z' }));
    expect(names(out)).toEqual(['Bench']);
  });
  it('dedupeStored on a list with no repeat is the group repair alone', () => {
    const list = [ex('A', { group: 'g' }), ex('B')];
    expect(dedupeStored(list)).toEqual([ex('A', { group: null }), ex('B')]);
    expect(dedupeStored([ex('A'), ex('B')])).toEqual([ex('A'), ex('B')]);
  });
  it('matches core dedupeExercises on names and group', () => {
    const list = [ex('A', { group: 'g' }), ex('B', { group: 'g' }), ex('A')];
    expect(dedupeStored(list).map((e) => [e.name, e.group ?? null])).toEqual(dedupeExercises(list.map((e) => ({ name: e.name, sets: 0, group: e.group ?? null }))).map((e) => [e.name, e.group]));
  });
});

describe('load: a stored session that repeats a name', () => {
  it('shows one entry holding every set row of that name, and no set row is lost', () => {
    const w = row([ex('Bench'), ex('Row'), ex('Bench')]);
    const sets = [set('a', 'Bench', 0), set('b', 'Bench', 1), set('r', 'Row', 0), set('c', 'Bench', 2)];
    const shown = exercisesFrom(w, sets);
    expect(shown.map((e) => [e.name, e.sets.map((s) => s.id)])).toEqual([['Bench', ['a', 'b', 'c']], ['Row', ['r']]]);
  });

  async function stored(dup: boolean) {
    const db = memoryDb();
    await saveProfile(db, profile('gym', 'some'));
    const w = row([ex('Barbell Bench Press'), ex('Barbell Row'), ...(dup ? [ex('Barbell Bench Press')] : [])], { template: 'Session', base: null });
    db.rows.set(`workouts:${DATE}`, JSON.stringify(w));
    for (const [i, n] of ['Barbell Bench Press', 'Barbell Bench Press', 'Barbell Row'].entries()) db.sets.set(`s${i}`, { date: DATE, data: JSON.stringify(set(`s${i}`, n, i === 1 ? 1 : 0)) } as never);
    return db;
  }

  it('the screen shows it once and loading writes nothing back', async () => {
    const db = await stored(true);
    const before = db.rows.get(`workouts:${DATE}`);
    const setsBefore = JSON.stringify([...db.sets.values()]);
    await render(withProfile(db, <WorkoutScreen db={db} now={NOW} />));
    expect(await screen.findAllByLabelText(/^Can’t do Barbell Bench Press$/)).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(db.rows.get(`workouts:${DATE}`)).toBe(before);
    expect(JSON.stringify([...db.sets.values()])).toBe(setsBefore);
    await cleanup();
  });

  it('the next real edit writes the cleaned list, with the set rows of the name untouched', async () => {
    const db = await stored(true);
    await render(withProfile(db, <WorkoutScreen db={db} now={NOW} />));
    await fireEvent.changeText(await screen.findByLabelText('Cardio minutes'), '20');
    await waitFor(() => expect((JSON.parse(db.rows.get(`workouts:${DATE}`) as string) as Workout).exercises.map((e) => e.name)).toEqual(['Barbell Bench Press', 'Barbell Row']));
    const bench = [...db.sets.values()].map((r) => JSON.parse(r.data) as WorkoutSet).filter((s) => s.exercise === 'Barbell Bench Press' && !s.deleted_at);
    expect(bench.map((x) => x.id).sort()).toEqual(['s0', 's1']);
    await cleanup();
  });
});

// Hook-level: the can't-do pick and the legacy set numbers (#1340 round 2).
const profileH = profile('gym', 'some');
async function hook(seed?: (db: Awaited<ReturnType<typeof openDb>>) => Promise<void>) {
  const db = await openDb();
  if (seed) await seed(db);
  const notify = jest.fn();
  const saveRule = jest.fn(() => ({}) as never);
  const opts = { db, profile: profileH, now: NOW, focus: [], adjustments: {}, notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule, tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
  const view = await renderHook(({ k }: { k: number }) => useWorkoutDay({ ...opts, reloadKey: k }), { initialProps: { k: 0 } });
  await waitFor(() => expect(view.result.current.day.ready).toBe(true));
  return { db, notify, saveRule, ...view };
}

describe('can\'t do: a pick already in the session is refused whole', () => {
  it.each(['perm', 'week'] as const)('with the answer %s it says so, saves no rule and swaps nothing', async (dur) => {
    const { db, notify, saveRule, result } = await hook();
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    await act(async () => void (await dayQueue.current));
    const before = result.current.day.exs.map((e) => e.name);
    const [first, second] = before as [string, string];
    await act(async () => result.current.cant(0, { name: first, reason: 'dislike', dur, scope: 'exercise', key: first } as never, second));
    await act(async () => void (await dayQueue.current));
    expect(notify).toHaveBeenCalledWith(`${second} is already in today’s session.`);
    expect(saveRule).not.toHaveBeenCalled();
    expect(notify.mock.calls.some(([m]) => /Swapped in/.test(String(m)))).toBe(false);
    expect(result.current.day.exs.map((e) => e.name)).toEqual(before);
    expect((await loadWorkout(db, DATE))?.exercises.map((e) => e.name)).toEqual(before);
  });
});

describe('legacy rows of a repeated name share set numbers', () => {
  // Stored in reverse so only the id tiebreak gives the order. Two copies of Row saved before #1335: x4 and x3, each numbered from 0. Shown as A0,B0,A1,B1,A2,B2,A3.
  const seed = async (db: Awaited<ReturnType<typeof openDb>>) => {
    await saveWorkout(db, row([ex('Row'), ex('Row')]));
    for (const [id, i] of [['b2', 2], ['b1', 1], ['b0', 0], ['a3', 3], ['a2', 2], ['a1', 1], ['a0', 0]] as const) await saveSet(db, DATE, set(id, 'Row', i));
  };
  const order = (r: { current: { day: { exs: { sets: { id: string }[] }[] } } }) => r.current.day.exs[0]?.sets.map((s) => s.id);
  const SHOWN = ['a0', 'b0', 'a1', 'b1', 'a2', 'b2', 'a3'];

  it('load shows them by number then id and writes nothing', async () => {
    const { db, result } = await hook(seed);
    expect(order(result)).toEqual(SHOWN);
    expect((await loadSets(db, DATE)).filter((s) => s.updated_at !== '2026-10-08T08:00:00Z')).toEqual([]);
  });

  it('a ticked set stays where it is after a reload', async () => {
    const { db, result, rerender } = await hook(seed);
    await act(async () => result.current.tick(0, 1));
    await act(async () => void (await dayQueue.current));
    await rerender({ k: 1 });
    await waitFor(() => expect((result.current.day.exs[0]?.sets.find((s) => s.done)) !== undefined).toBe(true));
    expect(order(result)).toEqual(SHOWN);
    expect(result.current.day.exs[0]?.sets[1]?.done).toBe(true);
    expect((await loadSets(db, DATE)).filter((s) => !s.deleted_at).map((s) => s.set_index).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it('ramp rows with clashing numbers keep their order, and a ticked ramp set stays put after a reload', async () => {
    // Clashing ramp rows only (the work rows are numbered cleanly): the renumber has to read the ramp rows, not the work rows.
    const { db, result, rerender } = await hook(async (d) => {
      await saveWorkout(d, row([ex('Row'), ex('Row')]));
      await saveSet(d, DATE, set('w0', 'Row', 0));
      for (const [id, i] of [['rb1', 1], ['rb0', 0], ['ra1', 1], ['ra0', 0]] as const) await saveSet(d, DATE, { ...set(id, 'Row', i), kind: 'ramp' });
    });
    const ramp = () => result.current.day.exs[0]?.ramp.map((s) => s.id);
    expect(ramp()).toEqual(['ra0', 'rb0', 'ra1', 'rb1']);
    await act(async () => void result.current.rampTick(0, 1));
    await act(async () => void (await dayQueue.current));
    await rerender({ k: 1 });
    await waitFor(() => expect(result.current.day.exs[0]?.ramp.some((s) => s.done)).toBe(true));
    expect(ramp()).toEqual(['ra0', 'rb0', 'ra1', 'rb1']);
    expect(result.current.day.exs[0]?.ramp[1]?.done).toBe(true);
    expect((await loadSets(db, DATE)).filter((s) => s.kind === 'ramp').map((s) => s.set_index).sort()).toEqual([0, 1, 2, 3]);
  });
});
