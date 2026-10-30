import { act, renderHook, waitFor } from '@testing-library/react-native';
import { loadWorkout, saveWorkout } from '../src/db/workouts';
import { dayQueue } from '../src/workout/dayQueue';
import { mergeWorkout } from '../src/workout/model';
import type { GroupNext } from '../src/workout/parts';
import { parseRest } from '../src/workout/restStore';
import { restRetarget } from '../src/workout/restNext';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { openDb } from './sync-helpers';

// Group and ungroup (#1182 S5): the hook actions, what they store, and the two fixes from the #1333 review.
jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const settle = () => act(async () => void (await dayQueue.current));

/** A built session whose exercise i has group `groups[i]` (stored, then read by a fresh hook, as a pull would bring it). */
async function session(groups: (string | null)[] = []) {
  const db = await openDb();
  const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify: jest.fn(), startRest: jest.fn(), restOff: false, exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
  const first = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
  await waitFor(() => expect(first.result.current.day.ready).toBe(true));
  await act(async () => void (await first.result.current.start('Upper A', {}, null)));
  await settle();
  const w = (await loadWorkout(db, DATE))!;
  await saveWorkout(db, { ...w, exercises: w.exercises.map((e, i) => (groups[i] ? { ...e, group: groups[i] } : e)), updated_at: '2026-10-08T09:30:00Z' });
  const { result } = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
  await waitFor(() => expect(result.current.day.exs.length).toBeGreaterThan(3));
  const stored = async () => (await loadWorkout(db, DATE))!.exercises;
  return { result, stored };
}
const groups = (r: Awaited<ReturnType<typeof session>>['result']) => r.current.day.exs.map((e) => e.group ?? null);
const validId = /^[A-Za-z0-9_-]{1,36}$/;

describe('groupWithNext', () => {
  it('groups two ungrouped exercises under a new valid id, on screen and stored', async () => {
    const { result, stored } = await session();
    let names: string[] | null = null;
    await act(async () => void (names = result.current.groupWithNext(1)));
    await settle();
    expect(names).toEqual([result.current.day.exs[1]!.name, result.current.day.exs[2]!.name]);
    const g = groups(result);
    expect(g[1]).toMatch(validId);
    expect(g[2]).toBe(g[1]);
    expect([g[0], g[3]]).toEqual([null, null]);
    const s = await stored();
    expect(s[1]!.group).toBe(g[1]);
    expect(s[2]!.group).toBe(g[1]);
    expect('group' in s[0]!).toBe(false); // never grouped: no key written
  });

  it('an ungrouped exercise joins the group that starts at the next one, with that id', async () => {
    const { result, stored } = await session([null, 'g', 'g']);
    await act(async () => void result.current.groupWithNext(0));
    await settle();
    expect(groups(result).slice(0, 4)).toEqual(['g', 'g', 'g', null]);
    expect((await stored()).map((e) => e.group ?? null).slice(0, 3)).toEqual(['g', 'g', 'g']);
  });

  it('the last member takes the ungrouped next exercise; a member that is not the last is refused', async () => {
    const { result } = await session(['g', 'g', null]);
    await act(async () => void result.current.groupWithNext(1));
    expect(groups(result).slice(0, 3)).toEqual(['g', 'g', 'g']);
    expect(result.current.groupWithNext(0)).toBeNull();
  });

  it('joins the id of the valid run, not a lone exercise\'s leftover id', async () => {
    const { result } = await session(['x', 'h', 'h']); // x is a singleton: core reads it as ungrouped
    await act(async () => void result.current.groupWithNext(0));
    expect(groups(result).slice(0, 3)).toEqual(['h', 'h', 'h']);
  });

  it('refuses what core refuses and changes nothing: a finished exercise, the last exercise', async () => {
    const done = await session();
    await act(async () => {
      for (let j = 0; j < done.result.current.day.exs[1]!.sets.length; j++) {
        done.result.current.editSet(1, 'work', j, 'w', '40');
        done.result.current.editSet(1, 'work', j, 'r', '10');
      }
    });
    for (let j = 0; j < done.result.current.day.exs[1]!.sets.length; j++) await act(async () => void done.result.current.tick(1, j));
    expect(done.result.current.groupWithNext(0)).toBeNull();
    expect(done.result.current.groupWithNext(done.result.current.day.exs.length - 1)).toBeNull();
    expect(groups(done.result).every((x) => x === null)).toBe(true);
  });
});

