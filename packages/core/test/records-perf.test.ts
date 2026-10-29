import { addDays } from '../src/dates';
import { e1rmHistory } from '../src/e1rm';
import {
  isPrToday, mainLifts, milestones, personalRecords, priorBestOf,
  MAIN_LIFT_COUNT, MAIN_LIFT_MIN_POINTS, MAIN_LIFT_WEEKS, PR_MIN_PRIOR_SESSIONS,
  type ExType, type MainLift, type PersonalRecord, type PriorBest, type PrSet,
} from '../src/index';

// Reference: the pre-#1378 grouping (array spread per set, quadratic), kept verbatim. The per-day score is taken
// from the public `priorBestOf` on a single day (its grouping is trivial there), so only the grouping differs.
const dayOf = (day: readonly PrSet[], type: ExType | undefined, bw?: number | null): { score: number } | null => {
  const p = priorBestOf(day, type, '9999-12-31', bw);
  return p.sessions ? { score: p.best } : null;
};
function refPriorBestOf(sets: readonly PrSet[], type: ExType | undefined, date: string, bw?: number | null): PriorBest {
  const byDay = new Map<string, PrSet[]>();
  for (const s of sets) if (s.date < date) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  let best = 0;
  let sessions = 0;
  for (const day of byDay.values()) {
    const d = dayOf(day, type, bw);
    if (!d) continue;
    sessions++;
    if (d.score > best) best = d.score;
  }
  return { best, sessions };
}
function refPersonalRecords(sets: readonly PrSet[], types: Readonly<Record<string, ExType>>, bw?: number | null): PersonalRecord[] {
  const byLift = new Map<string, Map<string, PrSet[]>>();
  for (const s of sets) {
    const days = byLift.get(s.exercise) ?? new Map<string, PrSet[]>();
    days.set(s.date, [...(days.get(s.date) ?? []), s]);
    byLift.set(s.exercise, days);
  }
  const out: PersonalRecord[] = [];
  for (const [lift, days] of byLift) {
    const type = types[lift];
    let prior: PriorBest = { best: 0, sessions: 0 };
    for (const date of [...days.keys()].sort()) {
      const day = days.get(date) as PrSet[];
      const today = dayOf(day, type, bw);
      if (!today) continue;
      const hit = isPrToday(prior, day, type, bw);
      if (hit) out.push({ lift, date, ...hit });
      prior = { best: Math.max(prior.best, today.score), sessions: prior.sessions + 1 };
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.lift < b.lift ? -1 : a.lift > b.lift ? 1 : 0));
}
function refMainLifts(sets: readonly PrSet[], types: Readonly<Record<string, ExType>>, end: string): MainLift[] {
  const from = addDays(end, -7 * MAIN_LIFT_WEEKS);
  const byLift = new Map<string, PrSet[]>();
  for (const s of sets) {
    if (s.deleted_at || s.date < from || s.date > end) continue;
    const { session: _session, ...day } = s;
    byLift.set(s.exercise, [...(byLift.get(s.exercise) ?? []), day]);
  }
  const picked: MainLift[] = [];
  for (const [lift, rows] of byLift) {
    const pts = e1rmHistory(rows, types[lift]);
    if (pts.length < MAIN_LIFT_MIN_POINTS) continue;
    picked.push({ lift, sessions: pts.length, last: (pts[pts.length - 1] as { date: string }).date });
  }
  return picked
    .sort((a, b) => b.sessions - a.sessions || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || (a.lift < b.lift ? -1 : a.lift > b.lift ? 1 : 0))
    .slice(0, MAIN_LIFT_COUNT);
}

// Deterministic PRNG (mulberry32) so failures reproduce.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TYPES: ExType[] = ['barbell', 'dumbbell', 'machine', 'bodyweight', 'time', 'assisted'];
const DAY0 = '2021-01-04';

