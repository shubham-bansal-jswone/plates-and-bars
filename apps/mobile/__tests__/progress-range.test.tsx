import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { addDays, WEIGHT_CHART_BOX, type TrendPoint } from '@plate-and-bar/core';
import { dateWithYear, shortDate } from '../src/format';
import { saveWeight } from '../src/db/progress';
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
const change = (ch: { direction: string; amount: number; since: string }) => `${ch.direction} ${ch.amount} since ${ch.since}`;

function trend(series: readonly TrendPoint[], end = END) {
  return render(<RangedTrend series={series} end={end} convert={(v) => v} unit="kg" noun="Weight" box={WEIGHT_CHART_BOX} changeLine={change} />);
}
const tab = (name: string) => screen.getByRole('tab', { name });

describe('RangedTrend range control', () => {
  it('defaults to 12 weeks and the summary and change line follow the first and last plotted points', async () => {
    await trend(weekly(30)); // 12 weeks back from END is 84 days: 13 weekly points, 86 kg to 80 kg
    expect(tab('12 weeks').props.accessibilityState.selected).toBe(true);
    expect(screen.getAllByText('Weight from 86 to 80 kg')).toHaveLength(1);
    expect(screen.getByText(`down 6 since ${addDays(END, -84)}`)).toBeTruthy();
  });

  it('4 weeks and All redraw with their own first point', async () => {
    await trend(weekly(30));
    await fireEvent.press(tab('4 weeks'));
    expect(screen.getByText('Weight from 82 to 80 kg')).toBeTruthy(); // 28 days back is 82 kg
    expect(screen.getByText(`down 2 since ${addDays(END, -28)}`)).toBeTruthy();
    expect(tab('4 weeks').props.accessibilityState.selected).toBe(true);
    expect(tab('12 weeks').props.accessibilityState.selected).toBe(false);
    await fireEvent.press(tab('All'));
    expect(screen.getByText('Weight from 94.5 to 80 kg')).toBeTruthy(); // 29 weeks back
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
    expect(screen.getByText(/^Weight from 89\.\d to 70 kg$/)).toBeTruthy();
  });

  it('disables a range with fewer than 2 points and says why', async () => {
    await trend([{ date: addDays(END, -100), v: 85 }, { date: addDays(END, -90), v: 84 }, { date: END, v: 80 }]);
    // 12 weeks holds only the last point.
    expect(tab('4 weeks').props.accessibilityState.disabled).toBe(true);
    expect(tab('12 weeks').props.accessibilityState.disabled).toBe(true);
    expect(tab('All').props.accessibilityState.disabled).toBeFalsy();
    expect(screen.getByText('4 weeks: not enough data')).toBeTruthy();
    expect(screen.getByText('12 weeks: not enough data')).toBeTruthy();
    // The chosen range has no data, so the next wider one is drawn and selected.
    expect(tab('All').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('Weight from 85 to 80 kg')).toBeTruthy();
    await fireEvent.press(tab('4 weeks'));
    expect(tab('All').props.accessibilityState.selected).toBe(true);
  });

  it('with fewer than 2 points anywhere it shows the log-more note and no control', async () => {
    await trend([{ date: END, v: 80 }]);
    expect(screen.getByText('Log a few weigh-ins to see your trend line here.')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('the chart label is the visible summary', async () => {
    await trend(weekly(30));
    const summary = 'Weight from 86 to 80 kg';
    expect(screen.getByRole('image').props.accessibilityLabel).toBe(summary);
    expect(screen.getByText(summary)).toBeTruthy();
    await fireEvent.press(tab('All'));
    expect(screen.getByRole('image').props.accessibilityLabel).toBe('Weight from 94.5 to 80 kg');
    expect(screen.getByText('Weight from 94.5 to 80 kg')).toBeTruthy();
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
    expect(screen.getByText('Weight from 86 to 80 kg')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'All' }));
    expect(screen.getByText('Weight from 94.5 to 80 kg')).toBeTruthy();
    expect(screen.getByLabelText('Weight from 94.5 to 80 kg')).toBeTruthy();
  });

  it('in lb the summary, change line and table are converted once', async () => {
    await mount('lb');
    expect(screen.getByText('Weight from 189.6 to 176.4 lb')).toBeTruthy(); // 86 kg to 80 kg
    expect(screen.getByText(/^Down 13\.2 lb since /)).toBeTruthy(); // 6 kg
    await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getByLabelText(`${dateWithYear(END)}, 176.4 lb`)).toBeTruthy();
  });
});
