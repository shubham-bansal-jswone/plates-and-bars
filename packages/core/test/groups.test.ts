import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GROUP_MAX, GROUP_MIN, GROUP_TRANSITION_SEC, groupLabels, nextInRound, normalizeGroups, REST_COMPOUND_SEC, REST_OTHER_SEC, restAfterTick, restFor, type GroupEx } from '../src/index';

type Row = [string, number, string | null];
const v = JSON.parse(readFileSync(resolve(__dirname, '../../api/test-vectors/groups.json'), 'utf8')) as {
  limits: { group_min: number; group_max: number; transition_sec: number };
  configs: { note: string; ex: Row[]; labels: (string | null)[]; normalized: (string | null)[] }[];
  order: { note: string; ex: Row[]; sequence: [number, number][] }[];
};
const mk = (rows: Row[]): GroupEx[] => rows.map(([name, sets, group]) => ({ name, sets, group }));
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
    for (let n = nextInRound(ex, 0, 0); n; n = nextInRound(ex, n.ex, n.set)) seq.push([n.ex, n.set]);
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
    it('treats empty and non-string ids as ungrouped', () => {
      expect(normalizeGroups([{ name: 'a', sets: 1, group: '' }, { name: 'b', sets: 1, group: '' }]).map((e) => e.group)).toEqual(['', '']);
    });
  });

  describe('restAfterTick', () => {
    it('ungrouped equals restFor exactly', () => {
      const ex = mk([['sq', 3, null], ['curl', 2, null], ['zzz', 1, null]]);
      for (let i = 0; i < ex.length; i++)
        for (let j = 0; j < (ex[i] as GroupEx).sets; j++) {
          const r = restAfterTick(ex, i, j, on);
          expect(r.seconds).toBe(restFor((ex[i] as GroupEx).name, tags));
          expect(r.kind).toBe('round');
        }
      expect(restAfterTick(ex, 1, 0, on).seconds).toBe(REST_OTHER_SEC);
      expect(restAfterTick(ex, 0, 0, on).seconds).toBe(REST_COMPOUND_SEC);
    });
    it('restOff disables everything but still reports next', () => {
      const ex = mk([['sq', 2, 'g'], ['curl', 2, 'g']]);
      expect(restAfterTick(ex, 0, 0, { ...on, restOff: true })).toEqual({ kind: 'none', seconds: 0, next: { ex: 1, set: 0 } });
      expect(restAfterTick(ex, 1, 0, { ...on, restOff: true }).seconds).toBe(0);
    });
    it('transition mid-round, longest restFor at round end', () => {
      const ex = mk([['curl', 2, 'g'], ['sq', 2, 'g']]);
      expect(restAfterTick(ex, 0, 0, on)).toEqual({ kind: 'transition', seconds: 15, next: { ex: 1, set: 0 } });
      // the earlier member is the cheap one: end-of-round rest is the compound's, and the reverse order agrees
      expect(restAfterTick(ex, 1, 0, on)).toEqual({ kind: 'round', seconds: 150, next: { ex: 0, set: 1 } });
      const rev = mk([['sq', 2, 'g'], ['curl', 2, 'g']]);
      expect(restAfterTick(rev, 1, 0, on).seconds).toBe(150);
      const cheap = mk([['curl', 2, 'g'], ['ext', 2, 'g']]);
      expect(restAfterTick(cheap, 1, 0, on).seconds).toBe(75);
    });
    it('unequal set counts: members that ran out do not count', () => {
      const ex = mk([['sq', 1, 'g'], ['curl', 3, 'g']]);
      expect(restAfterTick(ex, 0, 0, on).kind).toBe('transition');
      expect(restAfterTick(ex, 1, 0, on)).toEqual({ kind: 'round', seconds: 150, next: { ex: 1, set: 1 } });
      // round 2: sq is out, curl alone ends the round at its own rest
      expect(restAfterTick(ex, 1, 1, on)).toEqual({ kind: 'round', seconds: 75, next: { ex: 1, set: 2 } });
      // last set of the group: next is past the group (none here)
      expect(restAfterTick(ex, 1, 2, on).next).toBeNull();
    });
    it('a 3-member group has two transitions then a round', () => {
      const ex = mk([['curl', 1, 'g'], ['ext', 1, 'g'], ['row', 1, 'g'], ['sq', 1, null]]);
      expect(restAfterTick(ex, 0, 0, on).kind).toBe('transition');
      expect(restAfterTick(ex, 1, 0, on).kind).toBe('transition');
      expect(restAfterTick(ex, 2, 0, on)).toEqual({ kind: 'round', seconds: 150, next: { ex: 3, set: 0 } });
    });
    it('an invalid (singleton) group behaves ungrouped', () => {
      const ex = mk([['curl', 2, 'g'], ['sq', 2, null]]);
      expect(restAfterTick(ex, 0, 0, on)).toEqual({ kind: 'round', seconds: 75, next: { ex: 0, set: 1 } });
    });
  });
});
