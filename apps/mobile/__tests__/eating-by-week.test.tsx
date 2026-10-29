import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ProgressDay } from '@plate-and-bar/core';
import { EatingByWeek } from '../src/progress/EatingByWeek';
import { daysFromLogs, eatingFrom, eatingView } from '../src/progress/eatingLogic';
import type { FoodLog } from '../src/food/types';

interface N { type?: string; props?: Record<string, unknown>; children?: N[] | null }
const walk = (type: string): N[] => {
  const out: N[] = [];
  const go = (n: N | null | undefined) => {
    if (!n) return;
    if (n.type === type) out.push(n);
    n.children?.forEach(go);
  };
  go(screen.toJSON() as N);
  return out;
};
const bar = (week: string) => walk('RNSVGRect').find((n) => n.props?.testID === `bar-${week}`);

const END = '2026-10-08'; // Thursday; the week began Monday 2026-10-05
const day = (date: string, kcal: number, protein_g = 100): ProgressDay => ({ date, trained: false, logs: [{ name: 'x', qty: 1, kcal, protein_g, carbs_g: 0, fat_g: 0 }] });
/** `n` logged days from the Monday of `monday`. */
const week = (monday: string, n: number, kcal: number, protein = 100): ProgressDay[] =>
  Array.from({ length: n }, (_, i) => day(`${monday.slice(0, 8)}${String(Number(monday.slice(8)) + i).padStart(2, '0')}`, kcal, protein));

// 09-07: 4 days at 2400; 09-14: none; 09-21: 2 days at 1000 (partial); 09-28: 5 days at 2000; 10-05 (current): 2 days at 1800.
const seed: ProgressDay[] = [...week('2026-09-07', 4, 2400, 120), ...week('2026-09-21', 2, 1000, 50), ...week('2026-09-28', 5, 2000, 100), ...week('2026-10-05', 2, 1800, 90)];
const ui = (p: Partial<Parameters<typeof EatingByWeek>[0]> = {}) => <EatingByWeek days={seed} failed={false} date={END} kcalTarget={2100} proteinTarget={150} {...p} />;

describe('eatingView', () => {
  it('keeps a no-log week as null, not 0, and marks 1 to 3 logged days partial', () => {
    const v = eatingView(seed, END, 2100, 150);
    const by = Object.fromEntries(v.weeks.map((w) => [w.weekStart, w]));
    expect(by['2026-09-14']!.avgKcal).toBeNull();
    expect(by['2026-09-14']!.loggedDays).toBe(0);
    expect(by['2026-09-21']!.partial).toBe(true);
    expect(by['2026-09-28']!.partial).toBe(false);
    expect(by['2026-09-07']!.partial).toBe(false); // exactly 4 days is enough
  });

  it('averages the last 4 weeks by logged day (not a mean of week means)', () => {
    const v = eatingView(seed, END, 2100, 150);
    // 09-14 none, 09-21 2d x 1000, 09-28 5d x 2000, 10-05 2d x 1800: (2000 + 10000 + 3600) / 9
    expect(v.avg.avgKcal).toBeCloseTo(15600 / 9, 9);
    expect(v.avg.avgProtein_g).toBeCloseTo((2 * 50 + 5 * 100 + 2 * 90) / 9, 9);
    expect(v.avg.loggedDays).toBe(9);
  });

  it('has no average (null, not 0) with no logs, and `any` is about all 12 weeks, not the last 4', () => {
    expect(eatingView([], END, 2100, 150)).toMatchObject({ avg: { avgKcal: null, avgProtein_g: null, loggedDays: 0 }, any: false });
    const old = eatingView(week('2026-08-03', 5, 2000), END, 2100, 150); // 9 weeks before the viewed one
    expect(old.avg.avgKcal).toBeNull();
    expect(old.any).toBe(true);
    expect(old.weeks[0]!.weekStart).toBe('2026-08-03');
  });

  it('leaves out weeks before the first log but keeps at least 4 bars', () => {
    expect(eatingView(seed, END, 2100, 150).weeks.map((w) => w.weekStart)[0]).toBe('2026-09-07');
    expect(eatingView(week('2026-10-05', 4, 2000), END, 2100, 150).weeks).toHaveLength(4);
    expect(eatingView([], END, 2100, 150).weeks).toHaveLength(4);
  });

  it('reads 12 Monday weeks ending with the viewed week', () => {
    expect(eatingFrom(END)).toBe('2026-07-20');
    expect(eatingFrom('2026-10-04')).toBe('2026-07-13'); // a Sunday belongs to the week of the Monday before
  });

  it('groups logs by day', () => {
    const l = (date: string) => ({ date, name: 'x', qty: 1, kcal: 1, protein_g: 1, carbs_g: 0, fat_g: 0 }) as FoodLog;
    expect(daysFromLogs([l('2026-10-01'), l('2026-10-02'), l('2026-10-01')]).map((d) => [d.date, d.logs.length])).toEqual([['2026-10-01', 2], ['2026-10-02', 1]]);
  });
});

