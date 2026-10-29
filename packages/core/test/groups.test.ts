import { readFileSync } from 'fs';
import { resolve } from 'path';
import { canGroupWithNext, GROUP_MAX, GROUP_MIN, GROUP_TRANSITION_SEC, groupLabels, nextInRound, normalizeGroups, restAfterTick, restFor, type GroupEx } from '../src/index';

type Row = [string, number, unknown];
const v = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/spec/golden/groups.json'), 'utf8')) as {
  limits: { group_min: number; group_max: number; transition_sec: number };
  configs: { note: string; ex: Row[]; labels: (string | null)[]; normalized: (string | null)[] }[];
  order: { note: string; ex: Row[]; done?: [number, number][]; sequence: [number, number][] }[];
};
const mk = (rows: Row[]): GroupEx[] => rows.map(([name, sets, group]) => ({ name, sets, group: group as string | null }));
const tg = (pattern: string) => ({ pattern, family: '', equipment: '', difficulty: 1, primary: [], secondary: [], joints: [] });
// 'sq' and 'row' are compound (150), 'curl' and 'ext' are not (75).
const tags = { sq: tg('squat'), row: tg('h-pull'), curl: tg('curl'), ext: tg('ext') };
const on = { restOff: false, tags };

describe('groups (#1182)', () => {
  it('constants match the vectors', () => {
    expect([GROUP_MIN, GROUP_MAX, GROUP_TRANSITION_SEC]).toEqual([v.limits.group_min, v.limits.group_max, v.limits.transition_sec]);
  });
  it.each(v.configs.map((c) => [c.note, c] as const))('config: %s', (_n, c) => {
    const ex = mk(c.ex);
    expect(groupLabels(ex)).toEqual(c.labels);
    expect(normalizeGroups(ex).map((e) => e.group)).toEqual(c.normalized);
  });
  it.each(v.order.map((c) => [c.note, c] as const))('order: %s', (_n, c) => {
    const ex = mk(c.ex);
    const seq: [number, number][] = [[0, 0]];
    const d = new Set(['0,0', ...(c.done ?? []).map(([k, s]) => `${k},${s}`)]);
    for (let n = nextInRound(ex, 0, 0, (k, s) => d.has(`${k},${s}`)); n; n = nextInRound(ex, n.ex, n.set, (k, s) => d.has(`${k},${s}`))) {
      seq.push([n.ex, n.set]);
      d.add(`${n.ex},${n.set}`);
    }
    expect(seq).toEqual(c.sequence);
  });

  describe('normalizeGroups', () => {
    it('does not mutate, keeps ungrouped objects and key set', () => {
      const ex: GroupEx[] = [{ name: 'a', sets: 1 }, { name: 'b', sets: 1, group: 'g' }];
      const copy = JSON.stringify(ex);
      const out = normalizeGroups(ex);
      expect(JSON.stringify(ex)).toBe(copy);
      expect(out[0]).toBe(ex[0]);
      expect('group' in (out[0] as GroupEx)).toBe(false);
      expect(out[1]).toEqual({ name: 'b', sets: 1, group: null });
    });
    it('is idempotent and never changes order or names (all configs, random)', () => {
      const lists = v.configs.map((c) => mk(c.ex));
      let seed = 7;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let t = 0; t < 300; t++) lists.push(Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, i) => ({ name: `e${i}`, sets: 1 + Math.floor(rnd() * 4), group: rnd() < 0.2 ? null : 'abc'[Math.floor(rnd() * 3)] as string })));
      for (const ex of lists) {
        const once = normalizeGroups(ex);
        expect(normalizeGroups(once)).toEqual(once);
        expect(once.map((e) => e.name)).toEqual(ex.map((e) => e.name));
        // every surviving group is a single contiguous run of 2 to 6
        const ids = once.map((e) => e.group ?? null);
        for (const id of new Set(ids.filter((x) => x !== null))) {
          const at = ids.map((x, i) => (x === id ? i : -1)).filter((i) => i >= 0);
          expect(at.length).toBeGreaterThanOrEqual(GROUP_MIN);
          expect(at.length).toBeLessThanOrEqual(GROUP_MAX);
          expect((at[at.length - 1] as number) - (at[0] as number) + 1).toBe(at.length);
        }
      }
    });
    it('writes null for a present id the contract pattern rejects, leaves absent and null alone', () => {
      const bad = ['', 5, 'has space', 'x'.repeat(37), {}] as unknown as string[];
      for (const g of bad) expect(normalizeGroups([{ name: 'a', sets: 1, group: g }])[0]).toEqual({ name: 'a', sets: 1, group: null });
      expect(normalizeGroups([{ name: 'a', sets: 1, group: 'x'.repeat(36) }, { name: 'b', sets: 1, group: 'x'.repeat(36) }]).map((e) => e.group)).toEqual(['x'.repeat(36), 'x'.repeat(36)]);
      const plain = { name: 'a', sets: 1, group: null };
      expect(normalizeGroups([plain])[0]).toBe(plain);
    });
  });

  describe('restAfterTick', () => {
    const fin = (marks: [number, number][] = []) => {
      const d = new Set(marks.map(([k, s]) => `${k},${s}`));
      return (k: number, s: number) => d.has(`${k},${s}`);
    };
    const none = { kind: 'none', seconds: 0 };

    // The app's rule, transcribed from apps/mobile/src/workout/useWorkoutDay.ts:451-455 (after `s.done = true`):
    //   nj = ex.sets.findIndex(x => !x.done); nx = d.exs.slice(i + 1).find(e => e.sets.some(x => !x.done));
    //   if (nj >= 0) startRest(... `Next: set ${nj + 1}`); else if (nx) startRest(... `Next: ${nx.name}`);  (else no rest)
    // Ramp ticks (rampTick) and warm-ups never reach that code, so no rest starts for them and core is not asked.
    type Ex = { name: string; sets: boolean[] };
    function app(list: Ex[], i: number, j: number, restOff: boolean) {
      const ex = list[i] as Ex;
      const sets = ex.sets.map((x, n) => x || n === j);
      const nj = sets.findIndex((x) => !x);
      const nxi = list.findIndex((e, k) => k > i && e.sets.some((x) => !x));
      if (restOff || (nj < 0 && nxi < 0)) return { rest: false as const };
      const next = nj >= 0 ? { ex: i, set: nj } : { ex: nxi, set: (list[nxi] as Ex).sets.findIndex((x) => !x) };
      return { rest: true as const, seconds: restFor(ex.name, tags), next };
    }
    const viaCore = (list: Ex[], i: number, j: number, restOff: boolean) => {
      const exs = list.map((e) => ({ name: e.name, sets: e.sets.length }));
      const r = restAfterTick(exs, i, j, (k, s) => (list[k] as Ex).sets[s] as boolean, { restOff, tags });
      return r.kind === 'none' ? { rest: false as const } : { rest: true as const, seconds: r.seconds, next: r.next };
    };
    const names = ['sq', 'curl', 'row', 'zzz'];
    it.each([
      ['normal tick', [[false, false, false], [false]], 0, 0, false],
      ['out of order: set 3 before 2', [[true, false, false, false]], 0, 2, false],
      ['last set of an exercise', [[true, true, false], [false, false]], 0, 2, false],
      ['last set of the last exercise', [[false], [true, true, false]], 1, 2, false],
      ['later exercises already finished', [[false, false], [true, true], [true]], 0, 1, false],
      ['a later exercise finished, one beyond open', [[false], [true], [false, false]], 0, 0, false],
      ['rest off', [[false, false], [false]], 0, 0, true],
    ] as [string, boolean[][], number, number, boolean][])('ungrouped parity with the app: %s', (_n, sets, i, j, off) => {
      const list = sets.map((s, k) => ({ name: names[k] as string, sets: s }));
      expect(viaCore(list, i, j, off)).toEqual(app(list, i, j, off));
    });
    it('ungrouped parity with the app: every done state of random lists', () => {
      let seed = 11;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let t = 0; t < 2000; t++) {
        const list = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) => ({ name: names[k] as string, sets: Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => rnd() < 0.5) }));
        const i = Math.floor(rnd() * list.length);
        const j = Math.floor(rnd() * (list[i] as Ex).sets.length);
        const off = rnd() < 0.2;
        expect(viaCore(list, i, j, off)).toEqual(app(list, i, j, off));
      }
    });

    it('restOff disables everything but still reports next', () => {
      const ex = mk([['sq', 2, 'g'], ['curl', 2, 'g']]);
      expect(restAfterTick(ex, 0, 0, fin(), { ...on, restOff: true })).toEqual({ ...none, next: { ex: 1, set: 0 } });
      expect(restAfterTick(ex, 1, 0, fin([[0, 0]]), { ...on, restOff: true }).seconds).toBe(0);
    });
    it('transition mid-round, longest restFor at round end', () => {
      const ex = mk([['curl', 2, 'g'], ['sq', 2, 'g']]);
      expect(restAfterTick(ex, 0, 0, fin(), on)).toEqual({ kind: 'transition', seconds: 15, next: { ex: 1, set: 0 } });
      expect(restAfterTick(ex, 1, 0, fin([[0, 0]]), on)).toEqual({ kind: 'round', seconds: 150, next: { ex: 0, set: 1 } });
      const rev = mk([['sq', 2, 'g'], ['curl', 2, 'g']]);
      expect(restAfterTick(rev, 1, 0, fin([[0, 0]]), on).seconds).toBe(150);
      const cheap = mk([['curl', 2, 'g'], ['ext', 2, 'g']]);
      expect(restAfterTick(cheap, 1, 0, fin([[0, 0]]), on).seconds).toBe(75);
    });
    it('ticking B1 before A1 is a transition, next is A1; A1 then closes the round', () => {
      const ex = mk([['curl', 2, 'g'], ['sq', 2, 'g']]);
      expect(restAfterTick(ex, 1, 0, fin(), on)).toEqual({ kind: 'transition', seconds: 15, next: { ex: 0, set: 0 } });
      expect(restAfterTick(ex, 0, 0, fin([[1, 0]]), on)).toEqual({ kind: 'round', seconds: 150, next: { ex: 0, set: 1 } });
      // an earlier round still open keeps a later tick a transition
      expect(restAfterTick(ex, 0, 1, fin([[1, 0], [1, 1]]), on)).toEqual({ kind: 'transition', seconds: 15, next: { ex: 0, set: 0 } });
    });
    it('unequal set counts: members that ran out do not count', () => {
      const ex = mk([['sq', 1, 'g'], ['curl', 3, 'g']]);
      expect(restAfterTick(ex, 0, 0, fin(), on).kind).toBe('transition');
      expect(restAfterTick(ex, 1, 0, fin([[0, 0]]), on)).toEqual({ kind: 'round', seconds: 150, next: { ex: 1, set: 1 } });
      expect(restAfterTick(ex, 1, 1, fin([[0, 0], [1, 0]]), on)).toEqual({ kind: 'round', seconds: 75, next: { ex: 1, set: 2 } });
      expect(restAfterTick(ex, 1, 2, fin([[0, 0], [1, 0], [1, 1]]), on)).toEqual({ ...none, next: null });
    });
    it('a 3-member group has two transitions then a round; no rest after the last set', () => {
      const ex = mk([['curl', 1, 'g'], ['ext', 1, 'g'], ['row', 1, 'g'], ['sq', 1, null]]);
      expect(restAfterTick(ex, 0, 0, fin(), on).kind).toBe('transition');
      expect(restAfterTick(ex, 1, 0, fin([[0, 0]]), on).kind).toBe('transition');
      expect(restAfterTick(ex, 2, 0, fin([[0, 0], [1, 0]]), on)).toEqual({ kind: 'round', seconds: 150, next: { ex: 3, set: 0 } });
      expect(restAfterTick(ex, 2, 0, fin([[0, 0], [1, 0], [3, 0]]), on)).toEqual({ ...none, next: null });
    });
    it('after a group the next skips finished exercises', () => {
      const ex = mk([['curl', 1, 'g'], ['ext', 1, 'g'], ['sq', 1, null], ['row', 1, null]]);
      expect(nextInRound(ex, 1, 0, fin([[0, 0], [2, 0]]))).toEqual({ ex: 3, set: 0 });
    });
    it('an invalid (singleton) group behaves ungrouped', () => {
      const ex = mk([['curl', 2, 'g'], ['sq', 2, null]]);
      expect(restAfterTick(ex, 0, 0, fin(), on)).toEqual({ kind: 'round', seconds: 75, next: { ex: 0, set: 1 } });
    });
    it('a split id is ungrouped in order, rest and labels alike', () => {
      const ex = mk([['curl', 2, 'g'], ['ext', 2, 'g'], ['zzz', 2, null], ['curl', 2, 'g'], ['ext', 2, 'g']]);
      expect(groupLabels(ex)).toEqual([null, null, null, null, null]);
      expect(nextInRound(ex, 0, 0, fin())).toEqual({ ex: 0, set: 1 });
      expect(restAfterTick(ex, 0, 0, fin(), on)).toEqual({ kind: 'round', seconds: 75, next: { ex: 0, set: 1 } });
    });
    it('a seven-member run is ungrouped as given (normalize first)', () => {
      const ex = mk(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => [n, 2, 'g'] as Row));
      expect(nextInRound(ex, 0, 0, fin())).toEqual({ ex: 0, set: 1 });
    });
    it('an empty id is not a group', () => {
      const ex = mk([['curl', 2, ''], ['ext', 2, '']]);
      expect(nextInRound(ex, 0, 0, fin())).toEqual({ ex: 0, set: 1 });
      expect(groupLabels(ex)).toEqual([null, null]);
    });
    it('entering a group from outside uses round order, also after a finished group', () => {
      const ex = mk([['x', 1, null], ['a', 2, 'g'], ['b', 2, 'g']]);
      expect(nextInRound(ex, 0, 0, fin([[1, 0]]))).toEqual({ ex: 2, set: 0 });
      expect(nextInRound(ex, 2, 0, fin([[0, 0], [1, 0]]))).toEqual({ ex: 1, set: 1 });
      const two = mk([['a', 1, 'g'], ['b', 1, 'g'], ['c', 2, 'h'], ['d', 2, 'h']]);
      expect(nextInRound(two, 1, 0, fin([[0, 0], [2, 0]]))).toEqual({ ex: 3, set: 0 });
    });
    it('a set index that exists on another member but not on the ticked one is treated as a normal round', () => {
      const ex = mk([['curl', 1, 'g'], ['sq', 3, 'g']]);
      expect(restAfterTick(ex, 0, 2, fin([[0, 0]]), on)).toEqual({ kind: 'transition', seconds: 15, next: { ex: 1, set: 0 } });
      expect(restAfterTick(ex, 0, 2, fin([[1, 2]]), on)).toEqual({ kind: 'transition', seconds: 15, next: { ex: 0, set: 0 } });
      expect(restAfterTick(mk([['a', 1, null], ['b', 3, null]]), 0, 2, fin(), on)).toEqual({ ...none, next: { ex: 0, set: 0 } });
    });
    it('a set index past every member gives kind none, never -Infinity', () => {
      const ex = mk([['a', 1, 'g'], ['b', 1, 'g']]);
      expect(restAfterTick(ex, 1, 5, fin([[0, 0], [1, 0]]), on)).toEqual({ ...none, next: null });
      expect(restAfterTick(ex, 1, 5, fin(), on)).toEqual({ ...none, next: { ex: 0, set: 0 } });
      expect(restAfterTick(ex, 0, 1, fin([[0, 0], [1, 0]]), on)).toEqual({ ...none, next: null });
      expect(restAfterTick(mk([['a', 1, null], ['b', 1, null]]), 0, 4, fin(), on)).toEqual({ ...none, next: { ex: 0, set: 0 } });
      expect(restAfterTick(ex, 9, 0, fin(), on)).toEqual({ ...none, next: null });
    });
  });
});

