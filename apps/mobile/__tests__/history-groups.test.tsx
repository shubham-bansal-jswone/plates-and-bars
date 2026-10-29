import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutDay } from '../src/progress/history/History';
import { buildSessions } from '../src/progress/history/logic';
import { shareWorkoutImage } from '../src/workout/shareImage';
import { buildShareCard, rowName } from '../src/workout/shareModel';
import { blankRow, type ExState } from '../src/workout/model';
import type { WorkoutSet } from '../src/workout/types';

jest.mock('../src/settings/weightUnit', () => ({ useWeightUnit: () => ({ unit: 'kg', ready: true, setUnit: () => undefined }) }));
jest.mock('../src/workout/shareImage', () => ({ shareWorkoutImage: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: () => undefined }));

const meta = { version: 0, updated_at: '', deleted_at: null };
const wset = (exercise: string, i: number): WorkoutSet => ({ ...meta, id: `${exercise}${i}`, workout_id: null, exercise, kind: 'work', set_index: i, weight_kg: 50, reps: 8, done: true, rate: null, t: null });
const DATE = '2026-10-08';
const NAMES = ['Barbell Row', 'Pull-up', 'Squat', 'Curl'];
const sets = NAMES.map((n, i) => wset(n, i));
const build = (groups?: (string | null | undefined)[]) =>
  buildSessions({ [DATE]: { t: 'Pull' } } as never, { [DATE]: sets }, {}, groups ? { [DATE]: NAMES.map((name, i) => ({ name, group: groups[i] })) } : {});
const labels = (g?: (string | null | undefined)[]) => build(g)[0]!.exercises.map((e) => e.label);
const show = (s = build()) => render(<WorkoutDay session={s[0]!} sessions={s} prs={new Set()} onBack={() => {}} />);

describe('history session labels', () => {
  it('labels members of a valid group only', () => expect(labels(['g', 'g', null, undefined])).toEqual(['A', 'B', undefined, undefined]));
  it('a singleton, an invalid id and a split group show none', () => {
    expect(labels(['g', null, null, null])).toEqual([undefined, undefined, undefined, undefined]);
    expect(labels(['bad id', 'bad id', null, null])).toEqual([undefined, undefined, undefined, undefined]);
    expect(labels(['g', null, 'g', 'g'])).toEqual([undefined, undefined, undefined, undefined]);
  });
  it('a group with one listed member (the other has no done sets) shows no label', () => {
    const only = [wset('Pull-up', 0), wset('Squat', 1)];
    const s = buildSessions({ [DATE]: { t: 'Pull' } } as never, { [DATE]: only }, {}, { [DATE]: [{ name: 'Barbell Row', group: 'g' }, { name: 'Pull-up', group: 'g' }, { name: 'Squat', group: null }] });
    expect(s[0]!.exercises.map((e) => e.label)).toEqual([undefined, undefined]);
  });
  it('a 3-member group with the first undone relabels the rest A and B', () => {
    const rest = [wset('Pull-up', 0), wset('Squat', 1), wset('Curl', 2)];
    const s = buildSessions({ [DATE]: { t: 'Pull' } } as never, { [DATE]: rest }, {}, { [DATE]: ['Barbell Row', 'Pull-up', 'Squat', 'Curl'].map((name, i) => ({ name, group: i < 3 ? 'g' : null })) });
    expect(s[0]!.exercises.map((e) => e.label)).toEqual(['A', 'B', undefined]);
  });
  describe('letters follow the stored order, not the row order', () => {
    // Every exercise's first set has set_index 0, so the day lists exercises in whatever order the rows come back.
    const row = (name: string) => wset(name, 0);
    const day = (rows: string[], stored: { name: string; group: string | null }[]) =>
      buildSessions({ [DATE]: { t: 'Pull' } } as never, { [DATE]: rows.map(row) }, {}, { [DATE]: stored })[0]!.exercises.map((e) => [e.name, e.label]);
    const stored = [{ name: 'Barbell Row', group: 'g' }, { name: 'Pull-up', group: 'g' }, { name: 'Squat', group: null }];
    it('gives the same cards and letters for any row order, including a re-saved set last', () => {
      const want = [['Barbell Row', 'A'], ['Pull-up', 'B'], ['Squat', undefined]];
      for (const rows of [['Barbell Row', 'Pull-up', 'Squat'], ['Pull-up', 'Barbell Row', 'Squat'], ['Barbell Row', 'Squat', 'Pull-up']]) expect(day(rows, stored)).toEqual(want);
    });
    it('a stored split group stays invalid when the exercise between is not done', () => {
      const split = [{ name: 'Barbell Row', group: 'g' }, { name: 'Squat', group: null }, { name: 'Pull-up', group: 'g' }];
      expect(day(['Barbell Row', 'Pull-up'], split).map((x) => x[1])).toEqual([undefined, undefined]);
    });
    it('a stored group of 7 reads as the workout screen does: the first 6 are a superset, the 7th is not', () => {
      const seven = Array.from({ length: 7 }, (_, i) => ({ name: `Ex${i}`, group: 'g' }));
      const names = seven.map((e) => e.name);
      expect(day(names.slice(1), seven).map((x) => x[1])).toEqual(['A', 'B', 'C', 'D', 'E', undefined]);
      expect(day(names, seven).map((x) => x[1])).toEqual(['A', 'B', 'C', 'D', 'E', 'F', undefined]);
    });
  });
  describe('cards follow the stored exercise order (#1339)', () => {
    const stored = [{ name: 'Barbell Row', group: null }, { name: 'Pull-up', group: null }, { name: 'Squat', group: null }];
    const names = (rows: string[], st = stored) => buildSessions({ [DATE]: { t: 'Pull' } } as never, { [DATE]: rows.map((n) => wset(n, 0)) }, {}, { [DATE]: st })[0]!.exercises.map((e) => e.name);
    it('shuffled rows, every first set at set_index 0', () => expect(names(['Squat', 'Barbell Row', 'Pull-up'])).toEqual(['Barbell Row', 'Pull-up', 'Squat']));
    it('a re-saved set (row last) does not move its exercise', () => expect(names(['Pull-up', 'Squat', 'Barbell Row'])).toEqual(['Barbell Row', 'Pull-up', 'Squat']));
    it('a repeated stored name sits at its first stored position (#1329 plan)', () => {
      const plan = ['Machine Chest Press', 'Lat Pulldown', 'Seated Dumbbell Press', 'Seated Cable Row', 'Machine Chest Press'].map((name) => ({ name, group: null }));
      expect(names(['Seated Cable Row', 'Machine Chest Press', 'Lat Pulldown'], plan)).toEqual(['Machine Chest Press', 'Lat Pulldown', 'Seated Cable Row']);
    });
    it('names missing from the stored list keep row order, after the stored ones', () =>
      expect(names(['Zottman', 'Squat', 'Face pull', 'Barbell Row'], stored)).toEqual(['Barbell Row', 'Squat', 'Zottman', 'Face pull']));
  });
  it('ungrouped sessions carry no label key at all', () => {
    for (const s of [build(), build([null, null, null, null])]) for (const e of s[0]!.exercises) expect(Object.keys(e)).toEqual(['name', 'sets', 'volume']);
  });
  it('keeps order, per-exercise volume and totals', () => {
    const a = build()[0]!;
    const b = build(['g', 'g', 'h', 'h'])[0]!;
    expect(b.exercises.map((e) => [e.name, e.volume])).toEqual(a.exercises.map((e) => [e.name, e.volume]));
    expect([b.volume, b.setsDone, b.finished]).toEqual([a.volume, a.setsDone, a.finished]);
  });
});

