import { render, screen, fireEvent } from '@testing-library/react-native';
import type { LiftRecord } from '@plate-and-bar/core';
import { saveSet, saveWorkout } from '../src/db/workouts';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';
import { getLibrary } from '../src/library/exercises';
import { durationText, e1rmSummary, elapsedLine } from '../src/progress/e1rm';
import { E1rmTrend } from '../src/progress/E1rmTrend';
import { WorkoutDay } from '../src/progress/history/History';
import { buildSessions, exerciseE1rm } from '../src/progress/history/logic';
import { CompletionPanel } from '../src/workout/CompletionPanel';
import type { ExState, Row } from '../src/workout/model';
import type { WorkoutSet } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const meta = { version: 0, updated_at: '', deleted_at: null };
const wset = (id: string, exercise: string, i: number, w: number | null, r: number | null, o: Partial<WorkoutSet> = {}): WorkoutSet => ({ ...meta, id, workout_id: null, exercise, kind: 'work', set_index: i, weight_kg: w, reps: r, done: true, rate: null, t: null, ...o });
const pts = [{ date: '2026-09-01', e1rm: 80 }, { date: '2026-10-13', e1rm: 83 }];

describe('e1RM summary and trend', () => {
  it('words the summary for a screen reader', () => {
    expect(e1rmSummary(pts, 'barbell')).toBe('Estimated 1-rep max: 83 kg, up 3 kg over 6 weeks');
    expect(e1rmSummary([{ date: '2026-10-01', e1rm: 90 }, { date: '2026-10-04', e1rm: 87.5 }], 'barbell')).toBe('Estimated 1-rep max: 87.5 kg, down 2.5 kg over 3 days');
    expect(e1rmSummary([pts[0]!], 'barbell')).toBeNull();
  });

  it('draws with 2 points and is hidden with fewer', async () => {
    const { rerender } = await render(<E1rmTrend points={pts} type="barbell" />);
    expect(screen.getByTestId('e1rm-trend')).toBeTruthy();
    expect(screen.getByLabelText('Estimated 1-rep max: 83 kg, up 3 kg over 6 weeks')).toBeTruthy();
    expect(screen.getByText(/weight x \(1 \+ reps \/ 30\)/)).toBeTruthy();
    await rerender(<E1rmTrend points={[pts[0]!]} type="barbell" />);
    expect(screen.queryByTestId('e1rm-trend')).toBeNull();
  });
});

describe('elapsed text', () => {
  const e = (o: object) => ({ seconds: 4200, from: '', to: '', complete: true, split: false, ...o });
  it('shows only when complete, and labels a split', () => {
    expect(durationText(4200)).toBe('1 h 10 min');
    expect(durationText(2700)).toBe('45 min');
    expect(elapsedLine(e({}))).toBe('1 h 10 min');
    expect(elapsedLine(e({ complete: false }))).toBeNull();
    expect(elapsedLine(null)).toBeNull();
    expect(elapsedLine(e({ split: true }))).toBe('about 1 h 10 min of training (long break excluded)');
  });
});

describe('history day view', () => {
  const day = (date: string, sets: WorkoutSet[]) => ({ log: { [date]: { t: 'Pull A', n: sets.length } }, sets: { [date]: sets } });
  const sessions = () => {
    const a = day('2026-10-01', [wset('a', 'Row', 0, 60, 8, { t: '2026-10-01T10:00:00Z' }), wset('r', 'Row', 1, 100, 5, { kind: 'ramp', t: '2026-10-01T10:05:00Z' }), wset('f', 'Row', 2, 90, 5, { rate: 'fail', t: '2026-10-01T10:30:00Z' })]);
    const b = day('2026-10-08', [wset('c', 'Row', 0, 70, 8, { t: '2026-10-08T10:00:00Z' }), wset('d', 'Row', 1, 70, 6, { t: '2026-10-08T11:10:00Z' })]);
    return buildSessions({ ...a.log, ...b.log }, { ...a.sets, ...b.sets });
  };

  it('keeps ramp and failed sets out of the trend (core), oldest first', () => {
    expect(exerciseE1rm(sessions(), 'Row')).toEqual([{ date: '2026-10-01', e1rm: 76 }, { date: '2026-10-08', e1rm: 88.7 }]);
  });

  it('renders the trend and shows the time only when every done set has a tick', async () => {
    const s = sessions();
    const open = s.find((x) => x.date === '2026-10-08')!;
    await render(<WorkoutDay session={open} sessions={s} lifts={{} as Record<string, LiftRecord>} onBack={() => {}} />);
    expect(screen.getByTestId('e1rm-trend')).toBeTruthy();
    expect(screen.getByTestId('session-elapsed').props.children).toBe('Time: 1 h 10 min');
    expect(screen.getAllByText(/weight x \(1 \+ reps \/ 30\)/)).toHaveLength(1); // the note once per day
    expect(screen.getByText('Last 20 sessions')).toBeTruthy();
  });

  it('hides the time when a done set has no tick', async () => {
    const d = day('2026-10-08', [wset('c', 'Row', 0, 70, 8, { t: '2026-10-08T10:00:00Z' }), wset('d', 'Row', 1, 70, 6)]);
    const s = buildSessions(d.log, d.sets);
    await render(<WorkoutDay session={s[0]!} sessions={s} lifts={{}} onBack={() => {}} />);
    expect(screen.queryByTestId('session-elapsed')).toBeNull();
    expect(screen.queryByTestId('e1rm-trend')).toBeNull(); // one session: no trend
  });
});

