import {
  addDays,
  checkBest,
  exInfo,
  inRange,
  recoveryCard,
  recoveryWeek,
  sessionScore,
  stallCard,
  stalled,
  stalledList,
  stallRange,
  updateLift,
  type AdjState,
  type ExerciseMetaTable,
  type ExerciseOverride,
  type ExType,
  type LiftRecord,
  type ScoreEntry,
  type SetEntry,
  type Where,
} from '../src/index';
import { loadGolden } from './helpers';
import { rng } from './prototype-plan';
import { loadStalls } from './prototype-stalls';

// No golden fixture covers stalls or personal bests; these rules are checked against the prototype's
// own functions (differential tests below) and by hand-worked unit tests.
const meta = loadGolden<{ exerciseMeta: ExerciseMetaTable }>('progression').exerciseMeta;
const DATE = '2026-10-07'; // a Wednesday; its Monday is 2026-10-05
const hist = (...es: number[]): ScoreEntry[] => es.map((e, i) => ({ date: addDays('2026-09-01', i * 3), e }));
const lift = (h: ScoreEntry[], more: Partial<LiftRecord> = {}): LiftRecord => ({ date: '2026-10-01', sets: [{ w: 60, r: 10 }], hist: h, ...more });
const set = (w: string, r: string, done = true, rate?: SetEntry['rate']): SetEntry => ({ w, r, done, ...(rate ? { rate } : {}) });

describe('sessionScore', () => {
  it('loaded: best Epley estimate w × (1 + r/30)', () => {
    expect(sessionScore([{ w: 60, r: 10 }, { w: 70, r: 3 }], 'barbell')).toBeCloseTo(80, 10);
    expect(sessionScore([{ w: 100, r: 0 }], 'machine')).toBe(100);
  });
  it('bodyweight and timed: total reps (or seconds)', () => {
    expect(sessionScore([{ w: 10, r: 12 }, { w: 0, r: 8 }], 'bodyweight')).toBe(20);
    expect(sessionScore([{ w: 0, r: 45 }, { w: 0, r: 30 }], 'time')).toBe(75);
  });
  it('assisted: best reps × 2 − assistance', () => {
    expect(sessionScore([{ w: 30, r: 10 }, { w: 20, r: 6 }], 'assisted')).toBe(-8);
  });
  it('empty sets: 0 for bodyweight, -Infinity otherwise', () => {
    expect(sessionScore([], 'bodyweight')).toBe(0);
    expect(sessionScore([], 'barbell')).toBe(-Infinity);
  });
});

describe('stalled and stalledList', () => {
  it('needs 4 scores; last 3 not beating the earlier best by more than 1%', () => {
    expect(stalled('A', { A: lift(hist(100, 100, 100)) })).toBe(false);
    expect(stalled('A', { A: lift(hist(100, 101, 100, 99)) })).toBe(true); // 101 = 100 × 1.01, not more
    expect(stalled('A', { A: lift(hist(100, 101.1, 100, 99)) })).toBe(false);
    expect(stalled('A', { A: lift(hist(90, 100, 95, 99, 101)) })).toBe(true); // best before the last 3 is 100
    expect(stalled('A', {})).toBe(false);
    expect(stalled('A', { A: lift([]) })).toBe(false);
  });
  it('lists stalled lifts last done 21 days or less before the date', () => {
    const h = hist(100, 100, 100, 100);
    const lifts = { A: lift(h, { date: '2026-09-16' }), B: lift(h, { date: '2026-09-15' }), C: lift(hist(100, 120, 130, 140)) };
    expect(stalledList(lifts, DATE)).toEqual(['A']);
  });
});