describe('history day view', () => {
  it('shows a Superset tag and a screen reader label for members', async () => {
    await show(build(['g', 'g', null, null]));
    expect(screen.getByText('Superset A', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('Superset A')).toBeNull();
    expect(screen.getByText('Superset A', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
    expect(screen.getByText('Superset B', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText('Superset A: Barbell Row')).toBeTruthy();
    expect(screen.getByLabelText('Superset B: Pull-up')).toBeTruthy();
    expect(screen.queryByLabelText(/Superset .: Squat/)).toBeNull();
  });
  it('renders an ungrouped day exactly as before (same tree with no stored groups, null groups, or a singleton)', async () => {
    const tree = async (g?: (string | null)[]) => {
      const r = await show(build(g));
      const out = JSON.stringify(r.toJSON());
      await r.unmount();
      return out;
    };
    const base = await tree();
    expect(base).not.toMatch(/Superset/);
    expect(await tree([null, null, null, null])).toBe(base);
    expect(await tree(['g', null, null, null])).toBe(base);
  });
});

describe('history Share', () => {
  it('the picture follows the stored order, not the row order (#1339)', async () => {
    (shareWorkoutImage as jest.Mock).mockClear().mockResolvedValue('shared');
    const rows = ['Squat', 'Curl', 'Barbell Row', 'Pull-up'].map((n) => wset(n, 0));
    await show(buildSessions({ [DATE]: { t: 'Pull' } } as never, { [DATE]: rows }, {}, { [DATE]: NAMES.map((name) => ({ name, group: null })) }));
    fireEvent.press(screen.getByLabelText(/Share summary picture/));
    await waitFor(() => expect(shareWorkoutImage).toHaveBeenCalled());
    const card = (shareWorkoutImage as jest.Mock).mock.calls[0]![0] as { rows: { name: string }[] };
    expect(card.rows.map((r) => r.name)).toEqual(NAMES);
  });
  it('passes the day letters to the picture', async () => {
    (shareWorkoutImage as jest.Mock).mockClear().mockResolvedValue('shared');
    await show(build(['g', 'g', null, null]));
    fireEvent.press(screen.getByLabelText(/Share summary picture/));
    await waitFor(() => expect(shareWorkoutImage).toHaveBeenCalled());
    const card = (shareWorkoutImage as jest.Mock).mock.calls[0]![0] as { rows: { label?: string }[] };
    expect(card.rows.map((r) => r.label)).toEqual(['A', 'B', undefined, undefined]);
  });
});

describe('share model', () => {
  const ex = (name: string, group?: string | null): ExState => ({ name, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], group, sets: [{ ...blankRow(), w: '50', r: '8', done: true }] });
  const card = (exs: ExState[], labels?: (string | null)[]) => buildShareCard({ date: DATE, exs, cardio: null, labels });
  it('adds the marker only for grouped exercises, numbers unchanged', () => {
    const plain = card([ex('Row'), ex('Pull-up')]);
    const grouped = card([ex('Row', 'g'), ex('Pull-up', 'g'), ex('Squat')]);
    expect(grouped.rows.map((r) => r.label)).toEqual(['A', 'B', undefined]);
    expect(rowName(grouped.rows[0]!)).toBe('A. Row');
    expect(rowName(grouped.rows[2]!)).toBe('Squat');
    expect(plain.rows.every((r) => !('label' in r))).toBe(true);
    expect(grouped.stats[1]).toEqual(card([ex('Row'), ex('Pull-up'), ex('Squat')]).stats[1]);
    expect(card([ex('Row', 'g'), ex('Pull-up')]).rows.some((r) => 'label' in r)).toBe(false);
  });
  it('explicit labels win', () => expect(card([ex('Row'), ex('Pull-up')], ['A', 'B']).rows.map((r) => r.label)).toEqual(['A', 'B']));
});