describe('completion panel time', () => {
  const row = (t: string | null): Row => ({ id: String(Math.random()), version: 0, w: '60', r: '8', done: true, rate: null, t });
  const ex = (sets: Row[]): ExState => ({ name: 'Row', part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, sets, ramp: [] });
  const panel = (exs: ExState[]) => render(withProfile(memoryDb(), <CompletionPanel db={memoryDb()} date="2026-10-08" profileKg={80} exs={exs} cardio={null} lifts={{}} reloadKey={0} />));

  it('shows the elapsed time when every set has a tick', async () => {
    await panel([ex([row('2026-10-08T10:00:00Z'), row('2026-10-08T10:45:00Z')])]);
    expect(screen.getByTestId('completion-elapsed').props.children).toBe('Time: 45 min');
  });

  it('labels a split session', async () => {
    await panel([ex([row('2026-10-08T08:00:00Z'), row('2026-10-08T09:00:00Z'), row('2026-10-08T15:00:00Z'), row('2026-10-08T15:10:00Z')])]);
    expect(screen.getByTestId('completion-elapsed').props.children).toBe('Time: about 1 h 10 min of training (long break excluded)');
  });

  it('hides it when a done set has no tick', async () => {
    await panel([ex([row('2026-10-08T10:00:00Z'), row(null)])]);
    expect(screen.getByTestId('completion-panel')).toBeTruthy();
    expect(screen.queryByTestId('completion-elapsed')).toBeNull();
  });
});

describe('library detail', () => {
  const lib = getLibrary().find((x) => x.type === 'barbell')!;
  const open = async (db: ReturnType<typeof memoryDb>) => {
    await render(<ExerciseLibraryScreen onBack={() => {}} session={{ db, date: '2026-10-08', now: () => new Date(2026, 9, 8) }} />);
    await fireEvent.press(screen.getByText(lib.name));
  };

  it('shows the trend from the device sets once 2 sessions count', async () => {
    const db = memoryDb();
    for (const [d, w] of [['2026-09-01', 80], ['2026-10-13', 90]] as const) {
      await saveWorkout(db, { ...meta, id: null, date: d, template: 'x', base: 'x', where: 'gym', cardio_min: null, mods: {}, exercises: [], ci_choice: null });
      await saveSet(db, d, wset(`s${d}`, lib.name, 0, w, 5));
    }
    await open(db);
    expect(await screen.findByTestId('e1rm-trend')).toBeTruthy();
  });

  it('ignores an orphan set with no date and a set on a day with no live workout', async () => {
    const db = memoryDb();
    const wk = (d: string, deleted: string | null) => saveWorkout(db, { ...meta, deleted_at: deleted, id: null, date: d, template: 'x', base: 'x', where: 'gym', cardio_min: null, mods: {}, exercises: [], ci_choice: null });
    await wk('2026-10-01', null);
    await wk('2026-10-02', '2026-10-03T00:00:00Z');
    await saveSet(db, '', wset('o', lib.name, 0, 120, 5)); // pulled before its workout
    await saveSet(db, '2026-10-02', wset('d', lib.name, 0, 100, 5)); // deleted workout
    await saveSet(db, '2026-10-05', wset('n', lib.name, 0, 100, 5)); // no workout row
    await saveSet(db, '2026-10-01', wset('a', lib.name, 0, 80, 5));
    await open(db);
    await screen.findByText('Back to library');
    expect(screen.queryByTestId('e1rm-trend')).toBeNull(); // only one real session
    expect(screen.queryByLabelText(/NaN/)).toBeNull();
  });

  it('shows nothing with one session', async () => {
    const db = memoryDb();
    await saveWorkout(db, { ...meta, id: null, date: '2026-10-01', template: 'x', base: 'x', where: 'gym', cardio_min: null, mods: {}, exercises: [], ci_choice: null });
    await saveSet(db, '2026-10-01', wset('x', lib.name, 0, 80, 5));
    await open(db);
    await screen.findByText('Back to library');
    expect(screen.queryByTestId('e1rm-trend')).toBeNull();
  });
});
