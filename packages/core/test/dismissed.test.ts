import content from '../../../content/exercises.json';
import { addDays, dismissKey, DISMISSED_MAX_BYTES, DISMISSED_MAX_KEYS, mondayOf, pruneDismissed, type ExerciseCatalog, type LiftRecord, type SessionLog } from '../src/index';
import { metaTable, rng } from './prototype-plan';
import { loadReentry } from './prototype-reentry';
import { loadStalls } from './prototype-stalls';

// The prototype never prunes `adj.dismissed` (#721); these tests pin that pruning never changes which card the
// prototype's own matching (`adjCard`, `stallCard`: `A.dismissed[key]`) shows, and that the map stays bounded.
const catalog = content as ExerciseCatalog;
const TODAY = '2026-10-17';
const bytes = (d: Record<string, unknown>): number => Buffer.byteLength(JSON.stringify(d), 'utf8');

describe('pruneDismissed', () => {
  it('drops keys dated more than 90 days before today; keeps 90 days and later', () => {
    const cutoff = addDays(TODAY, -90);
    expect(cutoff).toBe('2026-07-19');
    expect(pruneDismissed({ 'ci:2026-07-18': true, 'ci:2026-07-19': true, 'ci:2026-10-12': true }, TODAY)).toEqual({ 'ci:2026-07-19': true, 'ci:2026-10-12': true });
    const d = { 'kcal:2026-07-19': true, 'kcal:2026-10-12': true, 'missed:2026-10-30': true };
    expect(pruneDismissed(d, TODAY)).toEqual(d);
  });

  it('keeps the newest key of each group however old: a break or lift date can be any age while the user is away', () => {
    const d = {
      'break:2026-01-02': true,
      'break:2026-03-01': true,
      'stall:Hack Squat:2026-02-01': true,
      'stall:Hack Squat:2026-04-01': true,
      'up:Hack Squat:2026-01-01': true,
      'deload:2026-05-04': true,
      'deload:2026-10-12': true,
    };
    expect(pruneDismissed(d, TODAY)).toEqual({ 'break:2026-03-01': true, 'stall:Hack Squat:2026-04-01': true, 'up:Hack Squat:2026-01-01': true, 'deload:2026-10-12': true });
  });

  it('groups on everything before the trailing date, so a name with colons is its own group', () => {
    const d = { 'stall:A:B:2026-01-01': true, 'stall:A:2026-01-02': true, 'stall:A:B:2026-01-03': true };
    expect(pruneDismissed(d, TODAY)).toEqual({ 'stall:A:2026-01-02': true, 'stall:A:B:2026-01-03': true });
  });

  it('keeps keys without a date and drops falsy entries; empty and missing maps give {}', () => {
    expect(pruneDismissed({ legacy: true, 'odd:2026-1-1': true, gone: false, zero: 0, 'ci:2026-10-12': true }, TODAY)).toEqual({ legacy: true, 'odd:2026-1-1': true, 'ci:2026-10-12': true });
    expect(pruneDismissed({}, TODAY)).toEqual({});
    expect(pruneDismissed(null, TODAY)).toEqual({});
    expect(pruneDismissed(undefined, TODAY)).toEqual({});
  });

  it('always keeps `keep`, even when old and not the newest of its group', () => {
    const d = { 'break:2026-01-02': true, 'break:2026-03-01': true };
    expect(pruneDismissed(d, TODAY, 'break:2026-01-02')).toEqual(d);
  });

  it('keeps the 300 newest keys, `keep` first and undated keys last, in their original order', () => {
    const d: Record<string, boolean> = { legacy: true };
    for (let i = 0; i < 400; i++) d[`stall:Lift ${i}:${addDays(TODAY, -(i % 80))}`] = true;
    d['break:2025-01-01'] = true;
    const out = pruneDismissed(d, TODAY, 'break:2025-01-01');
    expect(Object.keys(out)).toHaveLength(DISMISSED_MAX_KEYS);
    expect(out['break:2025-01-01']).toBe(true);
    expect(out['legacy']).toBeUndefined();
    const dates = Object.keys(out).filter((k) => k.startsWith('stall:')).map((k) => k.slice(-10));
    // 400 keys over 80 dates = 5 a day; 299 kept: the newest 59 dates whole, 4 of the 60th (the later-added ones).
    expect([...dates].sort()[0]).toBe(addDays(TODAY, -59));
    expect(dates.filter((x) => x === addDays(TODAY, -59))).toHaveLength(4);
    expect(out['stall:Lift 59:' + addDays(TODAY, -59)]).toBeUndefined();
    expect(out['stall:Lift 379:' + addDays(TODAY, -59)]).toBe(true);
    const order = Object.keys(d).filter((k) => out[k]);
    expect(Object.keys(out)).toEqual(order);
  });

  it('when a cap binds, keeps the newest key of each group before older keys of other groups', () => {
    const d: Record<string, boolean> = { 'break:2025-01-01': true, 'up:Old Lift:2025-02-01': true };
    for (let i = 0; i < 4; i++) for (let k = 0; k <= 90; k++) d[`stall:Lift ${i}:${addDays(TODAY, -k)}`] = true;
    const out = pruneDismissed(d, TODAY);
    expect(Object.keys(out)).toHaveLength(DISMISSED_MAX_KEYS);
    expect(out['break:2025-01-01']).toBe(true);
    expect(out['up:Old Lift:2025-02-01']).toBe(true);
    for (let i = 0; i < 4; i++) expect(out[`stall:Lift ${i}:${TODAY}`]).toBe(true);
  });

  it('keeps the compact JSON within 32 KB with 200-character and non-ASCII names', () => {
    const long = 'x'.repeat(200), hindi = 'स्क्वाट'.repeat(28).slice(0, 200), emoji = '💪'.repeat(100);
    const d: Record<string, boolean> = {};
    for (let i = 0; i < 300; i++) d[`stall:${[long, hindi, emoji][i % 3]}${i}:${addDays(TODAY, -(i % 60))}`] = true;
    expect(bytes(d)).toBeGreaterThan(DISMISSED_MAX_BYTES);
    const out = pruneDismissed(d, TODAY);
    expect(bytes(out)).toBeLessThanOrEqual(DISMISSED_MAX_BYTES);
    expect(Object.keys(out).length).toBeGreaterThan(50);
  });

  it('does not change its input', () => {
    const d = Object.freeze({ 'ci:2020-01-06': true, 'ci:2026-10-12': true, legacy: false });
    pruneDismissed(d, TODAY);
    expect(d).toEqual({ 'ci:2020-01-06': true, 'ci:2026-10-12': true, legacy: false });
  });
});