describe('recovery-week card', () => {
  const h = hist(100, 100, 100, 100);
  const four = { A: lift(h), B: lift(h), C: lift(h), D: lift(h) };
  it('3+ stalled lifts: names the first 3 and counts the rest, keyed by the week', () => {
    expect(recoveryCard(four, DATE)).toEqual({ key: 'deload:2026-10-05', names: ['A', 'B', 'C'], more: 1 });
    expect(recoveryCard({ A: lift(h), B: lift(h), C: lift(h) }, DATE)).toEqual({ key: 'deload:2026-10-05', names: ['A', 'B', 'C'], more: 0 });
    expect(recoveryCard({ A: lift(h), B: lift(h) }, DATE)).toBeNull();
  });
  it('hidden during a recovery week, when muted, or when this week’s key is dismissed', () => {
    expect(recoveryCard(four, DATE, { deload: { from: '2026-10-03', until: DATE } })).toBeNull();
    expect(recoveryCard(four, DATE, { deload: { from: '2026-09-20', until: '2026-10-06' } })).not.toBeNull();
    expect(recoveryCard(four, DATE, { muted: { deload: true } })).toBeNull();
    expect(recoveryCard(four, DATE, { dismissed: { 'deload:2026-10-05': true } })).toBeNull();
    expect(recoveryCard(four, '2026-10-12', { dismissed: { 'deload:2026-10-05': true } })).toMatchObject({ key: 'deload:2026-10-12' });
  });
  it('inRange: until on or after the date, from (if any) on or before it', () => {
    expect(inRange(null, DATE)).toBe(false);
    expect(inRange({ until: DATE }, DATE)).toBe(true);
    expect(inRange({ from: '2026-10-08', until: '2026-10-14' }, DATE)).toBe(false);
  });
  it('starting a recovery week covers 7 days', () => {
    expect(recoveryWeek('2026-12-29')).toEqual({ from: '2026-12-29', until: '2027-01-04' });
  });
});

describe('stall card', () => {
  const lifts = { 'Hack Squat': lift(hist(100, 100, 100, 100)), 'Lateral Raise': lift(hist(10, 10, 10, 10)) };
  const info = exInfo('Hack Squat', meta);
  it('range bottom 8+: heavier 6–8; below 8: lighter 10–12', () => {
    expect(stallCard({ name: 'Hack Squat', sets: [] }, lifts, info)).toEqual({ key: 'stall:Hack Squat:2026-10-01', heavy: true, range: [6, 8] });
    expect(stallCard({ name: 'Hack Squat', sets: [] }, lifts, { ...info, lo: 6 })).toMatchObject({ heavy: false, range: [10, 12] });
  });
  it('hidden once a set is ticked, when muted, dismissed or not stalled', () => {
    expect(stallCard({ name: 'Hack Squat', sets: [{ done: false }, { done: true }] }, lifts, info)).toBeNull();
    expect(stallCard({ name: 'Hack Squat', sets: [] }, lifts, info, { muted: { stall: true } })).toBeNull();
    expect(stallCard({ name: 'Hack Squat', sets: [] }, lifts, info, { dismissed: { 'stall:Hack Squat:2026-10-01': true } })).toBeNull();
    expect(stallCard({ name: 'Leg Press', sets: [] }, lifts, info)).toBeNull();
  });
  it('switching range keeps other settings and fixes type and step', () => {
    expect(stallRange({ lo: 10, hi: 15, step: 1 }, { type: 'machine', lo: 10, hi: 15, step: 1 }, [6, 8])).toEqual({ type: 'machine', step: 1, lo: 6, hi: 8 });
    expect(stallRange(undefined, info, [6, 8])).toEqual({ type: info.type, step: info.step, lo: 6, hi: 8 });
  });
});

