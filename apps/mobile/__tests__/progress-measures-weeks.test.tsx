import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { addDays } from '@plate-and-bar/core';
import { saveMeasurement } from '../src/db/progress';
import { saveProfile } from '../src/db/records';
import { saveSet, saveWorkout } from '../src/db/workouts';
import { choosePart } from '../src/progress/measureParts';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

const mockFocus = { n: 0 };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  // Runs on mount and again each time `mockFocus.n` changes on a re-render (the tab being shown again).
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [mockFocus.n]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0); // Thursday; the week began Monday 2026-10-05
const hidden = { includeHiddenElements: true } as const;

// 3 plan days: the goal is 2 sessions a week.
const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '175', weight: '82', activity: 'sitting', where: 'gym', days: 3, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );

type Db = ReturnType<typeof memoryDb>;
type Tape = Partial<Record<'waist_cm' | 'neck_cm' | 'chest_cm' | 'arm_cm' | 'thigh_cm' | 'hips_cm', number>>;
const tape = (db: Db, date: string, t: Tape) =>
  saveMeasurement(db, { id: null, version: 0, updated_at: `${date}T00:00:00Z`, deleted_at: null, date, waist_cm: null, neck_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, hips_cm: null, ...t });
const session = async (db: Db, date: string) => {
  await saveWorkout(db, { id: null, version: 0, updated_at: '', deleted_at: null, date, template: 'Upper A', base: 'Upper A', where: 'gym', cardio_min: 0, mods: {}, exercises: [], ci_choice: null });
  await saveSet(db, date, { id: `s-${date}`, version: 0, updated_at: '', deleted_at: null, workout_id: null, exercise: 'Bench', kind: 'work', set_index: 0, weight_kg: 40, reps: 8, done: true, rate: null, t: null });
};
/** Sessions on Monday and Wednesday of the completed week `k` weeks before the current one (k = 1 is last week). */
const weekSessions = async (db: Db, ks: readonly number[], per = 2) => {
  for (const k of ks) for (let i = 0; i < per; i++) await session(db, addDays('2026-10-05', -7 * k + i * 2));
};
async function open(db: Db) {
  await saveProfile(db, profile());
  const view = await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Progress' });
  return view;
}
const chip = (name: string) => screen.getByRole('button', { name });
const chips = () => within(screen.getByLabelText('Measurement part')).getAllByRole('button').map((b) => b.props.accessibilityLabel as string);