describe('dismissKey', () => {
  it('adds the key as the prototype does, and prunes the rest', () => {
    expect(dismissKey(undefined, 'ci:2026-10-12', TODAY)).toEqual({ 'ci:2026-10-12': true });
    expect(dismissKey({ 'ci:2026-01-05': true, 'kcal:2026-01-05': true, 'kcal:2025-12-29': true }, 'ci:2026-10-12', TODAY)).toEqual({ 'kcal:2026-01-05': true, 'ci:2026-10-12': true });
  });

  it('an old key just answered is kept, so the card it hides does not come straight back', () => {
    const d = dismissKey({ 'break:2026-06-01': true }, 'break:2026-03-01', TODAY);
    expect(d['break:2026-03-01']).toBe(true);
  });

  it('stays within 300 keys and 32 KB over 10,000 answers', () => {
    const r = rng(721);
    const names = ['Barbell Back Squat', 'x'.repeat(200), 'डम्बल प्रेस'.repeat(18).slice(0, 200), 'Lat Pulldown'];
    let d: Record<string, boolean> = {};
    let today = '2026-01-05';
    let max = 0;
    for (let i = 0; i < 10000; i++) {
      if (r() < 0.3) today = addDays(today, 1);
      const old = addDays(today, -Math.floor(r() * 400));
      const key = [
        `ci:${mondayOf(today)}`,
        `kcal:${mondayOf(today)}`,
        `missed:${addDays(today, -Math.floor(r() * 30))}`,
        `break:${old}`,
        `stall:${names[i % names.length]}${i % 50}:${old}`,
        `up:${names[i % names.length]}${i}:${today}`,
      ][Math.floor(r() * 6)] as string;
      d = dismissKey(d, key, today);
      expect(d[key]).toBe(true);
      max = Math.max(max, Object.keys(d).length);
      expect(Object.keys(d).length).toBeLessThanOrEqual(DISMISSED_MAX_KEYS);
      expect(bytes(d)).toBeLessThanOrEqual(DISMISSED_MAX_BYTES);
    }
    expect(max).toBeGreaterThan(100);
  });
});

