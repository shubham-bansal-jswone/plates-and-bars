import { Platform, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { addDays, mondayOf, WEIGHT_CHART_BOX, type TrendPoint } from '@plate-and-bar/core';
import { dateWithYear, shortDate } from '../src/format';

import { saveMeasurement, saveWeight } from '../src/db/progress';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { ChartTable } from '../src/progress/ChartTable';
import { RangedTrend } from '../src/progress/RangedTrend';
import { TrendChart } from '../src/progress/TrendChart';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { WeightUnitProvider } from '../src/settings/weightUnit';
import { CHART_MAX_WIDTH } from '../src/theme/tokens';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const END = '2026-10-08';
/** One reading a week, `weeks` weeks back from END: 80 kg now, 0.5 kg heavier for each week further back. */
const weekly = (weeks: number, end = END): TrendPoint[] =>
  Array.from({ length: weeks }, (_, i) => ({ date: addDays(end, -7 * (weeks - 1 - i)), v: 80 + (weeks - 1 - i) * 0.5 }));
const same = (v: number): number => v;
const change = (ch: { direction: string; amount: number; since: string }) => `${ch.direction} ${ch.amount} since ${ch.since}`;

function trend(series: readonly TrendPoint[], end = END) {
  return render(<RangedTrend series={series} end={end} convert={(v) => v} unit="kg" noun="Weight" box={WEIGHT_CHART_BOX} changeLine={change} />);
}
const tab = (name: string) => screen.getByRole('button', { name });
const hidden = { includeHiddenElements: true } as const;

describe('RangedTrend range control', () => {
  it('defaults to 12 weeks and the summary and change line follow the first and last plotted points', async () => {
    await trend(weekly(30)); // 12 weeks back from END is 84 days: 13 weekly points, 86 kg to 80 kg
    expect(tab('12 weeks').props.accessibilityState.selected).toBe(true);
    expect(screen.getAllByText('Weight from 86 to 80 kg', hidden)).toHaveLength(1);
    expect(screen.getByText(`down 6 since ${addDays(END, -84)}`)).toBeTruthy();
  });

  it('4 weeks and All redraw with their own first point', async () => {
    await trend(weekly(30));
    await fireEvent.press(tab('4 weeks'));
    expect(screen.getByText('Weight from 82 to 80 kg', hidden)).toBeTruthy(); // 28 days back is 82 kg
    expect(screen.getByText(`down 2 since ${addDays(END, -28)}`)).toBeTruthy();
    expect(tab('4 weeks').props.accessibilityState.selected).toBe(true);
    expect(tab('12 weeks').props.accessibilityState.selected).toBe(false);
    await fireEvent.press(tab('All'));
    expect(screen.getByText('Weight from 94.5 to 80 kg', hidden)).toBeTruthy(); // 29 weeks back
    expect(screen.getByText(`down 14.5 since ${addDays(END, -203)}`)).toBeTruthy();
  });

  it('counts back from the viewed date, not from today', async () => {
    const viewed = addDays(END, -98); // 14 weeks back, on the weekly grid
    await trend(weekly(30).filter((p) => p.date <= viewed), viewed);
    expect(screen.getByText(`down 6 since ${addDays(viewed, -84)}`)).toBeTruthy(); // 12 weeks before the viewed day, not before today
  });

  it('beyond 120 points the plotted series is weekly, and the summary matches its ends', async () => {
    const daily: TrendPoint[] = Array.from({ length: 200 }, (_, i) => ({ date: addDays(END, -(199 - i)), v: 70 + (199 - i) / 10 }));
    await trend(daily);
    await fireEvent.press(tab('All'));
    await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Show all' }));
    const rows = screen.getAllByLabelText(/, \d+(\.\d)? kg$/).length;
    expect(rows).toBeLessThan(40); // about 29 weeks, not 200 days
    // The change line starts at the plotted first point (the last day of the oldest Monday-week), not the raw first day.
    const oldest = addDays(END, -199);
    const since = daily.filter((p) => mondayOf(p.date) === mondayOf(oldest)).slice(-1)[0] as TrendPoint;
    expect(screen.getByText(`down ${Math.round((since.v - 70) * 10) / 10} since ${since.date}`)).toBeTruthy();
    expect(screen.getByText(/^Weight from 89\.\d to 70 kg$/, hidden)).toBeTruthy();
  });

  it('disables a range with fewer than 2 points and says why', async () => {
    await trend([{ date: addDays(END, -100), v: 85 }, { date: addDays(END, -90), v: 84 }, { date: END, v: 80 }]);
    // 12 weeks holds only the last point.
    expect(tab('4 weeks, not enough data').props.accessibilityState.disabled).toBe(true);
    expect(tab('12 weeks, not enough data').props.accessibilityState.disabled).toBe(true);
    expect(tab('All').props.accessibilityState.disabled).toBeFalsy();
    expect(screen.getByText('4 weeks: not enough data')).toBeTruthy();
    expect(screen.getByText('12 weeks: not enough data')).toBeTruthy();
    // The chosen range has no data, so the next wider one is drawn and selected.
    expect(tab('All').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('Weight from 85 to 80 kg', hidden)).toBeTruthy();
    await fireEvent.press(tab('4 weeks, not enough data'));
    expect(tab('All').props.accessibilityState.selected).toBe(true);
  });

  it('follows a new viewed date while mounted, with the same series object', async () => {
    const series = weekly(30).filter((p) => p.date <= addDays(END, -98));
    const view = (end: string) => <RangedTrend series={series} end={end} convert={same} unit="kg" noun="Weight" box={WEIGHT_CHART_BOX} changeLine={change} />;
    const { rerender } = await render(view(addDays(END, -98)));
    expect(screen.getByText(`down 6 since ${addDays(END, -182)}`)).toBeTruthy();
    await rerender(view(addDays(END, -70))); // 12 weeks back from here starts 4 weeks later
    expect(screen.getByText(`down 4 since ${addDays(END, -154)}`)).toBeTruthy();
  });

  it('keeps the choice through a fallback: only what is drawn changes, and 4 weeks returns with data', async () => {
    const all = weekly(30);
    const gap = addDays(END, -50); // up to here the last 4 weeks hold at most the last point... pick a date whose 4w window is empty of points
    const series = all.filter((p) => p.date <= END && (p.date <= gap || p.date === END));
    const view = (end: string) => <RangedTrend series={series.filter((p) => p.date <= end)} end={end} convert={same} unit="kg" noun="Weight" box={WEIGHT_CHART_BOX} changeLine={change} />;
    const { rerender } = await render(view(addDays(gap, 0)));
    await fireEvent.press(tab('4 weeks'));
    expect(tab('4 weeks').props.accessibilityState.selected).toBe(true);
    await rerender(view(END)); // 4 weeks holds one point: drawn as 12 weeks
    expect(tab('4 weeks, not enough data').props.accessibilityState.selected).toBe(false);
    expect(tab('12 weeks').props.accessibilityState.selected).toBe(true);
    await rerender(view(addDays(gap, 0)));
    expect(tab('4 weeks').props.accessibilityState.selected).toBe(true);
  });

  it('the visible change line keeps the number with its unit (non-breaking space) (#1409)', async () => {
    await render(<RangedTrend series={weekly(5)} end={END} convert={same} unit="kg" noun="Weight" box={WEIGHT_CHART_BOX} changeLine={(ch) => `Down ${ch.amount} kg since ${ch.since}`} />);
    const raw = screen.getByText(/^Down [\d.]+.kg since/).props.children as string | string[];
    const text = Array.isArray(raw) ? raw.join('') : raw;
    expect(text).toMatch(/^Down [\d.]+\u00a0kg since/);
    expect(text).not.toMatch(/\d kg/);
  });

  it('with fewer than 2 points anywhere it shows the log-more note and no control', async () => {
    await trend([{ date: END, v: 80 }]);
    expect(screen.getByText('Log a few weigh-ins to see your trend line here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /weeks|^All/ })).toBeNull();
  });

  it('the chart label is the visible summary', async () => {
    await trend(weekly(30));
    const summary = 'Weight from 86 to 80 kg';
    expect(screen.getByRole('image').props.accessibilityLabel).toBe(summary);
    expect(screen.getByText(summary, hidden)).toBeTruthy();
    expect(screen.queryByText(summary)).toBeNull(); // the visible copy is hidden from assistive tech: the image label says it once
    await fireEvent.press(tab('All'));
    expect(screen.getByRole('image').props.accessibilityLabel).toBe('Weight from 94.5 to 80 kg');
    expect(screen.getByText('Weight from 94.5 to 80 kg', hidden)).toBeTruthy();
  });

  it('every segment is at least 44px tall', async () => {
    await trend(weekly(30));
    for (const n of ['4 weeks', '12 weeks', 'All']) expect(StyleSheet.flatten(tab(n).props.style).minHeight).toBeGreaterThanOrEqual(44);
  });
});

describe('ChartTable', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ date: addDays(END, -(n - 1 - i)), value: `${80 + i} kg` }));

  it('is closed until the button is pressed, then lists the newest 12 rows with Show all for the rest', async () => {
    await render(<ChartTable rows={rows(20)} noun="Weight" valueHeader="kg" />);
    expect(screen.queryAllByLabelText(/, \d+ kg$/)).toHaveLength(0);
    const open = screen.getByRole('button', { name: 'Show as table' });
    expect(open.props.accessibilityState.expanded).toBe(false);
    expect(StyleSheet.flatten(open.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(open);
    expect(screen.getByRole('button', { name: 'Hide table' }).props.accessibilityState.expanded).toBe(true);
    const shown = screen.getAllByLabelText(/, \d+ kg$/);
    expect(shown).toHaveLength(12);
    expect(shown[0]?.props.accessibilityLabel).toBe(`${dateWithYear(END)}, 99 kg`); // newest first
    await fireEvent.press(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getAllByLabelText(/, \d+ kg$/)).toHaveLength(20);
    await fireEvent.press(screen.getByRole('button', { name: 'Show last 12' }));
    expect(screen.getAllByLabelText(/, \d+ kg$/)).toHaveLength(12);
    await fireEvent.press(screen.getByRole('button', { name: 'Hide table' }));
    expect(screen.queryAllByLabelText(/, \d+ kg$/)).toHaveLength(0);
  });

  it('on web is a table of rows with columnheader and cell parts and no per-row labels', async () => {
    const was = Platform.OS;
    Platform.OS = 'web';
    try {
      const { toJSON } = await render(<ChartTable rows={rows(2)} noun="Weight" valueHeader="kg" />);
      await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
      const found: Record<string, number> = {};
      let table: Record<string, unknown> | undefined;
      const visit = (n: unknown) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(visit);
        const x = n as { props?: Record<string, unknown>; children?: unknown };
        const r = x.props?.role as string | undefined;
        if (r) found[r] = (found[r] ?? 0) + 1;
        if (r === 'table') table = x.props;
        if (x.props?.accessibilityRole === 'text' || x.props?.accessibilityRole === 'header') found.legacy = 1;
        visit(x.children);
      };
      visit(toJSON());
      expect(found).toMatchObject({ table: 1, row: 3, columnheader: 2, cell: 4 });
      expect(found.legacy).toBeUndefined();
      expect(table?.['aria-label']).toBe('Weight: table, newest first');
      // Show all is a sibling of the table, not a child: a table may only hold rows (axe aria-required-children).
      await screen.unmount();
      const big = await render(<ChartTable rows={rows(14)} noun="Weight" valueHeader="kg" />);
      await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
      const inside = (n: unknown, within = false): boolean => !!n && typeof n === 'object' && (Array.isArray(n) ? n.some((x) => inside(x, within)) : (() => { const x = n as { props?: Record<string, unknown>; children?: unknown }; const now = within || x.props?.role === 'table'; return (now && (x.props?.accessibilityLabel === 'Show all' || x.props?.['aria-label'] === 'Show all')) || inside(x.children, now); })());
      expect(inside(big.toJSON())).toBe(false);
      expect(inside(big.toJSON(), true)).toBe(true); // the finder does see the button, so the check above is not vacuous
      expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy();
    } finally {
      Platform.OS = was;
    }
  });

  it('has no Show all with 12 rows or fewer, and nothing with no rows', async () => {
    await render(<ChartTable rows={rows(12)} noun="Weight" valueHeader="kg" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    await screen.unmount();
    await render(<ChartTable rows={[]} noun="Weight" valueHeader="kg" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

interface N { type?: string; props?: Record<string, unknown> & { font?: { fontSize?: unknown } }; children?: N[] | null }
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

describe('TrendChart additions', () => {
  const pts = [{ date: '2026-09-01', v: 82 }, { date: '2026-10-05', v: 80.5 }];
  const box = { W: 320, H: 150, px: 34, py: 16 };

  it('shows the first and last date, and the last value with its unit beside the last date', async () => {
    await render(<TrendChart points={pts} box={box} label="Weight" unit="kg" />);
    expect(screen.getByText(shortDate('2026-09-01'), { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(new RegExp(`^${shortDate('2026-10-05')}`), { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(/· 80\.5 kg$/, { includeHiddenElements: true })).toBeTruthy();
  });

  it('adds the year to both dates when the series spans two years', async () => {
    await render(<TrendChart points={[{ date: '2025-12-20', v: 82 }, { date: '2026-01-05', v: 80 }]} box={box} label="Weight" />);
    expect(screen.getByText(dateWithYear('2025-12-20'), { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(new RegExp(`^${dateWithYear('2026-01-05')}`), { includeHiddenElements: true })).toBeTruthy();
  });

  it('axis and value labels are at least 12px as drawn', async () => {
    await render(<TrendChart points={pts} box={box} label="Weight" unit="kg" />);
    const sizes = walk('RNSVGText').map((t) => Number(t.props?.font?.fontSize));
    expect(sizes.length).toBe(2);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(12);
  });

  it('draws no target line by default, and one at half opacity in ink when given a target', async () => {
    await render(<TrendChart points={pts} box={box} label="Weight" unit="kg" />);
    const base = walk('RNSVGLine').length;
    await screen.unmount();
    await render(<TrendChart points={pts} box={box} label="Weight" unit="kg" target={78} />);
    const lines = walk('RNSVGLine');
    expect(lines.length).toBe(base + 1);
    expect(lines.some((l) => l.props?.strokeOpacity === 0.5 || JSON.stringify(l.props).includes('0.5'))).toBe(true);
    expect(screen.getByText('Target 78 kg')).toBeTruthy();
  });

  it('a target moves the line vertically only: every circle keeps its x', async () => {
    const cx = () => walk('RNSVGCircle').map((n) => JSON.stringify(n.props).match(/"cx":([\d.]+)/)?.[1]);
    await render(<TrendChart points={pts} box={box} label="Weight" unit="kg" />);
    const without = cx();
    await screen.unmount();
    await render(<TrendChart points={pts} box={box} label="Weight" unit="kg" target={78} />);
    expect(cx()).toEqual(without);
    expect(without.length).toBe(2);
    await screen.unmount();
    // A target far above the data pushes the points to the bottom edge: y comes from the layout that includes the target.
    await render(<TrendChart points={pts} box={box} label="Weight" unit="kg" target={200} />);
    const cys = walk('RNSVGCircle').map((n) => Number(JSON.stringify(n.props).match(/"cy":([\d.]+)/)?.[1]));
    expect(cys).toHaveLength(2);
    for (const cy of cys) expect(Math.abs(cy - (box.H - box.py))).toBeLessThan(4);
  });

  it('spaces the points by date, not by index (#1370): weigh-ins 3 and 7 days apart are drawn 3 and 7 units apart', async () => {
    const irregular = [{ date: '2026-10-01', v: 80 }, { date: '2026-10-04', v: 78 }, { date: '2026-10-11', v: 77 }];
    await render(<TrendChart points={irregular} box={box} label="Weight" unit="kg" />);
    const cx = walk('RNSVGCircle').map((n) => Number(JSON.stringify(n.props).match(/"cx":([\d.]+)/)?.[1]));
    // 34 + 278 * 3 / 10 = 117.4, not the index midpoint 173.
    expect(cx[0]).toBeCloseTo(34, 6);
    expect(cx[1]).toBeCloseTo(117.4, 6);
    expect(cx[2]).toBeCloseTo(312, 6);
  });

  it('two points on one date both render, at the same x (#1370)', async () => {
    const same = [{ date: '2026-10-01', v: 80 }, { date: '2026-10-05', v: 79 }, { date: '2026-10-05', v: 81 }];
    await render(<TrendChart points={same} box={box} label="e1RM" />);
    const cx = walk('RNSVGCircle').map((n) => Number(JSON.stringify(n.props).match(/"cx":([\d.]+)/)?.[1]));
    expect(cx).toHaveLength(3);
    expect(cx[1]).toBeCloseTo(cx[2] as number, 9);
    expect(cx[2]).toBeCloseTo(312, 6);
  });

  it('the dates row is hidden from assistive tech, as the label carries them', async () => {
    await render(<TrendChart points={pts} box={box} label="Weight" unit="kg" />);
    const first = screen.getByText(shortDate('2026-09-01'), { includeHiddenElements: true });
    expect(first.parent?.props['aria-hidden']).toBe(true);
    expect(first.parent?.props.accessibilityElementsHidden).toBe(true);
  });

  it('is capped at CHART_MAX_WIDTH', async () => {
    expect(CHART_MAX_WIDTH).toBe(560);
    await render(<TrendChart points={pts} box={box} label="Weight" />);
    const root = screen.toJSON() as unknown as { props: { style: unknown } };
    expect(StyleSheet.flatten(root.props.style as never).maxWidth).toBe(CHART_MAX_WIDTH);
  });
});

describe('Progress screen range and unit', () => {
  const KEY = 'settings:device.weight_unit';
  const profile = () =>
    buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
  async function mount(unit: 'kg' | 'lb') {
    const db = memoryDb();
    if (unit === 'lb') db.rows.set(KEY, 'lb');
    await saveSettings(db, defaultSettings('2026-10-08T00:00:00Z'));
    await saveProfile(db, profile());
    for (const p of weekly(30)) await saveWeight(db, { id: null, version: 0, updated_at: `${p.date}T00:00:00Z`, deleted_at: null, date: p.date, weight_kg: p.v });
    await render(withProfile(db, <WeightUnitProvider db={db}><ProgressScreen db={db} now={() => new Date(2026, 9, 8, 10, 0, 0)} /></WeightUnitProvider>));
    await screen.findByRole('header', { name: 'Progress' });
  }

  it('switching to All on the weight card changes the summary (kg)', async () => {
    await mount('kg');
    expect(screen.getByText('Weight from 86 to 80 kg', hidden)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Weight from 94.5 to 80 kg', hidden)).toBeTruthy();
    expect(screen.getByLabelText('Weight from 94.5 to 80 kg')).toBeTruthy();
  });

  it('in lb the summary, change line and table are converted once', async () => {
    await mount('lb');
    expect(screen.getByText('Weight from 189.6 to 176.4 lb', hidden)).toBeTruthy(); // 86 kg to 80 kg
    expect(screen.getByText(/^Down 13\.2 lb since /)).toBeTruthy(); // 6 kg
    await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getByLabelText(`${dateWithYear(END)}, 176.4 lb`)).toBeTruthy();
  });

  it('the recent weigh-ins have their own heading, apart from the chart table', async () => {
    await mount('kg');
    expect(screen.getByRole('header', { name: 'Recent weigh-ins' })).toBeTruthy();
  });

  it('one waist measurement shows the same kind of hint as weight, and none shows nothing', async () => {
    const tape = { id: null, version: 0, updated_at: '2026-10-08T00:00:00Z', deleted_at: null, date: '2026-10-08', waist_cm: 90, neck_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, hips_cm: null };
    const db = memoryDb();
    await saveSettings(db, defaultSettings('2026-10-08T00:00:00Z'));
    await saveProfile(db, profile());
    await render(withProfile(db, <WeightUnitProvider db={db}><ProgressScreen db={db} now={() => new Date(2026, 9, 8, 10, 0, 0)} /></WeightUnitProvider>));
    await screen.findByRole('header', { name: 'Progress' });
    expect(screen.queryByText('Log a few waist measurements to see your trend line here.')).toBeNull();
    await screen.unmount();
    await saveMeasurement(db, tape);
    await render(withProfile(db, <WeightUnitProvider db={db}><ProgressScreen db={db} now={() => new Date(2026, 9, 8, 10, 0, 0)} /></WeightUnitProvider>));
    expect(await screen.findByText('Log a few waist measurements to see your trend line here.')).toBeTruthy();
  });
});