describe('personal bests', () => {
  it('checkBest: today beats the best before it by more than 0.5%, once a day', () => {
    const r = { hist: hist(100, 100.6) };
    expect(checkBest(r, 100, DATE)).toBe(true);
    expect(checkBest({ hist: hist(100, 100.4) }, 100, DATE)).toBe(false);
    expect(checkBest({ ...r, pbToast: DATE }, 100, DATE)).toBe(false);
    expect(checkBest({ ...r, pbToast: '2026-10-06' }, 100, DATE)).toBe(true);
    expect(checkBest({ hist: hist(200) }, 100, DATE)).toBe(false); // needs 2 scores
    expect(checkBest(undefined, 100, DATE)).toBe(false);
  });

  it('updateLift: first session starts the record; no toast without an earlier score', () => {
    const u = updateLift(undefined, { sets: [set('60', '10'), set('', '', false), set('0', '0')], form: 'yes' }, DATE, 'barbell');
    expect(u).toEqual({ toast: false, record: { date: DATE, sets: [{ w: 60, r: 10, rate: null }], form: 'yes', n: 1, first: DATE, prev: null, hist: [{ date: DATE, e: 80 }] } });
    expect(updateLift(undefined, { sets: [set('', '', false)] }, DATE, 'barbell')).toBeNull();
  });

  it('updateLift: a new day moves the record to prev, counts the session and toasts a best', () => {
    const L = lift(hist(80), { date: '2026-10-01', first: '2026-10-01', n: 1, form: 'no' });
    const u = updateLift(L, { sets: [set('62,5', '10', true, 'hard')] }, DATE, 'barbell');
    expect(u?.toast).toBe(true);
    expect(u?.record).toMatchObject({ n: 2, first: '2026-10-01', prev: { date: '2026-10-01', sets: L.sets, form: 'no' }, pbToast: DATE, form: null });
    expect(u?.record.sets).toEqual([{ w: 62.5, r: 10, rate: 'hard' }]);
    expect(u?.record.hist).toEqual([...(L.hist as ScoreEntry[]), { date: DATE, e: 83.3 }]);
  });

  it('updateLift: the same day replaces today’s score; history keeps the last 8; a newer record is left alone', () => {
    const L = lift([...hist(1, 2, 3, 4, 5, 6, 7), { date: DATE, e: 9 }], { date: DATE, n: 3, first: '2026-09-01', prev: null });
    const u = updateLift(L, { sets: [set('10', '0')] }, DATE, 'barbell');
    expect(u?.record).toMatchObject({ n: 3, first: '2026-09-01', prev: null });
    expect(u?.record.hist).toEqual([...hist(1, 2, 3, 4, 5, 6, 7), { date: DATE, e: 10 }]);
    const u2 = updateLift(lift(hist(1, 2, 3, 4, 5, 6, 7, 8), { date: '2026-10-06' }), { sets: [set('10', '0')] }, DATE, 'barbell');
    expect(u2?.record.hist?.map((x) => x.e)).toEqual([2, 3, 4, 5, 6, 7, 8, 10]);
    expect(updateLift(lift([], { date: '2026-10-08' }), { sets: [set('10', '5')] }, DATE, 'barbell')).toBeNull();
  });

  it('updateLift: older records without n or first', () => {
    const prev = { date: '2026-09-20', sets: [] };
    expect(updateLift({ date: '2026-10-01', sets: [], prev }, { sets: [set('10', '5')] }, DATE, 'barbell')?.record).toMatchObject({ n: 3, first: '2026-09-20' });
    expect(updateLift({ date: '2026-10-01', sets: [] }, { sets: [set('10', '5')] }, DATE, 'barbell')?.record).toMatchObject({ n: 2, first: '2026-10-01' });
    expect(updateLift({ date: DATE, sets: [] }, { sets: [set('10', '5')] }, DATE, 'barbell')?.record).toMatchObject({ n: 1, first: DATE, prev: null });
  });
});

describe('PINNED QUIRK tests', () => {
  it('PINNED QUIRK: updateLift drops pbToast, so the best toast repeats on every tick, rating or form change that day', () => {
    const L = lift(hist(80), { date: '2026-10-01' });
    const first = updateLift(L, { sets: [set('70', '10')] }, DATE, 'barbell');
    expect(first?.toast).toBe(true);
    const second = updateLift(first?.record, { sets: [set('70', '10'), set('70', '9')] }, DATE, 'barbell');
    expect(second?.toast).toBe(true); // checkBest alone would have said false: pbToast was today
    expect(checkBest(first?.record, 80, DATE)).toBe(false);
  });

  it('PINNED QUIRK: with negative assisted scores the margins flip: an equal session is a best and never stalls', () => {
    const L = lift(hist(-10), { date: '2026-10-01' });
    expect(updateLift(L, { sets: [set('30', '10')] }, DATE, 'assisted')?.toast).toBe(true); // −10 > −10 × 1.005
    expect(stalled('A', { A: lift(hist(-10, -10, -10, -10)) })).toBe(false); // −10 ≤ −10.1 is false
  });

  it('PINNED QUIRK: when every earlier score is 0, no improvement counts as a best', () => {
    const L = lift(hist(0), { date: '2026-10-01' });
    expect(updateLift(L, { sets: [set('0', '10')] }, '2026-10-02', 'machine')?.record.hist?.at(-1)?.e).toBe(0);
    expect(updateLift(L, { sets: [set('100', '10')] }, DATE, 'machine')?.toast).toBe(false);
  });

  it('PINNED QUIRK: exactly 0.5% better is a best, because 100 × 1.005 is 100.49999… in floating point', () => {
    expect(checkBest({ hist: hist(100, 100.5) }, 100, DATE)).toBe(true);
  });

  it('PINNED QUIRK: bodyweight scores total reps, so an extra easy set is a personal best', () => {
    const L = lift(hist(30), { date: '2026-10-01' });
    expect(updateLift(L, { sets: [set('0', '10'), set('0', '10'), set('0', '10'), set('0', '3')] }, DATE, 'bodyweight')?.toast).toBe(true);
  });

  it('PINNED QUIRK: unticking every set today leaves today’s record and score in place', () => {
    const today = updateLift(lift(hist(80)), { sets: [set('70', '10')] }, DATE, 'barbell')?.record;
    expect(updateLift(today, { sets: [set('70', '10', false)] }, DATE, 'barbell')).toBeNull();
  });
});