describe('ungroup', () => {
  it('writes an explicit group: null on every member, keeps order and ticks, and returns the former members', async () => {
    const { result, stored } = await session([null, 'g', 'g', 'g']);
    const before = result.current.day.exs.map((e) => e.name);
    let names: string[] | null = null;
    await act(async () => void (names = result.current.ungroup(2)));
    await settle();
    expect(names).toEqual(before.slice(1, 4));
    expect(result.current.day.exs.map((e) => e.name)).toEqual(before);
    expect(groups(result).slice(0, 4)).toEqual([null, null, null, null]);
    const s = await stored();
    for (const k of [1, 2, 3]) expect(s[k]).toHaveProperty('group', null); // the key is there, as null
    expect('group' in s[0]!).toBe(false);
  });

  it('an ungroup survives the three-way merge: the other device still has the group, so null wins', async () => {
    const { result, stored } = await session(['g', 'g']);
    const base = (await stored()).map((e) => ({ ...e }));
    await act(async () => void result.current.ungroup(0));
    await settle();
    const mine = await stored();
    const row = (exercises: typeof mine) => ({ id: null, version: 1, updated_at: '2026-10-08T09:30:00Z', deleted_at: null, date: DATE, template: 'Upper A', base: 'Upper A', where: null, cardio_min: null, mods: {}, exercises, ci_choice: null }) as never;
    const merged = mergeWorkout(row(base), row(mine), row(base));
    expect(merged.exercises.slice(0, 2).map((e) => e.group)).toEqual([null, null]);
  });

  it('an exercise in no group is refused', async () => {
    const { result } = await session();
    expect(result.current.ungroup(0)).toBeNull();
  });
});

describe('the dock label follows the groups (#1333 review)', () => {
  // The ticked exercise has its first set done, as when the rest started.
  const ex = (name: string, group: string | null, n = 3) => ({ name, group, sets: Array.from({ length: n }, (_, j) => ({ done: name === 'A' && j === 0 })) }) as never;
  const rest = { at: { i: 0, name: 'A' }, to: { ex: 1, set: 0, name: 'B' }, label: 'Next: B1 B' } as GroupNext;

  it('keeps the object while the label is right, and re-derives it when the group goes', () => {
    expect(restRetarget([ex('A', 'g'), ex('B', 'g')], rest)).toBe(rest);
    expect(restRetarget([ex('A', null), ex('B', null)], rest)).toMatchObject({ label: 'Next: B', to: { ex: 1, set: 0, name: 'B' } });
  });

});

describe('a stored rest (#1333 review)', () => {
  const base = { id: 1, end: 2_000, total: 60, label: 'Next: B1 Row', date: DATE };
  const parse = (r: object) => parseRest(JSON.stringify(r), DATE, 1_000);
  const at = { i: 0, name: 'Bench' };
  const to = { ex: 1, set: 0, name: 'Row' };

  it('reads a grouped rest with both at and to, and an ungrouped one with neither', () => {
    expect(parse({ ...base, at, to })).not.toBeNull();
    expect(parse({ ...base, from: ['Bench', 'Row'] })).not.toBeNull();
  });
  it('rejects at without to, to without at, and a null at or to', () => {
    for (const r of [{ at }, { to }, { at: null }, { to: null }, { at, to: null }, { at: null, to }]) expect(parse({ ...base, ...r })).toBeNull();
  });
});

describe('groupRounds and groupReason (#1182 S5 review)', () => {
  const m = (...done: boolean[]) => ({ name: '', group: 'g', sets: done.map((d) => ({ done: d })) }) as never;
  it('uneven set counts: a member without that round does not hold it back', () => {
    const { groupRounds } = jest.requireActual('../src/workout/groupUnits');
    expect(groupRounds([m(true), m(true, true)])).toEqual({ total: 2, done: 2 });
    expect(groupRounds([m(true), m(true, false)])).toEqual({ total: 2, done: 1 });
    expect(groupRounds([m(false), m(true, true)])).toEqual({ total: 2, done: 0 });
  });
  it('the cap text comes from core and the duplicate reason names the joining exercise', () => {
    const { groupReason } = jest.requireActual('../src/workout/groupUnits');
    expect(groupReason({ ok: false, why: 'full', ex: 0 }, [])).toBe('A superset holds up to 6 exercises.');
    expect(groupReason({ ok: false, why: 'same', ex: 1 }, ['a', 'b'])).toBe('b would be in this superset twice.');
  });
});
