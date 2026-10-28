import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { WorkoutDay } from '../src/progress/history/History';
import { useHistory } from '../src/progress/history/useHistory';
import { saveSet, saveWorkout } from '../src/db/workouts';
import { memoryDb } from './helpers';
import { buildSessions } from '../src/progress/history/logic';
import type { WorkoutSet } from '../src/workout/types';

let mockUnit: 'kg' | 'lb' = 'kg';
const mockShare = jest.fn(async (..._a: unknown[]) => 'shared' as const);
jest.mock('../src/settings/weightUnit', () => ({ useWeightUnit: () => ({ unit: mockUnit, ready: true, setUnit: () => undefined }) }));
jest.mock('../src/workout/shareImage', () => ({ shareWorkoutImage: (...a: unknown[]) => mockShare(...a) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const meta = { version: 0, updated_at: '', deleted_at: null };
const wset = (id: string, exercise: string, i: number, w: number | null, r: number | null, done = true): WorkoutSet => ({ ...meta, id, workout_id: null, exercise, kind: 'work', set_index: i, weight_kg: w, reps: r, done, rate: null, t: null });
const DATE = '2026-10-08';
const sessions = (sets: WorkoutSet[], cardio: number | null = null) => buildSessions({ [DATE]: { t: 'Push' } } as never, { [DATE]: sets }, { [DATE]: cardio });
const finished = () => sessions([wset('a', 'Barbell Bench Press', 0, 100, 5), wset('b', 'Barbell Bench Press', 1, 100, 5)], 20);
const day = (s = finished(), lifts = {}) => render(<WorkoutDay session={s[0]!} sessions={s} lifts={lifts} onBack={() => {}} />);
const LABEL = 'Share summary picture of 8 Oct';

afterEach(() => {
  mockUnit = 'kg';
  jest.clearAllMocks();
});

describe('History day: share a summary picture', () => {
  it('shows the share action for a finished day', async () => {
    await day();
    expect(screen.getByLabelText(LABEL)).toBeTruthy();
  });

  it('hides it for a day with no ticked work set', async () => {
    const s = sessions([wset('a', 'Row', 0, 60, 8, false)]);
    expect(s).toEqual([]); // nothing is logged, so there is no day to open
    const empty = { date: DATE, name: 'Push', setsDone: 0, finished: false, volume: 0, exercises: [], elapsed: null, cardio: null };
    await render(<WorkoutDay session={empty} sessions={[empty]} lifts={{}} onBack={() => {}} />);
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });

  it('hides it for a part-done day: an unticked work set means no Share', async () => {
    const s = sessions([wset('a', 'Row', 0, 60, 8), wset('b', 'Row', 1, 60, 8, false)]);
    expect(s[0]).toMatchObject({ setsDone: 1, finished: false });
    await day(s);
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });

  it('still shows it when only deleted or warm-up sets are unticked', async () => {
    const s = sessions([wset('a', 'Row', 0, 60, 8), { ...wset('b', 'Row', 1, 60, 8, false), deleted_at: '2026-10-08T10:00:00Z' }, { ...wset('c', 'Row', 2, 20, 8, false), kind: 'ramp' }]);
    expect(s[0]).toMatchObject({ setsDone: 1, finished: true });
    await day(s);
    expect(screen.getByLabelText(LABEL)).toBeTruthy();
  });

  it('carries the stored cardio minutes through the real load path to the card', async () => {
    const db = memoryDb();
    await saveWorkout(db, { ...meta, id: null, date: DATE, template: 'Push', base: 'Push', where: 'gym', cardio_min: 25, mods: {}, exercises: [], ci_choice: null });
    await saveSet(db, DATE, wset('a', 'Barbell Bench Press', 0, 100, 5));
    const { result } = await renderHook(() => useHistory(db, 0));
    await waitFor(() => expect(result.current?.sessions).toHaveLength(1));
    await day(result.current!.sessions);
    fireEvent.press(screen.getByLabelText(LABEL));
    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    const card = mockShare.mock.calls[0]![0] as { stats: { label: string; value: string }[] };
    expect(card.stats).toContainEqual({ label: 'Cardio (min)', value: '25' });
  });

  it('builds the card from the stored day: sets, cardio, PR from the lift record, kg', async () => {
    await day(finished(), { 'Barbell Bench Press': { pbToast: DATE } as never });
    fireEvent.press(screen.getByLabelText(LABEL));
    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    const card = mockShare.mock.calls[0]![0] as { stats: { label: string; value: string }[]; rows: { name: string; best: string; pr: boolean }[] };
    expect(card.stats).toEqual([{ label: 'Sets', value: '2/2' }, { label: 'Volume (kg)', value: '1,000' }, { label: 'Exercises', value: '1' }, { label: 'Cardio (min)', value: '20' }]);
    expect(card.rows).toEqual([{ name: 'Barbell Bench Press', best: '100 x 5', pr: true }]);
  });

  it('shows lb for a lb user', async () => {
    mockUnit = 'lb';
    await day();
    fireEvent.press(screen.getByLabelText(LABEL));
    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    const card = mockShare.mock.calls[0]![0] as { stats: { label: string }[]; rows: { best: string }[] };
    expect(card.stats[1]!.label).toBe('Volume (lb)');
    expect(card.rows[0]!.best).toBe("220.5 x 5");
  });

  it('says so when the picture cannot be shared', async () => {
    mockShare.mockResolvedValueOnce('unavailable' as never);
    await day();
    fireEvent.press(screen.getByLabelText(LABEL));
    await waitFor(() => expect(screen.getByText('Sharing is not available on this device.')).toBeTruthy());
  });

  it('ignores a second tap while one share runs', async () => {
    let done: (v: 'shared') => void = () => undefined;
    mockShare.mockImplementationOnce(() => new Promise((ok) => void (done = ok)));
    await day();
    await fireEvent.press(screen.getByLabelText(LABEL));
    await fireEvent.press(screen.getByLabelText(LABEL));
    expect(mockShare).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText(LABEL).props.accessibilityState).toMatchObject({ busy: true }));
    done('shared');
    await waitFor(() => expect(screen.getByLabelText(LABEL).props.accessibilityState?.busy).toBeFalsy());
  });
});