describe('pruning never changes which cards the prototype shows: differential over simulated years', () => {
  const reentry = loadReentry();
  const stalls = loadStalls(metaTable(catalog.meta));
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const keysOf = (html: string): string[] => [...html.matchAll(/data-key="([^"]*)"/g)].map((m) => m[1] as string).filter((k, i, a) => a.indexOf(k) === i);
  const names = ['Barbell Back Squat', 'Barbell Bench Press', 'Lat Pulldown', 'Leg Press', 'Seated Cable Row', 'Overhead Press'].filter((n) => n in catalog.meta);

  /** Every card key the prototype shows on the start screen for `today` with `dismissed`. */
  function shown(today: string, sessions: SessionLog, lifts: Record<string, LiftRecord>, dismissed: Record<string, boolean>): string[] {
    Object.assign(reentry.S, { date: today, sessions: { entries: sessions }, settings: { adj: { dismissed: clone(dismissed) } } });
    Object.assign(stalls.S, { date: today, lifts, settings: { adj: { dismissed: clone(dismissed) } } });
    const html = [reentry.reentryCard(), reentry.steadyCard(), stalls.recoveryCard(), ...Object.keys(lifts).map((n) => stalls.stallCard({ name: n, sets: [] }))].join('');
    return keysOf(html).sort();
  }

  it.each([1, 2, 3])('seed %i: 600 days of training, breaks and answered cards', (seed) => {
    const r = rng(7210 + seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const sessions: Record<string, { t: string; n: number }> = {};
    const lifts: Record<string, LiftRecord> = {};
    let ref: Record<string, boolean> = {}; // the prototype's map, never pruned
    let pruned: Record<string, boolean> = {};
    let today = '2025-01-06', away = 0, cardsShown = 0, oldHidden = 0;
    for (let day = 0; day < 600; day++, today = addDays(today, 1)) {
      const a = shown(today, sessions, lifts, ref), b = shown(today, sessions, lifts, pruned);
      expect(b).toEqual(a);
      cardsShown += a.length;
      // Hidden by an answer older than 90 days that pruning had to keep.
      oldHidden += shown(today, sessions, lifts, {}).filter((k) => ref[k] && k.slice(-10) < addDays(today, -90)).length;
      for (const key of a)
        if (r() < 0.7) {
          Object.assign(stalls.S, { settings: { adj: { dismissed: ref } } });
          stalls.adjAction('adj-no', { dataset: { type: key.split(':')[0] as string, key } }); // the prototype's `done()`
          ref = (stalls.S.settings.adj as { dismissed: Record<string, boolean> }).dismissed;
          pruned = dismissKey(pruned, key, today);
        }
      // A week of noise keys like the check-in and calorie cards add, so pruning has work to do.
      if (r() < 0.3) for (const k of [`ci:${mondayOf(today)}`, `kcal:${mondayOf(today)}`, `missed:${today}`]) (ref[k] = true), (pruned = dismissKey(pruned, k, today));
      if (away > 0) {
        away--;
        continue;
      }
      if (r() < 0.012) away = pick([20, 45, 100, 160]);
      if (r() < 0.55) {
        sessions[today] = { t: 'Push A', n: 3 };
        for (const n of names)
          if (r() < 0.5) {
            const L = lifts[n];
            lifts[n] = { date: today, sets: [{ w: 50, r: 8 }], hist: [...(L?.hist ?? []), { date: today, e: pick([100, 100, 100.5, 101, 104]) }].slice(-8) };
          }
      }
    }
    expect(cardsShown).toBeGreaterThan(300);
    expect(oldHidden).toBeGreaterThan(0);
    expect(Object.keys(pruned).length).toBeLessThan(Object.keys(ref).length / 2);
  });
});
