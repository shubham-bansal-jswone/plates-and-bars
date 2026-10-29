import { act, renderHook, waitFor } from '@testing-library/react-native';
import { restAfterTick, restFor } from '@plate-and-bar/core';
import { loadWorkout, saveWorkout } from '../src/db/workouts';
import { getCatalog } from '../src/workout/catalog';
import { dayQueue } from '../src/workout/dayQueue';
import type { RestNext } from '../src/workout/parts';
import { parseRest } from '../src/workout/restStore';
import { restRetarget, restTarget } from '../src/workout/restNext';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { openDb } from './sync-helpers';

// The rest and Next label after a tick come from core's restAfterTick (#1182 S4); the dock follows the session by position (#1329).
jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const settle = () => act(async () => void (await dayQueue.current));

type Call = [number, RestNext];

/** A built session; `groups[i]` is the group id of exercise i (stored, then read by a fresh hook, as a pull would bring it). */
async function session(groups: (string | null)[] = [], restOff = false) {
  const db = await openDb();
  const calls: Call[] = [];
  const startRest = (s: number, n: RestNext) => void calls.push([s, n]);
  const opts = { db, profile, now: NOW, focus: [], adjustments: {}, notify: jest.fn(), startRest, restOff, exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
  const first = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
  await waitFor(() => expect(first.result.current.day.ready).toBe(true));
  await act(async () => void (await first.result.current.start('Upper A', {}, null)));
  await settle();
  const w = (await loadWorkout(db, DATE))!;
  await saveWorkout(db, { ...w, exercises: w.exercises.map((e, i) => (groups[i] ? { ...e, group: groups[i] } : e)), updated_at: '2026-10-08T09:30:00Z' });
  const { result } = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
  await waitFor(() => expect(result.current.day.exs.length).toBeGreaterThan(3));
  return { result, calls };
}
type R = Awaited<ReturnType<typeof session>>['result'];
const name = (r: R, i: number) => r.current.day.exs[i]!.name;
/** Sets exercise i to n work sets. */
async function setCount(r: R, i: number, n: number) {
  while (r.current.day.exs[i]!.sets.length > n) await act(async () => r.current.removeSet(i));
  while (r.current.day.exs[i]!.sets.length < n) await act(async () => r.current.addSet(i));
}
const tick = async (r: R, i: number, j: number) => {
  await act(async () => {
    r.current.editSet(i, 'work', j, 'w', '40');
    r.current.editSet(i, 'work', j, 'r', '10');
  });
  await act(async () => void r.current.tick(i, j));
};
const rest = (n: string) => restFor(n, getCatalog().tags);

describe('rest and Next label in a group (fixtures: no group UI yet)', () => {
  it('A1 starts the 15 s transition, labelled Next: B1', async () => {
    const { result, calls } = await session(['g', 'g']);
    await tick(result, 0, 0);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(15);
    expect(calls[0]![1]).toMatchObject({ label: `Next: B1 ${name(result, 1)}`, to: { ex: 1, set: 0 }, at: { i: 0 } });
  });

  it('B1 after A1 closes the round: the longest rest of the members, labelled Next: A2', async () => {
    const { result, calls } = await session(['g', 'g']);
    await tick(result, 0, 0);
    await tick(result, 1, 0);
    expect(calls[1]![0]).toBe(Math.max(rest(name(result, 0)), rest(name(result, 1))));
    expect(calls[1]![1].label).toBe(`Next: A2 ${name(result, 0)}`);
  });

  it('B1 before A1 is a transition rest, and next is A1', async () => {
    const { result, calls } = await session(['g', 'g']);
    await tick(result, 1, 0);
    expect(calls[0]![0]).toBe(15);
    expect(calls[0]![1].label).toBe(`Next: A1 ${name(result, 0)}`);
  });

  it('unequal set counts: a member out of sets drops out of later rounds', async () => {
    const { result, calls } = await session(['g', 'g']);
    await setCount(result, 0, 1);
    await setCount(result, 1, 3);
    await tick(result, 0, 0);
    await tick(result, 1, 0);
    expect(calls[1]![0]).toBe(Math.max(rest(name(result, 0)), rest(name(result, 1))));
    expect(calls[1]![1].label).toBe(`Next: B2 ${name(result, 1)}`);
    await tick(result, 1, 1); // only B is left in round 2, so the round-end rest is B's own
    expect(calls[2]![0]).toBe(rest(name(result, 1)));
  });

  it('the last set of a group is followed by the ungrouped exercise, labelled as before', async () => {
    const { result, calls } = await session(['g', 'g']);
    await setCount(result, 0, 1);
    await setCount(result, 1, 1);
    await tick(result, 0, 0);
    await tick(result, 1, 0);
    expect(calls[1]![1].label).toBe(`Next: ${name(result, 2)}`);
    expect(calls[1]![1].to).toMatchObject({ ex: 2, set: 0 });
  });

  it('the last set of the last exercise starts no rest', async () => {
    const { result, calls } = await session();
    const n = result.current.day.exs.length;
    for (let i = 0; i < n; i++) await setCount(result, i, 1);
    for (let i = 0; i < n; i++) await tick(result, i, 0);
    expect(calls).toHaveLength(n - 1);
  });

  it('rest_off starts no rest', async () => {
    const { result, calls } = await session(['g', 'g'], true);
    await tick(result, 0, 0);
    await tick(result, 1, 0);
    expect(calls).toHaveLength(0);
  });

  it('unticking starts no rest, and ticking again starts one', async () => {
    const { result, calls } = await session(['g', 'g']);
    await tick(result, 0, 0);
    await act(async () => void result.current.tick(0, 0)); // untick
    expect(calls).toHaveLength(1);
    await act(async () => void result.current.tick(0, 0));
    expect(calls).toHaveLength(2);
  });
});

/** Verbatim from the tick of useWorkoutDay.ts before #1182 S4 (git 01c11242), on the exercises after the tick. */
function oldRest(exs: { name: string; sets: { done: boolean }[] }[], i: number) {
  const ex = exs[i]!;
  const nj = ex.sets.findIndex((x) => !x.done);
  const nx = exs.slice(i + 1).find((e) => e.sets.some((x) => !x.done));
  if (nj >= 0) return { seconds: restFor(ex.name, getCatalog().tags), label: `Next: set ${nj + 1} of ${ex.name}`, ex: i, set: nj };
  if (nx) return { seconds: restFor(ex.name, getCatalog().tags), label: `Next: ${nx.name}`, ex: exs.indexOf(nx), set: nx.sets.findIndex((x) => !x.done) };
  return null;
}

describe('ungrouped sessions: the core path equals the old branch logic', () => {
  it('over random tick and untick sequences: dock or not, seconds, label, next exercise and set', async () => {
    let seed = 20261029;
    const rnd = (n: number) => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed % n);
    const { result, calls } = await session();
    const n = result.current.day.exs.length;
    let checked = 0;
    for (let step = 0; step < 120; step++) {
      const i = rnd(n);
      const j = rnd(result.current.day.exs[i]!.sets.length);
      const was = result.current.day.exs[i]!.sets[j]!.done;
      const before = calls.length;
      if (was) await act(async () => void result.current.tick(i, j));
      else await tick(result, i, j);
      const exs = result.current.day.exs;
      if (was || !exs[i]!.sets[j]!.done) {
        expect(calls.length).toBe(before); // an untick starts nothing
        continue;
      }
      const want = oldRest(exs, i);
      if (!want) {
        expect(calls.length).toBe(before);
      } else {
        expect(calls.length).toBe(before + 1);
        const [s, t] = calls[before]!;
        expect({ seconds: s, label: t.label, ex: t.to.ex, set: t.to.set }).toEqual(want);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});


/** Verbatim from WorkoutScreen.tsx before #1182 S4 (git 01c11242): the dock's relabel/advance rule, on the names list. */
type Old = { label: string; from: string[] } | null;
function oldDock(rest: Old, exs: { name: string; sets: { done: boolean }[] }[]): Old {
  if (!rest) return rest;
  const open = new Set(exs.filter((e) => e.sets.some((x) => !x.done)).map((e) => e.name));
  const first = rest.from.find((n) => open.has(n));
  if (first !== rest.from[0] || !first) return first ? { ...rest, label: `Next: ${first}`, from: rest.from.slice(rest.from.indexOf(first)) } : null;
  return rest;
}
/** Verbatim from onPick before S4: the swapped exercise is renamed in the list. */
const swapRename = (r: { label: string; from?: string[] } | null, from: string, to: string) =>
  r?.from?.includes(from) ? { ...r, ...(r.from[0] === from ? { label: `Next: ${to}` } : {}), from: r.from.map((n) => (n === from ? to : n)) } : r;

type Ex = { name: string; sets: { done: boolean; id?: string }[] };
let rowSeq = 0;
const withIds = (e: Ex): Ex => ({ ...e, sets: e.sets.map((s) => ({ ...s, id: s.id ?? `r${rowSeq++}` })) });
type Act = { k: 'tick'; i: number; j: number } | { k: 'rmex'; i: number } | { k: 'rmset'; i: number } | { k: 'addset'; i: number } | { k: 'swap'; i: number; to: string } | { k: 'add'; name: string };

/** Runs the actions on a session with a rest dock, the old logic and the new side by side; returns what each dock shows after every action. */
function dockRun(start: Ex[], acts: Act[]) {
  const exs: Ex[] = structuredClone(start).map(withIds);
  let o: Old = null;
  let n: ReturnType<typeof restTarget> | null = null;
  const trace: { old: string | null; now: string | null; act: Act }[] = [];
  for (const a of acts) {
    if (a.k === 'tick') {
      const s = exs[a.i]?.sets[a.j];
      if (!s) continue;
      s.done = !s.done;
      if (s.done) {
        const nj = exs[a.i]!.sets.findIndex((x) => !x.done);
        const nx = exs.slice(a.i + 1).find((e) => e.sets.some((x) => !x.done));
        const from = exs.slice(a.i).map((e) => e.name);
        if (nj >= 0) o = { label: `Next: set ${nj + 1} of ${exs[a.i]!.name}`, from };
        else if (nx) o = { label: `Next: ${nx.name}`, from };
        const r = restAfterTick(exs.map((e) => ({ name: e.name, sets: e.sets.length })), a.i, a.j, (k, m) => !!exs[k]?.sets[m]?.done, { restOff: false, tags: getCatalog().tags });
        if (r.kind !== 'none' && r.next) n = restTarget(exs as never, a.i, r.next);
      }
    } else if (a.k === 'rmex') {
      if (exs.length > 1) exs.splice(a.i, 1);
    } else if (a.k === 'rmset') {
      if (exs[a.i]!.sets.length > 1) exs[a.i]!.sets.pop();
    } else if (a.k === 'addset') {
      exs[a.i]!.sets.push({ done: false, id: `r${rowSeq++}` });
    } else if (a.k === 'swap') {
      const was = exs[a.i]!.name;
      exs[a.i] = withIds({ name: a.to, sets: [{ done: false }, { done: false }, { done: false }] });
      o = swapRename(o, was, a.to) as Old;
      n = swapRename(n, was, a.to) as typeof n;
    } else {
      exs.push(withIds({ name: a.name, sets: [{ done: false }, { done: false }, { done: false }] }));
    }
    o = oldDock(o, exs);
    if (n) n = restRetarget(exs as never, n);
    trace.push({ old: o && o.label, now: n && n.label, act: a });
  }
  return trace;
}
const exs0 = (...sets: number[]): Ex[] => sets.map((c, i) => ({ name: `E${i}`, sets: Array.from({ length: c }, () => ({ done: false })) }));

describe('ungrouped sessions: the dock while a rest runs equals the old logic', () => {
  const same = (t: ReturnType<typeof dockRun>) => expect(t.map((x) => x.now)).toEqual(t.map((x) => x.old));

  it('over 300 random runs of tick, untick, remove exercise, remove set, add set, swap and add', () => {
    let seed = 1329;
    const rnd = (n: number) => ((seed = (seed * 1664525 + 1013904223) >>> 0), (seed >>> 8) % n);
    let docks = 0;
    for (let run = 0; run < 300; run++) {
      const start = exs0(...Array.from({ length: 3 + rnd(4) }, () => 1 + rnd(3)));
      const acts: Act[] = [];
      let fresh = 100;
      const names = start.map((e) => e.name);
      const len = () => names.length;
      for (let k = 0; k < 25; k++) {
        const i = rnd(len());
        const r = rnd(20);
        if (r < 9) acts.push({ k: 'tick', i, j: rnd(4) });
        else if (r < 11) { acts.push({ k: 'rmex', i }); if (len() > 1) names.splice(i, 1); }
        else if (r < 13) acts.push({ k: 'rmset', i });
        else if (r < 15) acts.push({ k: 'addset', i });
        else if (r < 17) { const to = `S${fresh++}`; acts.push({ k: 'swap', i, to }); names[i] = to; }
        else { const name = rnd(2) ? `S${fresh++}` : `E${rnd(7)}`; if (!names.includes(name)) { acts.push({ k: 'add', name }); names.push(name); } }
      }
      const t = dockRun(start, acts);
      docks += t.filter((x) => x.old).length;
      expect(t.map((x) => x.now)).toEqual(t.map((x) => x.old));
    }
    expect(docks).toBeGreaterThan(500);
  });

  // The reviewer's three screen reproductions (Push B: E0 is the bench, E1 the shoulder press, E2 the fly).
  it('removing the exercise just finished while resting keeps "Next: <Name>"', () => {
    const t = dockRun(exs0(1, 1, 1), [{ k: 'tick', i: 0, j: 0 }, { k: 'rmex', i: 0 }]);
    same(t);
    expect(t[1]!.now).toBe('Next: E1');
  });

  it('untick a set of the finished exercise, then remove the target: Next: <the one after>, not "set 3 of" the finished one', () => {
    const t = dockRun(exs0(3, 1, 1), [{ k: 'tick', i: 0, j: 0 }, { k: 'tick', i: 0, j: 1 }, { k: 'tick', i: 0, j: 2 }, { k: 'tick', i: 0, j: 2 }, { k: 'rmex', i: 1 }]);
    same(t);
    expect(t.at(-1)!.now).toBe('Next: E2');
  });

  it('the target set is the last one and nothing is after it: the dock closes, and Remove last set does not relabel', () => {
    const t = dockRun(exs0(1, 2), [{ k: 'tick', i: 0, j: 0 }, { k: 'tick', i: 1, j: 0 }, { k: 'rmset', i: 1 }, { k: 'tick', i: 1, j: 0 }, { k: 'tick', i: 1, j: 0 }]);
    same(t);
    const u = dockRun(exs0(1, 1, 1), [{ k: 'tick', i: 0, j: 0 }, { k: 'tick', i: 1, j: 0 }, { k: 'tick', i: 0, j: 0 }, { k: 'rmex', i: 2 }, { k: 'tick', i: 2 - 1, j: 0 }]);
    same(u);
    const v = dockRun(exs0(2, 1), [{ k: 'tick', i: 0, j: 0 }, { k: 'rmset', i: 0 }]);
    same(v);
    expect(v[1]!.now).toBe('Next: E1');
  });
});

/** One session with a rest dock and an identity oracle: tick, untick, insert anywhere, remove by name (every copy), remove a set, add a set; names repeat. */
type Dx = { name: string; sets: { done: boolean; id: string }[] };
type DAct = { k: 'tick'; i: number; j: number } | { k: 'ins'; at: number; name: string } | { k: 'rmname'; name: string } | { k: 'rmset'; i: number } | { k: 'addset'; i: number };
const dx = (name: string, n = 1 + (rowSeq++ % 2)): Dx => ({ name, sets: Array.from({ length: n }, () => ({ done: false, id: `d${rowSeq++}` })) });
function identityRun(start: Dx[], acts: DAct[]) {
  const exs = start.slice();
  let n: ReturnType<typeof restTarget> | null = null;
  let tracked: Dx[] = [];
  const out: { got: string | null; want: string | null; act: DAct }[] = [];
  const undone = (e: Dx) => e.sets.some((x) => !x.done);
  for (const act of acts) {
    // Indices wrap to the live length, so random runs stay valid after inserts and removals.
    const a = 'i' in act ? { ...act, i: act.i % exs.length } : act.k === 'ins' ? { ...act, at: act.at % (exs.length + 1) } : act;
    if (a.k === 'tick') {
      const s = exs[a.i]?.sets[a.j];
      if (!s) continue;
      s.done = !s.done;
      if (s.done) {
        const r = restAfterTick(exs.map((e) => ({ name: e.name, sets: e.sets.length })), a.i, a.j, (k, m) => !!exs[k]?.sets[m]?.done, { restOff: false, tags: getCatalog().tags });
        if (r.kind !== 'none' && r.next) {
          n = restTarget(exs as never, a.i, r.next);
          tracked = exs.slice(a.i);
        }
      }
    } else if (a.k === 'ins') exs.splice(a.at, 0, dx(a.name));
    else if (a.k === 'rmname') {
      if (exs.every((e) => e.name === a.name)) continue;
      for (let k = exs.length - 1; k >= 0; k--) if (exs[k]!.name === a.name) exs.splice(k, 1);
    } else if (a.k === 'rmset') {
      if (exs[a.i]!.sets.length > 1) exs[a.i]!.sets.pop();
    } else exs[a.i]!.sets.push({ done: false, id: `d${rowSeq++}` });
    if (n) n = restRetarget(exs as never, n);
    const first = tracked.find((e) => exs.includes(e) && undone(e));
    tracked = first ? tracked.slice(tracked.indexOf(first)) : []; // the list is only ever cut (an exercise reopened later is not taken back)
    out.push({ got: n && n.label.replace(/^Next: (set \d+ of |[A-Z]\d+ )?/, ''), want: first?.name ?? null, act: a });
  }
  return out;
}

describe('ungrouped dock with repeated names, inserts and removals (row-id anchor)', () => {
  const want = (t: ReturnType<typeof identityRun>) => expect(t.map((x) => x.got)).toEqual(t.map((x) => x.want));

  it('a pull inserts before the head while a later copy of its name is open (Lat Pulldown, LR, LR)', () => {
    const t = identityRun([dx('Lat Pulldown', 1), dx('Lateral Raise', 1), dx('Lateral Raise', 1)], [{ k: 'tick', i: 1, j: 0 }, { k: 'ins', at: 1, name: 'Seated Cable Row' }]);
    want(t);
    expect(t[1]!.got).toBe('Lateral Raise');
  });

  it('a can\'t-do swap inserts the replacement after a partly ticked earlier exercise', () => {
    const t = identityRun([dx('Lat Pulldown', 2), dx('Lateral Raise', 1), dx('Lateral Raise', 1)], [{ k: 'tick', i: 0, j: 0 }, { k: 'tick', i: 1, j: 0 }, { k: 'ins', at: 1, name: 'Hack Squat' }]);
    want(t);
    expect(t[2]!.got).toBe('Lateral Raise');
  });

  it('an earlier exercise with another name is removed', () => {
    const t = identityRun([dx('A', 1), dx('S', 1), dx('C', 1), dx('C', 1)], [{ k: 'tick', i: 3, j: 0 }, { k: 'tick', i: 2, j: 0 }, { k: 'rmname', name: 'A' }]);
    want(t);
  });

  it('the head is removed after others ticked: followers are found by their rows, not by an earlier finished copy of their name', () => {
    const t = identityRun([dx('C', 1), dx('A', 2), dx('C', 2), dx('A', 2)], [{ k: 'tick', i: 0, j: 0 }, { k: 'tick', i: 2, j: 0 }, { k: 'tick', i: 1, j: 0 }, { k: 'rmname', name: 'A' }]);
    want(t);
    expect(t[3]!.got).toBe('C');
  });

  it('over 150 random runs with repeated names, inserts anywhere and removals', () => {
    let seed = 4242;
    const rnd = (n: number) => ((seed = (seed * 1664525 + 1013904223) >>> 0), (seed >>> 8) % n);
    const pool = ['A', 'B', 'C'];
    let docks = 0;
    for (let run = 0; run < 150; run++) {
      const start = Array.from({ length: 3 + rnd(4) }, () => dx(pool[rnd(3)]!));
      const acts: DAct[] = [];
      for (let k = 0; k < 20; k++) {
        const r = rnd(12);
        if (r < 6) acts.push({ k: 'tick', i: rnd(9), j: rnd(3) });
        else if (r < 8) acts.push({ k: 'ins', at: rnd(9), name: pool[rnd(3)]! });
        else if (r < 9) acts.push({ k: 'rmname', name: pool[rnd(3)]! });
        else if (r < 10) acts.push({ k: 'rmset', i: rnd(9) });
        else acts.push({ k: 'addset', i: rnd(9) });
      }
      const t = identityRun(start, acts);
      docks += t.filter((x) => x.want).length;
      want(t);
    }
    expect(docks).toBeGreaterThan(300);
  });
});

describe('the dock follows the session by position (#1329)', () => {
  const ex = (name: string, ...done: boolean[]) => ({ name, sets: done.map((d) => ({ done: d })) }) as never;
  const at = (i: number, name: string, to: { ex: number; set: number; name: string }, label = '', from?: string[]): RestNext => ({ at: { i, name }, to, label, ...(from ? { from } : {}) });

  it('ungrouped, two exercises with one name: a finished one does not keep the earlier open one looking next', () => {
    // [Bench open, Squat done, Bench done]: the dock for the last Bench closes; by name the open first Bench would stay as "Next: Bench".
    const exs = [ex('Bench', false), ex('Squat', true), ex('Bench', true)];
    expect(restRetarget(exs, at(2, 'Bench', { ex: 2, set: 0, name: 'Bench' }, 'Next: set 1 of Bench', ['Bench']))).toBeNull();
  });

  it('ungrouped, a finished first one is not stood in for by a later copy of its name: the exercises between stay next', () => {
    // [Lateral Raise 1 set, Assisted Dips 1 set, Lateral Raise 2 sets]: both Lateral Raises done, Dips open. The base keeps "Next: Assisted Dips".
    const exs = [ex('Lateral Raise', true), ex('Assisted Dips', false), ex('Lateral Raise', true, true)];
    const r = at(0, 'Lateral Raise', { ex: 1, set: 0, name: 'Assisted Dips' }, 'Next: Assisted Dips', ['Lateral Raise', 'Assisted Dips', 'Lateral Raise']);
    expect(restRetarget(exs, r)).toMatchObject({ label: 'Next: Assisted Dips', at: { i: 1, name: 'Assisted Dips' }, from: ['Assisted Dips', 'Lateral Raise'] });
    // The later copy still open: Dips stays first, the later copy is only after it.
    expect(restRetarget([ex('Lateral Raise', true), ex('Assisted Dips', false), ex('Lateral Raise', false)], r)).toMatchObject({ label: 'Next: Assisted Dips' });
  });

  it('ungrouped, the first one removed together with an earlier copy of its name: its followers are looked for from the start', () => {
    // [Bench, Bench, Machine Shoulder Press, Pec Deck Fly]: the second Bench ticked (at 1), then every Bench removed. The base shows the press, not the fly.
    const exs = [ex('Machine Shoulder Press', false), ex('Pec Deck Fly', false)];
    const r = at(1, 'Bench', { ex: 1, set: 1, name: 'Bench' }, 'Next: set 2 of Bench', ['Bench', 'Machine Shoulder Press', 'Pec Deck Fly']);
    expect(restRetarget(exs, r)).toMatchObject({ label: 'Next: Machine Shoulder Press', at: { i: 0, name: 'Machine Shoulder Press' } });
  });

  it('ungrouped, the first one is found at its own place, or the nearest copy after it when a pull put a new exercise before it', () => {
    const r = at(0, 'B', { ex: 0, set: 1, name: 'B' }, 'Next: set 2 of B', ['B', 'C']);
    expect(restRetarget([ex('X', false), ex('B', true), ex('C', false)], r)).toMatchObject({ label: 'Next: C', at: { i: 2, name: 'C' } });
    expect(restRetarget([ex('X', false), ex('B', false, false), ex('C', false)], r)).toMatchObject({ at: { i: 1, name: 'B' }, label: 'Next: set 2 of B' });
    // An earlier copy of the first one's name is not used when `at` points at a later one.
    const r2 = at(2, 'B', { ex: 2, set: 1, name: 'B' }, 'Next: set 2 of B', ['B', 'C']);
    expect(restRetarget([ex('B', false), ex('Y', true), ex('B', true), ex('C', false)], r2)).toMatchObject({ label: 'Next: C', at: { i: 3, name: 'C' } });
  });

  it('ungrouped, a name listed twice matches two different exercises in order', () => {
    const r = at(0, 'B', { ex: 0, set: 1, name: 'B' }, 'Next: set 2 of B', ['B', 'B']);
    expect(restRetarget([ex('B', true), ex('B', false)], r)).toMatchObject({ at: { i: 1, name: 'B' }, from: ['B'] });
  });

  it('with row ids, an entry whose rows are all gone is found by name without trusting at.i', () => {
    const r = { ...at(2, 'B', { ex: 2, set: 0, name: 'B' }, 'Next: set 1 of B', ['B']), ids: [['gone']] };
    expect(restRetarget([ex('B', false), ex('X', true), ex('B', true)], r)).toBe(r);
  });

  it('with row ids, an entry renamed by a swap (its old exercise stays, finished) is found by its new name', () => {
    const r = { ...at(0, 'Press', { ex: 0, set: 1, name: 'Press' }, 'Next: Seated', ['Seated', 'Fly']), ids: [['p1', 'p2'], ['f1']] };
    const exs = [{ name: 'Press', sets: [{ done: true, id: 'p1' }] }, { name: 'Seated', sets: [{ done: false, id: 'n1' }] }, { name: 'Fly', sets: [{ done: false, id: 'f1' }] }] as never;
    expect(restRetarget(exs, r)).toBe(r);
  });

  it('a stored rest with row ids parses; ids of the wrong shape or length are rejected', () => {
    const base = { id: 1, end: 5000, total: 90, label: 'Next: B', from: ['B', 'C'], date: DATE };
    expect(parseRest(JSON.stringify({ ...base, ids: [['a'], ['b', 'c']] }), DATE, 1000)?.ids).toEqual([['a'], ['b', 'c']]);
    expect(parseRest(JSON.stringify({ ...base, ids: [['a']] }), DATE, 1000)).toBeNull();
    expect(parseRest(JSON.stringify({ ...base, ids: [['a'], [1]] }), DATE, 1000)).toBeNull();
  });

  it('grouped: two exercises with one name cannot stand in for each other either', () => {
    const exs = [ex('Bench', false), ex('Squat', true), ex('Row', true), ex('Bench', true)];
    expect(restRetarget(exs, at(1, 'Squat', { ex: 3, set: 0, name: 'Bench' }))).toBeNull();
  });

  it('grouped: the stored target is kept while its set is open, and moves on to the first undone set after it otherwise', () => {
    const r = at(0, 'A', { ex: 1, set: 0, name: 'B' }, 'Next: B');
    expect(restRetarget([ex('A', true), ex('B', false), ex('C', false)], r)).toBe(r);
    expect(restRetarget([ex('A', true), ex('B', true), ex('C', false)], r)).toMatchObject({ label: 'Next: C', to: { ex: 2, set: 0, name: 'C' } });
  });

  it('grouped: an earlier exercise removed shifts the ticked one; it is found again by name, not taken from its old place', () => {
    // [X, A1 A2, B1 B2] in one group A+B; A1 ticked, B1 the target. X removed: A is at 0 (stored at.i 1 is now B).
    const grp = (name: string, ...done: boolean[]) => ({ name, group: 'g', sets: done.map((d) => ({ done: d })) }) as never;
    const r = at(1, 'A', { ex: 2, set: 0, name: 'B' }, 'Next: B1 B');
    const t = restRetarget([grp('A', true, false), grp('B', true, false)], r);
    expect(t).toMatchObject({ at: { i: 0, name: 'A' }, label: 'Next: A2 A', to: { ex: 0, set: 1 } });
  });

  it('grouped: a removed ticked exercise does not bring back the "set N of" wording on the exercise now in its place', () => {
    const grp = (name: string, ...done: boolean[]) => ({ name, group: 'g', sets: done.map((d) => ({ done: d })) }) as never;
    const r = at(2, 'Gone', { ex: 3, set: 0, name: 'Z' }, 'Next: Z');
    expect(restRetarget([grp('A', false), grp('B', false), ex('C', true, false)], r)?.label).not.toMatch(/set \d of/);
  });

  it('a stored rest from before this change (names list, no position) still parses and follows the old rule', () => {
    const old = JSON.stringify({ id: 1, end: 5000, total: 90, label: 'Next: B', from: ['B', 'C'], date: DATE });
    expect(parseRest(old, DATE, 1000)).toMatchObject({ label: 'Next: B', from: ['B', 'C'] });
    const r = parseRest(old, DATE, 1000) as unknown as RestNext;
    expect(restRetarget([ex('A', true), ex('B', true), ex('C', false)], r)).toMatchObject({ label: 'Next: C' });
    const now = JSON.stringify({ id: 1, end: 5000, total: 90, label: 'Next: B', at: { i: 0, name: 'A' }, to: { ex: 1, set: 0, name: 'B' }, date: DATE });
    expect(parseRest(now, DATE, 1000)?.to).toEqual({ ex: 1, set: 0, name: 'B' });
    expect(parseRest(JSON.stringify({ ...JSON.parse(now), to: { ex: 'x' } }), DATE, 1000)).toBeNull();
  });
});