function gen(seed: number, nSets: number, nLifts: number, spanDays: number) {
  const r = rng(seed);
  const types: Record<string, ExType> = {};
  const names: string[] = [];
  for (let i = 0; i < nLifts; i++) {
    const n = `Lift ${String.fromCharCode(65 + i)}`;
    names.push(n);
    if (r() < 0.9) types[n] = TYPES[Math.floor(r() * TYPES.length)] as ExType; // some left untyped
  }
  const sets: PrSet[] = [];
  for (let i = 0; i < nSets; i++) {
    const exercise = names[Math.floor(r() * nLifts)] as string;
    const date = addDays(DAY0, Math.floor(r() * spanDays));
    const f = r();
    sets.push({
      exercise, date,
      kind: f < 0.1 ? 'ramp' : 'work',
      weight_kg: Math.round((20 + r() * 150) * 2) / 2,
      reps: 1 + Math.floor(r() * 14),
      done: f > 0.05,
      rate: f > 0.9 ? 'fail' : null,
      deleted_at: f > 0.97 ? '2026-01-01T00:00:00Z' : null,
    });
  }
  return { sets, types, end: addDays(DAY0, spanDays - 1), names };
}

describe('records perf (#1378)', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('old and new agree on random input (seed %i)', (seed) => {
    const { sets, types, end } = gen(seed, 400 + seed * 60, 4 + seed, 200 + seed * 40);
    for (const bw of [undefined, 80]) expect(personalRecords(sets, types, bw)).toEqual(refPersonalRecords(sets, types, bw));
    expect(mainLifts(sets, types, end)).toEqual(refMainLifts(sets, types, end));
    const mid = addDays(DAY0, 120);
    for (const name of Object.keys(types).slice(0, 3)) {
      const mine = sets.filter((s) => s.exercise === name);
      expect(priorBestOf(mine, types[name], mid, 80)).toEqual(refPriorBestOf(mine, types[name], mid, 80));
    }
    expect(PR_MIN_PRIOR_SESSIONS).toBeGreaterThan(0);
  });

  it('about 25,000 sets over 5 years and 15 lifts finish within budget', () => {
    const { sets, types, end } = gen(99, 25000, 15, 5 * 365);
    types['Lift A'] = 'barbell';
    const t0 = performance.now();
    const records = personalRecords(sets, types, 80);
    const t1 = performance.now();
    const main = mainLifts(sets, types, end);
    const t2 = performance.now();
    const ms = milestones(sets, {}, [], types, 'kg', end, { weight_kg: 80 });
    const t3 = performance.now();
    // eslint-disable-next-line no-console
    console.log(`perf 25k sets: personalRecords ${(t1 - t0).toFixed(1)} ms, mainLifts ${(t2 - t1).toFixed(1)} ms, milestones ${(t3 - t2).toFixed(1)} ms, total ${(t3 - t0).toFixed(1)} ms`);
    expect(records.length).toBeGreaterThan(0);
    expect(main.length).toBeLessThanOrEqual(MAIN_LIFT_COUNT);
    expect(ms.length).toBeGreaterThan(0);
    expect(t3 - t0).toBeLessThan(2000);
  });

  it('25,000 sets inside the 12-week main-lift window (worst case for per-lift grouping)', () => {
    const { sets, types, end } = gen(7, 25000, 15, 84);
    const t0 = performance.now();
    const main = mainLifts(sets, types, end);
    const t1 = performance.now();
    const prior = priorBestOf(sets.filter((s) => s.exercise === 'Lift A'), 'barbell', end, 80);
    const t2 = performance.now();
    // eslint-disable-next-line no-console
    console.log(`perf 25k dense: mainLifts ${(t1 - t0).toFixed(1)} ms, priorBestOf ${(t2 - t1).toFixed(1)} ms`);
    expect(main).toEqual(refMainLifts(sets, types, end));
    expect(prior.sessions).toBeGreaterThan(0);
    expect(t2 - t0).toBeLessThan(2000);
  });
});