describe('EatingByWeek card', () => {
  it('headlines the 4-week average a day against the target, with protein', async () => {
    await render(ui());
    expect(screen.getByLabelText('1,733 kcal a day, last 4 weeks, target 2,100 kcal. Protein 87 g a day, target 150 g')).toBeTruthy();
    expect(screen.getByText('Target 2,100 kcal')).toBeTruthy(); // the chart's caption: the dashed line is drawn
    expect(walk('RNSVGLine').some((n) => n.props?.strokeDasharray !== undefined)).toBe(true);
  });

  it('draws a gap for a no-log week and a hollow bar for a partial one, never a zero-height bar', async () => {
    await render(ui());
    expect(bar('2026-09-14')).toBeUndefined();
    const partial = bar('2026-09-21');
    expect(partial?.props?.fill).toBeNull(); // outline only
    expect(partial?.props?.stroke).not.toBeNull();
    expect(Number(partial?.props?.height)).toBeGreaterThan(2);
    expect(bar('2026-09-28')?.props?.fill).not.toBeNull();
    expect(screen.getByLabelText(/2 with few days logged, 1 not logged/)).toBeTruthy();
  });

  it('puts protein as a second line in each table row and labels the partial week', async () => {
    await render(ui());
    expect(walk('RNSVGRect').filter((n) => String(n.props?.testID).startsWith('bar-'))).toHaveLength(4); // 4 weeks logged, 1 gap: 12 weeks, no chart of protein
    await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getByLabelText('21 Sept 2026, 1,000 kcal, few days logged, Target 2,100 kcal, 1,100 kcal under, Protein 50 g a day')).toBeTruthy();
    expect(screen.getByLabelText('14 Sept 2026, Not logged')).toBeTruthy();
    expect(screen.getByLabelText('28 Sept 2026, 2,000 kcal, Target 2,100 kcal, 100 kcal under, Below target, Protein 100 g a day')).toBeTruthy();
  });

  it('formats kcal as whole numbers with en-IN grouping', async () => {
    await render(ui({ days: [...week('2026-10-05', 4, 123456.4, 100)], kcalTarget: 0 }));
    expect(screen.getByLabelText(/^1,23,456 kcal a day/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getByLabelText('5 Oct 2026, 1,23,456 kcal, Protein 100 g a day')).toBeTruthy();
  });

  it('with no target: no line, no target in the headline, and a hint to set one', async () => {
    await render(ui({ kcalTarget: 0, proteinTarget: 0 }));
    expect(screen.getByLabelText('1,733 kcal a day, last 4 weeks. Protein 87 g a day')).toBeTruthy();
    expect(screen.getByText(/Run setup \(Targets tab\) to set a calorie target/)).toBeTruthy();
    expect(walk('RNSVGLine').some((n) => n.props?.strokeDasharray !== undefined)).toBe(false);
    expect(screen.queryByText(/^Target/)).toBeNull();
  });

  it('with one week of data draws one bar', async () => {
    await render(ui({ days: week('2026-09-28', 5, 2000) }));
    expect(walk('RNSVGRect').filter((n) => String(n.props?.testID).startsWith('bar-'))).toHaveLength(1);
    expect(screen.getByLabelText(/^2,000 kcal a day/)).toBeTruthy();
  });

  it('says to log 4 days only when nothing is logged in the 12 weeks', async () => {
    await render(ui({ days: [] }));
    expect(screen.getByText('Log food to see your weekly averages here.')).toBeTruthy();
    expect(walk('RNSVGRect')).toHaveLength(0);
  });

  it('draws hollow bars when every week has under 4 days, and the headline says how many days it rests on', async () => {
    await render(ui({ days: week('2026-10-05', 3, 2000) }));
    expect(screen.queryByText('Log food to see your weekly averages here.')).toBeNull();
    expect(bar('2026-10-05')?.props?.fill).toBeNull();
    expect(screen.getByLabelText('2,000 kcal a day, last 4 weeks, from 3 days logged, target 2,100 kcal. Protein 100 g a day, target 150 g')).toBeTruthy();
    expect(screen.getByText('kcal a day, last 4 weeks, from 3 days logged, target 2,100 kcal')).toBeTruthy();
  });

  it('with logs only 5 to 12 weeks ago still draws them, and says nothing was logged in the last 4 weeks', async () => {
    await render(ui({ days: week('2026-08-03', 5, 2000) })); // viewed 8 Oct
    expect(screen.queryByText('Log food to see your weekly averages here.')).toBeNull();
    expect(bar('2026-08-03')).toBeTruthy();
    expect(screen.getByText('No food logged in the last 4 weeks')).toBeTruthy();
    expect(screen.getByLabelText('No food logged in the last 4 weeks')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show as table' })).toBeTruthy();
  });

  it('a singular day reads "1 day"', async () => {
    await render(ui({ days: week('2026-10-05', 1, 2000) }));
    expect(screen.getByText(/from 1 day logged/)).toBeTruthy();
  });

  it('shows loading while the days are read, and an error (not stale numbers) on a failed read', async () => {
    const view = await render(ui({ days: null }));
    expect(screen.getByText('Loading…')).toBeTruthy();
    await view.rerender(ui({ days: null, failed: true }));
    expect(screen.getByText('Couldn’t read your food logs. Open this tab again to retry.')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    await view.rerender(ui({ failed: true })); // older days are not shown beside an error
    expect(screen.queryByRole('button', { name: 'Show as table' })).toBeNull();
  });

  it('has the heading, a legend for hollow bars and gaps, and no 0 kcal value anywhere', async () => {
    await render(ui());
    expect(screen.getByRole('header', { name: 'Eating by week' })).toBeTruthy();
    expect(screen.getByText('Hollow bar: few days logged. Gap: no food logged that week.')).toBeTruthy();
    expect(screen.queryByText(/^0 kcal/)).toBeNull();
  });
});