describe('stalls and personal bests: differential against the prototype', () => {
  const proto = loadStalls(meta);
  const r = rng(105);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const names = [...Object.keys(meta), 'Mystery Lift'];
  const types: ExType[] = ['barbell', 'dumbbell', 'machine', 'cable', 'assisted', 'bodyweight', 'time', 'other'];
  const dates = ['2026-09-10', '2026-09-15', '2026-09-16', '2026-09-28', '2026-10-01', '2026-10-05', DATE, '2026-10-11', '2026-10-12'];
  const scores = [-12, -10, -9.9, 0, 50, 50.5, 50.6, 100, 100.5, 100.6, 101, 101.1, 140];
  const randHist = (): ScoreEntry[] => Array.from({ length: Math.floor(r() * 9) }, () => ({ date: pick(dates), e: pick(scores) }));
  const randLifts = (): Record<string, LiftRecord> => {
    const out: Record<string, LiftRecord> = {};
    for (let k = Math.floor(r() * 8); k > 0; k--) out[pick(names)] = { date: pick(dates), sets: [{ w: 50, r: 8 }], hist: randHist(), ...(r() < 0.3 ? { pbToast: pick(dates) } : {}) };
    return out;
  };
  const randAdj = (date: string): AdjState => ({
    muted: { deload: r() < 0.15, stall: r() < 0.15 },
    dismissed: r() < 0.2 ? { [`deload:${pick(['2026-10-05', '2026-09-28'])}`]: true } : {},
    ...(r() < 0.3 ? { deload: pick([{ from: date, until: addDays(date, 6) }, { until: '2026-10-01' }, { from: '2026-10-11', until: '2026-10-17' }]) } : {}),
  });
  const entry = (): SetEntry => ({ w: pick(['', '0', '20', '22,5', '57.5', '100']), r: pick(['', '0', '3', '8', '12']), done: r() < 0.7, ...(r() < 0.5 ? { rate: pick(['easy', 'right', 'hard', 'fail'] as const) } : {}) });

  it('sessionScore matches on 3,000 random sessions', () => {
    for (let k = 0; k < 3000; k++) {
      const sets = Array.from({ length: 1 + Math.floor(r() * 5) }, () => ({ w: pick([0, 2.5, 20, 22.5, 60, 101.25]), r: Math.floor(r() * 25) }));
      const t = pick(types);
      expect(sessionScore(sets, t)).toBe(proto.sessionScore(sets, t));
    }
  });

  it('stalled, stalledList, recovery card and starting a recovery week match on 5,000 random states', () => {
    let shown = 0;
    for (let k = 0; k < 5000; k++) {
      const date = pick(dates);
      const lifts = randLifts();
      const adj = randAdj(date);
      Object.assign(proto.S, { date, lifts: clone(lifts), settings: { adj: clone(adj) } });
      for (const n of [...Object.keys(lifts), 'Nobody']) expect(stalled(n, lifts)).toBe(proto.stalled(n));
      expect(stalledList(lifts, date)).toEqual(proto.stalledList());
      const card = recoveryCard(lifts, date, adj);
      const html = proto.recoveryCard();
      if (!card) expect(html).toBe('');
      else {
        shown++;
        expect(html).toContain(`data-key="${card.key}"`);
        expect(html).toContain(`<p>${card.names.join(', ')}${card.more ? ` and ${card.more} more` : ''} haven’t moved`);
        proto.adjAction('adj-deload', { dataset: { type: 'deload', key: card.key } });
        expect((proto.S.settings.adj as AdjState).deload).toEqual(recoveryWeek(date));
      }
    }
    expect(shown).toBeGreaterThan(100);
  });

  it('stall card and its range switch match on 5,000 random states', () => {
    let shown = 0;
    for (let k = 0; k < 5000; k++) {
      const date = pick(dates);
      const lifts = randLifts();
      const name = pick([...Object.keys(lifts), pick(names)]);
      const adj = randAdj(date);
      if (r() < 0.2 && lifts[name]) adj.dismissed = { [`stall:${name}:${lifts[name].date}`]: true };
      const ov: ExerciseOverride | undefined = pick([undefined, { lo: 6, hi: 8 }, { lo: 10, hi: 15, step: 1 }, { type: 'assisted' as const }]);
      const where: Where = pick(['gym', 'dumbbells', 'bodyweight']);
      const ex = { name, sets: Array.from({ length: Math.floor(r() * 3) }, entry) };
      Object.assign(proto.S, { date, lifts: clone(lifts), settings: { adj: clone(adj), ex: ov ? { [name]: clone(ov) } : {} }, where });
      const info = exInfo(name, meta, ov, where);
      const card = stallCard(ex, lifts, info, adj);
      const html = proto.stallCard(clone(ex));
      if (!card) expect(html).toBe('');
      else {
        shown++;
        const [lo, hi] = card.range;
        expect(html).toContain(`data-key="${card.key}"`);
        expect(html).toContain(`Try a ${card.heavy ? 'heavier' : 'lighter'} rep range for the next few weeks: ${lo}–${hi}`);
        proto.adjAction('adj-range', { dataset: { type: 'stall', key: card.key, name, v: `${lo}-${hi}` } });
        expect((proto.S.settings.ex as Record<string, ExerciseOverride>)[name]).toEqual(stallRange(ov, info, card.range));
      }
    }
    expect(shown).toBeGreaterThan(100);
  });

  it('checkBest matches on 4,000 random records', () => {
    let toasts = 0;
    for (let k = 0; k < 4000; k++) {
      const date = pick(dates);
      const name = pick(names);
      const L: LiftRecord | undefined = r() < 0.95 ? { date, sets: [], hist: randHist(), ...(r() < 0.4 ? { pbToast: pick([date, '2026-10-01']) } : {}) } : undefined;
      const before = pick([0, ...scores]);
      Object.assign(proto.S, { date, lifts: L ? { [name]: clone(L) } : {} });
      proto.toasts.length = 0;
      proto.checkBest(name, before);
      const t = checkBest(L, before, date);
      toasts += t ? 1 : 0;
      expect(t).toBe(proto.toasts.length === 1);
      if (L) expect((proto.S.lifts[name] as LiftRecord).pbToast).toBe(t ? date : L.pbToast);
    }
    expect(toasts).toBeGreaterThan(100);
  });

  it('updateLift (record, history, best toast) matches over 3,000 random sequences of ticks across days', () => {
    let toasts = 0;
    for (let k = 0; k < 3000; k++) {
      const name = pick(names);
      const ov: ExerciseOverride | undefined = pick([undefined, { type: 'assisted' as const }, { type: 'bodyweight' as const }]);
      const type = exInfo(name, meta, ov).type;
      let L: LiftRecord | undefined = r() < 0.7 ? { date: pick(dates.slice(0, 5)), sets: [{ w: 50, r: 8 }], hist: randHist(), ...(r() < 0.5 ? { n: 3, first: '2026-08-01' } : {}), ...(r() < 0.4 ? { prev: { date: '2026-08-20', sets: [] } } : {}) } : undefined;
      Object.assign(proto.S, { lifts: L ? { [name]: clone(L) } : {}, settings: { ex: ov ? { [name]: ov } : {} } });
      let date = pick(dates);
      for (let step = 0; step < 6; step++) {
        if (r() < 0.3) date = pick(dates);
        const form = pick([undefined, null, 'yes', 'no'] as const);
        const ex = { name, sets: Array.from({ length: 1 + Math.floor(r() * 4) }, entry), ...(form !== undefined ? { form } : {}) };
        proto.S.date = date;
        proto.toasts.length = 0;
        proto.updateLift(clone(ex));
        const u = updateLift(L, ex, date, type);
        if (u) L = u.record;
        toasts += u?.toast ? 1 : 0;
        expect(proto.toasts.length).toBe(u?.toast ? 1 : 0);
        expect(proto.S.lifts[name]).toEqual(L ? clone(L) : undefined);
      }
    }
    expect(toasts).toBeGreaterThan(100);
  });
});
