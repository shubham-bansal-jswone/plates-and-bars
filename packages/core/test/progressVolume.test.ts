import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  COVER_SHOW, VOLUME_AVG_WEEKS, addDays, doneCoverage, mondayOf, volumeVsPlan, weeklyDoneSets,
  type CoverageDay, type MuscleSets, type WeekSets,
} from '../src/index';

const g = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/spec/golden/progressVolume.json'), 'utf8')) as {
  tags: Record<string, { primary: string[]; secondary: string[] }>;
  avg_weeks: number;
  weekly: { note: string; end: string; weeks: number; days: CoverageDay[]; expected: WeekSets[] }[];
  vs_plan: { note: string; weeks: { week: string; partial: boolean; sets: MuscleSets }[]; planned: MuscleSets; since: string | null; expected: ReturnType<typeof volumeVsPlan> }[];
};
const tags = g.tags as never;
const ws = (rows: { week: string; partial: boolean; sets: MuscleSets }[]): WeekSets[] => rows;

describe('weeklyDoneSets (#1351 C2)', () => {
  it('constant matches the vectors', () => expect(VOLUME_AVG_WEEKS).toBe(g.avg_weeks));

  it.each(g.weekly.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    expect(weeklyDoneSets(c.days, c.end, c.weeks, tags)).toEqual(c.expected);
  });

  it('a week with no sessions is a real 0, not null', () => {
    const w = weeklyDoneSets([], '2026-10-29', 1, tags)[0]!;
    for (const m of COVER_SHOW) expect(w.sets[m]).toBe(0);
  });

  it('bad week counts give none', () => {
    expect(weeklyDoneSets([], '2026-10-29', -1, tags)).toEqual([]);
    expect(weeklyDoneSets([], '2026-10-29', NaN, tags)).toEqual([]);
    expect(weeklyDoneSets([], '2026-10-29', Infinity, tags)).toEqual([]);
    expect(weeklyDoneSets([], '2026-10-29', 2.9, tags)).toHaveLength(2);
  });

  it('the last week equals doneCoverage for its Monday-to-Sunday window, on every fixture', () => {
    for (const c of g.weekly) {
      for (const end of [c.end, addDays(mondayOf(c.end), 6)]) {
        const sunday = addDays(mondayOf(end), 6);
        const last = weeklyDoneSets(c.days, end, 3, tags).at(-1)!;
        const dc = doneCoverage(sunday, c.days, tags);
        for (const m of new Set([...COVER_SHOW, ...Object.keys(dc), ...Object.keys(last.sets)])) expect(last.sets[m] || 0).toBe(dc[m] || 0);
      }
    }
  });

  it('every earlier week equals doneCoverage on its own Sunday', () => {
    const c = g.weekly[0]!;
    for (const w of weeklyDoneSets(c.days, c.end, 3, tags)) {
      const dc = doneCoverage(addDays(w.week, 6), c.days, tags);
      for (const m of COVER_SHOW) expect(w.sets[m]).toBe(dc[m] || 0);
    }
  });
});

describe('volumeVsPlan (#1351 C2)', () => {
  it.each(g.vs_plan.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    const r = volumeVsPlan(ws(c.weeks), c.planned, c.since);
    expect(r.basis).toBe(c.expected.basis);
    expect(r.weeksUsed).toBe(c.expected.weeksUsed);
    expect(r.rows.map((x) => x.muscle)).toEqual([...COVER_SHOW]);
    expect(r.rows).toEqual(c.expected.rows.map((x) => ({ ...x, barPct: expect.closeTo(x.barPct, 9) })));
  });

  it('averages fewer weeks as they are', () => {
    const r = volumeVsPlan([{ week: '2026-10-19', partial: false, sets: { chest: 4 } }, { week: '2026-10-26', partial: true, sets: { chest: 0 } }], { chest: 4 }, '2026-10-01');
    expect(r.weeksUsed).toBe(1);
    expect(r.rows[0]).toMatchObject({ avg: 4, gap: 0, below: false });
  });

  it('an empty since behaves as no history', () => {
    expect(volumeVsPlan([{ week: 'a', partial: false, sets: { chest: 5 } }], { chest: 9 }, '').weeksUsed).toBe(0);
  });

  it('no complete week: zeros, nothing below', () => {
    const r = volumeVsPlan([{ week: '2026-10-26', partial: true, sets: { chest: 3 } }], { chest: 9 }, '2026-10-01');
    expect(r.weeksUsed).toBe(0);
    expect(r.rows[0]).toMatchObject({ avg: 0, target: 9, gap: -9, below: false });
    expect(volumeVsPlan([], {}, '2026-10-01').weeksUsed).toBe(0);
  });

  it('exactly on target is not below; half sets average through', () => {
    const r = volumeVsPlan([{ week: 'a', partial: false, sets: { chest: 5.5 } }, { week: 'b', partial: false, sets: { chest: 6 } }], { chest: 5.75 }, '2026-10-01');
    expect(r.rows[0]).toMatchObject({ avg: 5.75, below: false, low: true });
  });
});
