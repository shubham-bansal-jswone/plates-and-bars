import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { addDays, type ExType, type PrSet } from '@plate-and-bar/core';
import { dateWithYear } from '../src/format';
import { StrengthSection } from '../src/progress/StrengthSection';
import { setsBefore, setsInRange } from '../src/progress/setsView';
import { E1RM_NOTE } from '../src/progress/E1rmTrend';
import type { ProgressSets } from '../src/progress/useProgressSets';

jest.mock('expo-router', () => ({ useFocusEffect: () => undefined }));
let mockHook: ProgressSets;
let mockUnit: 'kg' | 'lb' = 'kg';
let mockProfileKg = 80;
jest.mock('../src/progress/useProgressSets', () => ({ useProgressSets: () => mockHook }));
jest.mock('../src/settings/weightUnit', () => ({ useWeightUnit: () => ({ unit: mockUnit }) }));
jest.mock('../src/state/ProfileProvider', () => ({ useProfile: () => ({ profile: { weight_kg: mockProfileKg } }) }));
jest.mock('../src/state/SettingsProvider', () => ({ useOptionalSettings: () => null }));
jest.mock('../src/sync/useDataVersion', () => ({ useDataVersion: () => 0 }));
let mockWidth = 800;
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: mockWidth, height: 800, scale: 1, fontScale: mockFontScale }) }));

const END = '2026-10-08';
const hidden = { includeHiddenElements: true } as const;
const set = (date: string, exercise: string, w: number, r: number): PrSet => ({ date, exercise, kind: 'work', weight_kg: w, reps: r, done: true, rate: null, deleted_at: null });
/** One session a week for `n` weeks ending END; the weight rises 2.5 kg a week so every session is a record. */
const weekly = (exercise: string, n: number, start: number, step = 2.5): PrSet[] => Array.from({ length: n }, (_, i) => set(addDays(END, -7 * (n - 1 - i)), exercise, start + i * step, 5));
const hook = (all: PrSet[], types: Record<string, ExType> = {}, o: Partial<ProgressSets> = {}): ProgressSets => {
  const sorted = [...all].sort((a, b) => (a.date < b.date ? -1 : 1));
  const names = new Set(sorted.map((s) => s.exercise));
  return { all: sorted, types: { ...Object.fromEntries([...names].map((n) => [n, 'barbell' as ExType])), ...types }, inRange: (e, r) => setsInRange(sorted, e, r), before: (d) => setsBefore(sorted, d), loading: false, error: null, ...o };
};
const show = (weights: { date: string; weight_kg: number; deleted_at?: string | null }[] = []) => render(<StrengthSection sets={mockHook} date={END} weights={weights as never} />);
const e1rm = (w: number, r = 5) => Math.round(w * (1 + r / 30) * 10) / 10;

beforeEach(() => { mockFontScale = 1; mockUnit = 'kg'; mockWidth = 800; mockProfileKg = 80; });