describe('Measurements part picker', () => {
  it('lists every part with a reading and none without, and draws waist by default', async () => {
    const db = memoryDb();
    await tape(db, '2026-10-01', { waist_cm: 90, chest_cm: 100, arm_cm: 35 });
    await tape(db, '2026-10-06', { waist_cm: 89, chest_cm: 101, neck_cm: 38 });
    await open(db);
    expect(chips()).toEqual(['Waist', 'Neck', 'Chest', 'Upper arm']); // thigh and hips have no reading
    expect(chip('Waist').props.accessibilityState.selected).toBe(true);
    expect(await screen.findByLabelText('Waist from 90 to 89 cm')).toBeTruthy();
  });

  it('switching part redraws the chart and the summary, and says the change in that part', async () => {
    const db = memoryDb();
    await tape(db, '2026-10-01', { waist_cm: 90, chest_cm: 100 });
    await tape(db, '2026-10-06', { waist_cm: 89, chest_cm: 101.5 });
    await open(db);
    await fireEvent.press(chip('Chest'));
    expect(screen.getByLabelText('Chest from 100 to 101.5 cm')).toBeTruthy();
    expect(screen.getByText('Chest up 1.5 cm since 1 Oct.')).toBeTruthy();
    expect(screen.queryByLabelText('Waist from 90 to 89 cm')).toBeNull();
    expect(chip('Chest').props.accessibilityState.selected).toBe(true);
    expect(chip('Waist').props.accessibilityState.selected).toBe(false);
  });

  it('shows the body-fat line and its hint only while waist is selected', async () => {
    const db = memoryDb();
    await tape(db, '2026-10-01', { waist_cm: 90, neck_cm: 38, chest_cm: 100 });
    await tape(db, '2026-10-06', { waist_cm: 89, neck_cm: 38, chest_cm: 101 });
    await open(db);
    expect(screen.getByText(/^Estimated body fat: about/)).toBeTruthy();
    await fireEvent.press(chip('Chest'));
    expect(screen.queryByText(/^Estimated body fat/)).toBeNull();
    await fireEvent.press(chip('Waist'));
    expect(screen.getByText(/^Estimated body fat: about/)).toBeTruthy();
  });

  it('defaults to waist when it has data even if another part has more, and falls back to the first part with two readings when it has none', async () => {
    const db = memoryDb();
    await tape(db, '2026-10-01', { waist_cm: 90, chest_cm: 100 });
    await tape(db, '2026-10-03', { chest_cm: 100.5 });
    await tape(db, '2026-10-06', { chest_cm: 101 });
    await open(db);
    expect(chips()).toEqual(['Waist', 'Chest']);
    expect(chip('Waist').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('Log a few waist measurements to see your trend line here.')).toBeTruthy(); // one reading: the hint
  });

  it('with no waist reading the first part with data is drawn, and the add-waist-and-neck hint stays', async () => {
    const db = memoryDb();
    await tape(db, '2026-10-01', { chest_cm: 100 });
    await tape(db, '2026-10-06', { chest_cm: 101 });
    await open(db);
    expect(await screen.findByLabelText('Chest from 100 to 101 cm')).toBeTruthy();
    expect(screen.getByText('Add waist and neck for a body-fat estimate.')).toBeTruthy();
    expect(screen.queryByText(/^Estimated body fat/)).toBeNull();
  });

  it('keeps the missing-data hint, and hides only the estimate, when a non-waist part is chosen', async () => {
    const db = memoryDb();
    await tape(db, '2026-10-01', { waist_cm: 90, chest_cm: 100 });
    await tape(db, '2026-10-06', { waist_cm: 89, chest_cm: 101 }); // no neck: no estimate
    await open(db);
    expect(screen.getByText('Add waist and neck for a body-fat estimate.')).toBeTruthy();
    await fireEvent.press(chip('Chest'));
    expect(screen.getByText('Add waist and neck for a body-fat estimate.')).toBeTruthy();
  });

  it('a chosen part with no reading on the viewed day falls back to waist', async () => {
    const db = memoryDb();
    await tape(db, '2026-10-01', { waist_cm: 90 });
    await tape(db, '2026-10-03', { waist_cm: 91 });
    await tape(db, '2026-10-06', { waist_cm: 89, chest_cm: 101 });
    await open(db);
    await fireEvent.press(chip('Chest'));
    expect(chip('Chest').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' })); // 2026-10-05: no chest yet
    expect(screen.queryByRole('button', { name: 'Chest' })).toBeNull();
    expect(screen.getByLabelText('Waist from 90 to 91 cm')).toBeTruthy();
  });

  it('keeps the chosen range when the part changes', async () => {
    const db = memoryDb();
    for (const [d, w, c] of [['2026-07-01', 95, 100], ['2026-09-20', 92, 101], ['2026-10-06', 90, 102]] as const) await tape(db, d, { waist_cm: w, chest_cm: c });
    await open(db);
    await fireEvent.press(screen.getByRole('button', { name: 'All' }));
    await fireEvent.press(chip('Chest'));
    expect(screen.getByRole('button', { name: 'All' }).props.accessibilityState.selected).toBe(true);
  });

  it('a part with one reading shows its own one-point hint, not a chart', async () => {
    const db = memoryDb();
    await tape(db, '2026-10-06', { waist_cm: 90, chest_cm: 100 });
    await open(db);
    expect(chips()).toEqual(['Waist', 'Chest']);
    expect(screen.getByText('Log a few waist measurements to see your trend line here.')).toBeTruthy();
    await fireEvent.press(chip('Chest'));
    expect(screen.getByText('Log a few chest measurements to see your trend line here.')).toBeTruthy();
    expect(screen.queryByText('Log a few waist measurements to see your trend line here.')).toBeNull();
    expect(screen.queryByLabelText(/^Chest from/)).toBeNull();
  });

  it('hides the chip row when only one part has data', async () => {
    const db = memoryDb();
    await tape(db, '2026-10-06', { waist_cm: 90 });
    await open(db);
    expect(screen.queryByLabelText('Measurement part')).toBeNull();
  });

  it('with no readings there is no chart, heading or chips, and the how-to text stays', async () => {
    const db = memoryDb();
    await open(db);
    expect(screen.queryByLabelText('Measurement part')).toBeNull();
    expect(screen.queryByRole('header', { name: 'Waist' })).toBeNull();
    expect(screen.getByText(/^How to measure\./)).toBeTruthy();
  });
});

describe('choosePart', () => {
  const rows = [
    { date: '2026-10-01', waist_cm: 90, chest_cm: null },
    { date: '2026-10-06', waist_cm: 89, chest_cm: 101 },
  ] as never;
  const keys = ['waist_cm', 'chest_cm'] as const;
  it('keeps a choice that has a reading', () => expect(choosePart(rows, keys, '2026-10-08', 'chest_cm').shown).toBe('chest_cm'));
  it('defaults to waist when it has a reading even if another part comes first in the keys', () => {
    expect(choosePart(rows, ['chest_cm', 'waist_cm'] as const, '2026-10-08', null).shown).toBe('waist_cm');
  });
  it('falls back to waist when the choice has no reading on that day', () => {
    const r = choosePart(rows, keys, '2026-10-05', 'chest_cm');
    expect(r.shown).toBe('waist_cm');
    expect(r.series).toHaveLength(1);
  });
});

describe('Weeks on track strip', () => {
  it('draws 12 ticks, filled for on-track weeks, with the count sentence', async () => {
    const db = memoryDb();
    await weekSessions(db, [1, 2, 3, 5, 6, 8, 9, 10, 12]); // nine weeks with 2 sessions
    await weekSessions(db, [4], 1); // one session is under the goal of 2
    await open(db);
    expect(await screen.findAllByTestId(/^week-(on|off)$/, hidden)).toHaveLength(12);
    expect(screen.getAllByTestId('week-on', hidden)).toHaveLength(9);
    expect(screen.getAllByTestId('week-off', hidden)).toHaveLength(3);
    expect(screen.getByLabelText('9 of the last 12 weeks on track')).toBeTruthy();
    expect(screen.queryByText(/streak|🔥/i)).toBeNull();
    // The image label says it; the visible sentence is hidden from assistive tech so it is read once.
    expect(screen.queryByText('9 of the last 12 weeks on track')).toBeNull();
    expect(screen.getByText('9 of the last 12 weeks on track', hidden)).toBeTruthy();
  });

  it('is an image labelled with the sentence, its ticks are hidden and differ by fill, not colour alone', async () => {
    const db = memoryDb();
    await weekSessions(db, [1, 2]);
    await open(db);
    const img = await screen.findByRole('image', { name: '2 of the last 12 weeks on track' });
    expect(img).toBeTruthy();
    const on = screen.getAllByTestId('week-on', hidden)[0] as { props: Record<string, unknown> };
    const off = screen.getAllByTestId('week-off', hidden)[0] as { props: Record<string, unknown> };
    expect(on.props['aria-hidden']).toBe(true);
    expect(off.props['aria-hidden']).toBe(true);
    const a = StyleSheet.flatten(on.props.style as never), b = StyleSheet.flatten(off.props.style as never);
    expect(a.borderWidth).toBeGreaterThan(0);
    expect(b.borderWidth).toBe(a.borderWidth); // both outlined; only the fill differs
    expect(b.backgroundColor).toBe('transparent');
    expect(a.backgroundColor).toBe(a.borderColor);
  });

  it('counts only completed weeks: sessions this week do not make a tick', async () => {
    const db = memoryDb();
    await weekSessions(db, [0]); // the current week, not yet complete
    await weekSessions(db, [1]);
    await open(db);
    expect(await screen.findByLabelText('1 of the last 12 weeks on track')).toBeTruthy();
  });

  it('follows the check-in reads: a session saved to a past week after mount shows after the tab is shown again', async () => {
    const db = memoryDb();
    const view = await open(db);
    expect(await screen.findByText('Your weeks on track will show here after your first full week of workouts.')).toBeTruthy();
    await weekSessions(db, [1]);
    mockFocus.n++;
    await view.rerender(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    expect(await screen.findByLabelText('1 of the last 12 weeks on track')).toBeTruthy();
  });

  it('with no sessions shows a gentle line and no ticks or count', async () => {
    const db = memoryDb();
    await open(db);
    expect(await screen.findByText('Your weeks on track will show here after your first full week of workouts.')).toBeTruthy();
    expect(screen.queryAllByTestId(/^week-/, hidden)).toHaveLength(0);
    expect(screen.queryByText(/of the last 12 weeks/)).toBeNull();
  });
});

describe('Section framing and measurement fields (#1393)', () => {
  type Node = ReturnType<typeof screen.getByText> | null;
  const style = (n: NonNullable<Node>) => StyleSheet.flatten(n.props.style) as Record<string, unknown> | undefined;
  const above = (from: Node, pick: (st: Record<string, unknown>) => boolean): Record<string, unknown> | undefined => {
    for (let n = from; n; n = n.parent) {
      const st = style(n);
      if (st && pick(st)) return st;
    }
    return undefined;
  };
  const surface = (title: string) => above(screen.getByRole('header', { name: title, includeHiddenElements: true }).parent, (st) => !!st.backgroundColor)?.backgroundColor;
  it('Seven days and Weeks on track sit on a card like the sections around them', async () => {
    await open(memoryDb());
    const { light } = jest.requireActual('../src/theme/tokens');
    expect(surface('Measurements')).toBe(light.surface);
    expect(surface('Weeks on track')).toBe(light.surface);
    expect(surface('Seven days to 8 Oct')).toBe(light.surface);
  });

  it('the part fields wrap in rows instead of stacking one per row', async () => {
    await open(memoryDb());
    const wrap = above(screen.getByLabelText('Neck in cm').parent, (st) => st.flexWrap === 'wrap');
    expect(wrap?.flexDirection).toBe('row');
  });
});