describe('canGroupWithNext (#1182 S5)', () => {
  const ex = (...r: ([string, number] | [string, number, string | null])[]): GroupEx[] => r.map(([name, sets, group]) => ({ name, sets, group: group ?? null }));
  const none = () => false;
  const can = (e: GroupEx[], i: number, done: (k: number, s: number) => boolean = none) => canGroupWithNext(e, i, done);

  it('two ungrouped exercises may be grouped', () => expect(can(ex(['a', 3], ['b', 3]), 0)).toEqual({ ok: true }));
  it('the last exercise has no next one', () => expect(can(ex(['a', 3], ['b', 3]), 1)).toEqual({ ok: false, why: 'last', ex: 1 }));
  it('an ungrouped exercise joins the group that starts at the next one', () => expect(can(ex(['a', 3], ['b', 3, 'g'], ['c', 3, 'g']), 0)).toEqual({ ok: true }));
  it('the last member takes an ungrouped next exercise', () => expect(can(ex(['a', 3, 'g'], ['b', 3, 'g'], ['c', 3]), 1)).toEqual({ ok: true }));
  it('a member that is not the last has no offer', () => expect(can(ex(['a', 3, 'g'], ['b', 3, 'g'], ['c', 3]), 0)).toEqual({ ok: false, why: 'inner', ex: 0 }));
  it('two groups are not merged', () => expect(can(ex(['a', 3, 'g'], ['b', 3, 'g'], ['c', 3, 'h'], ['d', 3, 'h']), 1)).toEqual({ ok: false, why: 'other', ex: 2 }));
  it('the cap counts the result: 5 + 1 fits, 5 + 2 and 6 + 1 do not', () => {
    const five = (): [string, number, string][] => ['a', 'b', 'c', 'd', 'e'].map((n) => [n, 3, 'g']);
    expect(can(ex(...five(), ['f', 3]), 4)).toEqual({ ok: true });
    expect(can(ex(['x', 3], ...five()), 0).ok).toBe(true); // 1 + 5
    expect(can(ex(['x', 3], ['y', 3, 'h'], ['z', 3, 'h'], ['w', 3, 'h'], ['v', 3, 'h'], ['u', 3, 'h'], ['t', 3, 'h']), 0)).toEqual({ ok: false, why: 'full', ex: 0 }); // 1 + 6
    expect(can(ex(...five(), ['f', 3, 'g'], ['z', 3]), 5)).toEqual({ ok: false, why: 'full', ex: 5 }); // a group of 6 takes no seventh
  });
  it('an exercise with every set done cannot join, and the reason names it', () => {
    const e = ex(['a', 2], ['b', 2]);
    expect(can(e, 0, (k) => k === 0)).toEqual({ ok: false, why: 'done', ex: 0 });
    expect(can(e, 0, (k) => k === 1)).toEqual({ ok: false, why: 'done', ex: 1 });
    expect(can(e, 0, (k, s) => k === 0 && s === 0).ok).toBe(true); // one set ticked is not done
  });
  it('the same name twice is refused, also across a joined group', () => {
    expect(can(ex(['a', 3], ['a', 3]), 0)).toEqual({ ok: false, why: 'same', ex: 0 });
    expect(can(ex(['a', 3, 'g'], ['b', 3, 'g'], ['a', 3]), 1)).toEqual({ ok: false, why: 'same', ex: 2 });
  });
  it('a group that is not a valid run counts as ungrouped', () => expect(can(ex(['a', 3, 'g'], ['b', 3]), 0)).toEqual({ ok: true }));
  it('the same-name reason names the exercise that would join', () => {
    expect(can(ex(['a', 3], ['b', 3, 'g'], ['a', 3, 'g']), 0)).toEqual({ ok: false, why: 'same', ex: 0 }); // joins as first member
    expect(can(ex(['a', 3, 'g'], ['b', 3, 'g'], ['a', 3]), 1)).toEqual({ ok: false, why: 'same', ex: 2 }); // appended
    expect(can(ex(['a', 3], ['a', 3]), 0).ok).toBe(false);
  });
  it('an exercise with no sets is not finished', () => expect(can(ex(['a', 0], ['b', 2]), 0)).toEqual({ ok: true }));
  it('a singleton id is no group: the next valid group can still be joined', () => expect(can(ex(['a', 3, 'g'], ['b', 3, 'h'], ['c', 3, 'h']), 0)).toEqual({ ok: true }));
});