describe('lead lift and chips', () => {
  it('leads with the top lift by sessions and a sentence with the change over the range', async () => {
    // Bench: 8 sessions, 60 to 77.5 kg; Squat: 4 sessions; Row: 3 sessions.
    mockHook = hook([...weekly('Bench Press', 8, 60), ...weekly('Squat', 4, 100), ...weekly('Row', 3, 50)]);
    await show();
    const top = e1rm(77.5), first = e1rm(60);
    const d = Math.round((top - first) * 10) / 10;
    const sentence = `Bench Press estimated 1-rep max ${Math.round(top * 10) / 10} kg, up ${d} kg in 7 weeks`;
    expect(screen.getByLabelText(sentence)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bench Press' }).props.accessibilityState.selected).toBe(true);
    for (const n of ['Squat', 'Row']) expect(screen.getByRole('button', { name: n })).toBeTruthy();
  });

  it('the shown sentence keeps each number with its unit (non-breaking space); the spoken label keeps plain spaces (#1409)', async () => {
    mockHook = hook([...weekly('Bench Press', 8, 60)]);
    await show();
    const top = Math.round(e1rm(60 + 7 * 2.5) * 10) / 10;
    const shown = screen.getByText(/^Bench Press estimated 1-rep max/, hidden);
    const raw = (shown.props.children as string[] | string);
    const text = Array.isArray(raw) ? raw.join('') : raw;
    expect(text).toContain(`${top}\u00a0kg`);
    expect(text).not.toMatch(/\d kg/);
    expect(screen.getByLabelText(new RegExp(`max ${top} kg, up`))).toBeTruthy();
  });

  it('chips switch the lift and the choice is held while the section stays mounted', async () => {
    mockHook = hook([...weekly('Bench Press', 8, 60), ...weekly('Squat', 4, 100)]);
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Squat' }));
    expect(screen.getByLabelText(new RegExp(`^Squat estimated 1-rep max ${e1rm(107.5)} kg, up`))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Squat' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Bench Press' }).props.accessibilityState.selected).toBe(false);
  });

  it('"Choose lift" lists lifts with at least 2 estimates that are not chips, and a pick becomes a chip', async () => {
    // Four lifts with 3+ sessions in 12 weeks: the 4th goes to the list. Curl has 2 sessions long ago: listed. Dip has 1: not listed.
    mockHook = hook([
      ...weekly('Bench Press', 8, 60), ...weekly('Squat', 7, 100), ...weekly('Row', 6, 50), ...weekly('Deadlift', 5, 120),
      set('2026-01-05', 'Curl', 20, 8), set('2026-01-12', 'Curl', 22, 8), set('2026-01-12', 'Dip', 10, 8),
    ]);
    await show();
    expect(screen.queryByRole('button', { name: 'Deadlift' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose lift' }));
    expect(screen.getByRole('button', { name: 'Deadlift' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Curl' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dip' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Curl' }));
    expect(screen.getByRole('button', { name: 'Curl' }).props.accessibilityState.selected).toBe(true); // now a chip
    expect(screen.queryByRole('list', { name: 'Lifts to show' })).toBeNull();
  });

  it('chips and "Choose lift" are 44px tall', async () => {
    mockHook = hook([...weekly('Bench Press', 8, 60), ...weekly('Squat', 4, 100), set('2026-01-05', 'Curl', 20, 8), set('2026-01-12', 'Curl', 22, 8)]);
    await show();
    for (const n of ['Bench Press', 'Choose lift']) {
      const el = screen.getByRole('button', { name: n });
      expect(StyleSheet.flatten(el.props.style).minHeight).toBe(44);
    }
  });

  it('a bodyweight lift is never a lead lift', async () => {
    mockHook = hook([...weekly('Push-up', 6, 0, 0).map((s) => ({ ...s, reps: 20 })), ...weekly('Squat', 4, 100)], { 'Push-up': 'bodyweight' });
    await show();
    expect(screen.queryByRole('button', { name: 'Push-up' })).toBeNull();
    expect(screen.getByRole('image').props.accessibilityLabel).toMatch(/^Squat estimated 1-rep max /);
  });
});

describe('range', () => {
  it('the range control narrows the line and the sentence', async () => {
    mockHook = hook(weekly('Bench Press', 14, 40)); // 13 weeks
    await show();
    expect(screen.getByLabelText(new RegExp(`in 12 weeks$`))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '4 weeks' }));
    expect(screen.getByLabelText(/in 4 weeks$/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByLabelText(/in 13 weeks$/)).toBeTruthy();
  });

  it('a range with under 2 points is disabled and the next wider one is drawn', async () => {
    mockHook = hook([...weekly('Bench Press', 5, 60).slice(0, 4), set(END, 'Bench Press', 80, 5)].map((s, i) => (i < 4 ? { ...s, date: addDays(END, -60 - 7 * (4 - i)) } : s)));
    await show();
    // 4 weeks has one point (END); 12 weeks has 5.
    expect(screen.getByRole('button', { name: '4 weeks, not enough data' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: '12 weeks' }));
    expect(screen.getByText('4 weeks: not enough data')).toBeTruthy();
  });
});

describe('table and note', () => {
  it('the table lists the drawn points and the formula note shows once', async () => {
    mockHook = hook(weekly('Bench Press', 4, 60));
    await show();
    expect(screen.getAllByText(E1RM_NOTE)).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getByLabelText('Bench Press estimated 1-rep max: table, newest first')).toBeTruthy();
  });
});

describe('recent personal bests', () => {
  it('lists records newest first with the metric, date and gain on the previous best', async () => {
    mockHook = hook(weekly('Bench Press', 4, 60));
    await show();
    // 3 records (the first session never counts)
    const rows = screen.getAllByLabelText(/^Personal best, Bench Press/);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.props.accessibilityLabel).toBe(`Personal best, Bench Press 67.5 kg x 5, estimated 1RM 78.8 kg (+3 kg), 8 Oct`);
    expect(screen.getAllByText('Personal best')).toHaveLength(3);
  });

  it('uses all history: a best set before the range is the bar to beat, and an old record outside the range still shows', async () => {
    // Old best 120 kg, 20 weeks ago, then lighter weeks, then a new best inside the range.
    mockHook = hook([set(addDays(END, -150), 'Squat', 100, 5), set(addDays(END, -140), 'Squat', 120, 5), set(addDays(END, -14), 'Squat', 110, 5), set(addDays(END, -7), 'Squat', 118, 5), set(END, 'Squat', 125, 5)]);
    await show();
    const rows = screen.getAllByLabelText(/^Personal best, Squat/).map((r) => r.props.accessibilityLabel as string);
    // 125 beats the all-time 120 (140 to 145.8: +5.8); 118 is not a record, and a range-only view would not know the 120.
    expect(rows[0]).toContain('estimated 1RM 145.8 kg');
    expect(rows[0]).toContain('(+5.8 kg)');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('estimated 1RM 140 kg'); // the old record, outside the range
  });

  it('shows up to 5 rows, 3 on a narrow screen', async () => {
    mockHook = hook(weekly('Bench Press', 9, 60));
    await show();
    expect(screen.getAllByLabelText(/^Personal best,/)).toHaveLength(5);
    await screen.unmount();
    mockWidth = 375;
    await show();
    expect(screen.getAllByLabelText(/^Personal best,/)).toHaveLength(3);
  });

  it('does not list records after the viewed date', async () => {
    mockHook = hook([...weekly('Bench Press', 4, 60), set(addDays(END, 7), 'Bench Press', 100, 5)]);
    await show();
    expect(screen.getAllByLabelText(/^Personal best,/)).toHaveLength(3);
  });

  it('assisted lifts are scored at the latest weigh-in on or before the viewed date, else the profile weight', async () => {
    // Day A: 10 reps with 30 kg assistance. Day B: 12 reps with 40 kg. Score = reps * (bodyweight - assist).
    mockHook = hook([set(addDays(END, -14), 'Assisted Pull-up', 30, 10), set(END, 'Assisted Pull-up', 40, 12)], { 'Assisted Pull-up': 'assisted' });
    const pr = /^Personal best, Assisted Pull-up, 12 reps with 40 kg of assistance, /;
    // 100 kg weigh-in before the viewed date: 12 x 60 = 720 beats 10 x 70 = 700.
    await show([{ date: addDays(END, -3), weight_kg: 100 }]);
    expect(screen.getByLabelText(pr)).toBeTruthy();
    await screen.unmount();
    // No weigh-in: the profile's 80 kg gives 480 against 500, no record.
    await show([]);
    expect(screen.queryByLabelText(pr)).toBeNull();
    expect(screen.getByText('No personal bests yet.')).toBeTruthy();
    await screen.unmount();
    // A 100 kg weigh-in after the viewed date does not count: still the profile weight.
    await show([{ date: addDays(END, 2), weight_kg: 100 }]);
    expect(screen.queryByLabelText(pr)).toBeNull();
    expect(screen.getByText('No personal bests yet.')).toBeTruthy();
  });

  it('an assisted row in lb gives the assistance in lb: 30 kg is 66.1 lb', async () => {
    mockUnit = 'lb';
    mockHook = hook([set(addDays(END, -7), 'Assisted Pull-up', 40, 10), set(END, 'Assisted Pull-up', 30, 10)], { 'Assisted Pull-up': 'assisted' });
    await show([{ date: END, weight_kg: 90 }]);
    expect(screen.getByLabelText(/^Personal best, Assisted Pull-up, 10 reps with 66\.1 lb of assistance, /)).toBeTruthy();
    expect(screen.queryByText(/ kg/)).toBeNull();
  });

  it('words rep-based records by their metric', async () => {
    mockHook = hook([set(addDays(END, -7), 'Push-up', 0, 20), set(END, 'Push-up', 0, 25)], { 'Push-up': 'bodyweight' });
    await show();
    expect(screen.getByLabelText(/^Personal best, Push-up, 25 reps in total \(\+5\), /)).toBeTruthy();
  });

  it('with no records it says so', async () => {
    mockHook = hook(weekly('Bench Press', 1, 60));
    await show();
    expect(screen.getByText('No personal bests yet.')).toBeTruthy();
  });
});

describe('more cases', () => {
  it('a falling lift says "down" with a positive amount', async () => {
    mockHook = hook(weekly('Bench Press', 4, 80, -2.5));
    await show();
    expect(screen.getByRole('image').props.accessibilityLabel).toMatch(/, down \d+(\.\d)? kg in 3 weeks$/);
    expect(screen.queryByLabelText(/down -/)).toBeNull();
  });

  it('a chosen 4 weeks stays chosen: on a date where it has under 2 points the next wider range is drawn, and it comes back', async () => {
    mockHook = hook([0, 7, 14, 21, 60, 90].map((n, i) => set(addDays(END, -n), 'Bench Press', 100 - i * 5, 5)));
    const r = await show();
    await fireEvent.press(screen.getByRole('button', { name: '4 weeks' }));
    expect(screen.getByRole('image').props.accessibilityLabel).toMatch(/in 3 weeks$/);
    const at = (d: string) => <StrengthSection sets={mockHook} date={d} weights={[] as never} />;
    await r.rerender(at(addDays(END, -40))); // 4 weeks holds one set; 12 weeks holds two, 30 days apart (4 weeks, rounded)
    expect(screen.getByRole('button', { name: '4 weeks, not enough data' }).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByRole('image').props.accessibilityLabel).toMatch(/up 5.8 kg in 4 weeks$/);
    await r.rerender(at(END));
    expect(screen.getByRole('button', { name: '4 weeks' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('image').props.accessibilityLabel).toMatch(/in 3 weeks$/);
  });

  it('a timed-lift PR is worded in seconds', async () => {
    mockHook = hook([set(addDays(END, -7), 'Plank', 0, 40), set(END, 'Plank', 0, 50)], { Plank: 'time' });
    await show();
    expect(screen.getByLabelText(/^Personal best, Plank, 50 sec in total \(\+10\), /)).toBeTruthy();
  });

  it('a record from a previous year shows its year', async () => {
    mockHook = hook([set('2025-12-20', 'Squat', 100, 5), set('2025-12-27', 'Squat', 120, 5)]);
    await show();
    expect(screen.getByLabelText(new RegExp(`, ${dateWithYear('2025-12-27')}$`))).toBeTruthy();
  });

  it('only bodyweight lifts: the empty copy shows and the rep records still list', async () => {
    mockHook = hook([set(addDays(END, -7), 'Push-up', 0, 20), set(END, 'Push-up', 0, 25)], { 'Push-up': 'bodyweight' });
    await show();
    expect(screen.getByText('Log a few sessions with weights and your strength trend shows here.')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Personal best, Push-up/)).toHaveLength(1);
  });

  it('the narrow rule counts large text: 3 rows at 768 with font scale 2, 5 at exactly 400 only with scale 1', async () => {
    mockHook = hook(weekly('Bench Press', 9, 60));
    mockWidth = 768; mockFontScale = 2;
    await show();
    expect(screen.getAllByLabelText(/^Personal best,/)).toHaveLength(3);
    await screen.unmount();
    mockWidth = 400; mockFontScale = 1;
    await show();
    expect(screen.getAllByLabelText(/^Personal best,/)).toHaveLength(3); // 400 is still narrow
    await screen.unmount();
    mockWidth = 401;
    await show();
    expect(screen.getAllByLabelText(/^Personal best,/)).toHaveLength(5);
  });
});

describe('states', () => {
  it('loading shows "Loading…" and no lift', async () => {
    mockHook = hook([], {}, { loading: true });
    await show();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText(/Log a few sessions/)).toBeNull();
  });

  it('an error shows the error and never the stale sets', async () => {
    mockHook = hook(weekly('Bench Press', 6, 60), {}, { error: new Error('x') });
    await show();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Your strength history could not be loaded.')).toBeTruthy();
    expect(screen.queryByText(/Bench Press/)).toBeNull();
    expect(screen.queryAllByLabelText(/^Personal best/)).toHaveLength(0);
  });

  it('a reload that keeps the previous sets shows them, not "Loading…"', async () => {
    mockHook = hook(weekly('Bench Press', 6, 60), {}, { loading: true });
    await show();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByRole('image').props.accessibilityLabel).toMatch(/^Bench Press estimated 1-rep max /);
  });

  it('empty history shows the empty copy', async () => {
    mockHook = hook([]);
    await show();
    expect(screen.getByText('Log a few sessions with weights and your strength trend shows here.')).toBeTruthy();
  });

  it('one point shows the number and the sentence only: no chart, range control or table', async () => {
    mockHook = hook([set(END, 'Bench Press', 80, 5)]);
    await show();
    expect(screen.getByText(`Bench Press estimated 1-rep max ${e1rm(80)} kg`)).toBeTruthy();
    // The single-point sentence keeps the number with its unit: the raw text has a non-breaking space, which getByText's normalizer hides (#1409).
    const raw = screen.getByText(/^Bench Press estimated 1-rep max/).props.children as string | string[];
    expect(Array.isArray(raw) ? raw.join('') : raw).toBe(`Bench Press estimated 1-rep max ${e1rm(80)}\u00a0kg`);
    expect(screen.getByText(`${e1rm(80)} kg`, hidden)).toBeTruthy();
    expect(screen.queryByRole('image')).toBeNull();
    expect(screen.queryByRole('button', { name: '12 weeks' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show as table' })).toBeNull();
  });
});

describe('units and spoken label', () => {
  it('in lb the number, change and records are converted once from kg', async () => {
    mockUnit = 'lb';
    mockHook = hook(weekly('Bench Press', 4, 60));
    await show();
    // 67.5 kg x5 -> 78.75 kg = 173.6 lb; the change 78.8 - 70 = 8.8 kg = 19.4 lb, taken in kg and converted once
    expect(screen.getByLabelText('Bench Press estimated 1-rep max 173.7 lb, up 19.4 lb in 3 weeks')).toBeTruthy();
    expect(screen.getByText('Bench Press 148.8 lb x 5, estimated 1RM 173.7 lb (+6.6 lb)')).toBeTruthy(); // 67.5 kg, 3 kg gain
    expect(screen.queryByText(/ kg/)).toBeNull();
  });

  it('the chart label equals the visible sentence, and the visible sentence is hidden from assistive tech', async () => {
    mockHook = hook(weekly('Bench Press', 4, 60));
    await show();
    const image = screen.getByRole('image');
    const label = image.props.accessibilityLabel as string;
    const visible = screen.getByText(label, hidden);
    expect(visible.parent?.props['aria-hidden']).toBe(true);
    expect(screen.queryByText(label)).toBeNull(); // not reachable: only the image carries it
    expect(screen.getAllByLabelText(label)).toHaveLength(1);
    // The big number repeats the sentence's figure: hidden too, so it is not read twice.
    expect(screen.getByTestId('lead-number', hidden).props['aria-hidden']).toBe(true);
  });

  it('with one point there is no image, so the sentence is the spoken text and the number is the one hidden', async () => {
    mockHook = hook([set(END, 'Bench Press', 80, 5)]);
    await show();
    expect(screen.getByTestId('lead-number', hidden).props['aria-hidden']).toBe(true);
    expect(screen.getByText(`Bench Press estimated 1-rep max ${e1rm(80)} kg`).parent?.props['aria-hidden']).toBeUndefined();
  });
});
