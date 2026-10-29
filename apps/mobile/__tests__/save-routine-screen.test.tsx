import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { CompletionPanel } from '../src/workout/CompletionPanel';
import { loadRoutines } from '../src/db/routines';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { ROUTINE_COPY as T } from '../src/workout/copy';
import { expand, press, pressDay } from './disclosure-helpers';
import { withProfile } from './helpers';
import { openDb } from './sync-helpers';

// "Save as routine" from the Workout screen and the completion panel (#1184).
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

async function mount() {
  const db = await openDb();
  await saveSettings(db as never, defaultSettings('2026-10-08T00:00:00Z'));
  await saveProfile(db as never, { ...profile, where: 'gym' });
  await render(withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />));
  return db;
}

describe('Save as routine on the Workout screen', () => {
  it('is not offered before a session has exercises', async () => {
    await mount();
    await screen.findByLabelText('Start Push B');
    expect(screen.queryByLabelText(T.action)).toBeNull();
  });

  it('saves today’s generated session: template name, every exercise in order with its set count, then a toast', async () => {
    const db = await mount();
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    await press(T.action);
    expect(screen.getByLabelText(T.nameLabel).props.value).toBe('Push B');
    await press(T.save);
    expect(await screen.findByText(T.saved('Push B'))).toBeTruthy();
    const [r] = await loadRoutines(db);
    expect(await loadRoutines(db)).toHaveLength(1);
    expect(r!.exercises.map((e) => e.name)).toEqual(['Barbell Bench Press', 'Machine Shoulder Press', 'Pec Deck Fly', 'Cable Lateral Raise', 'Overhead Cable Extension']);
    expect(r!.exercises.reduce((n, e) => n + e.sets, 0)).toBe(15);
    await waitFor(() => expect(screen.queryByLabelText(T.nameLabel)).toBeNull());
  });

  it('names the button by its visible text (label in name)', async () => {
    await mount();
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    const b = screen.getByText(T.action, { exact: true });
    expect(b).toBeTruthy();
    const named = screen.getByRole('button', { name: /^Save as routine/ });
    expect(named.props.accessibilityLabel.startsWith('Save as routine')).toBe(true);
  });

  it('keeps each exercise’s own set count (an added set shows up for that exercise only)', async () => {
    const db = await mount();
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    await expand('Pec Deck Fly');
    await press('Add set to Pec Deck Fly');
    await press(T.action);
    await press(T.save);
    await waitFor(async () => expect(await loadRoutines(db)).toHaveLength(1));
    const [r] = await loadRoutines(db);
    expect(r!.exercises.map((e) => [e.name, e.sets])).toEqual([['Barbell Bench Press', 3], ['Machine Shoulder Press', 3], ['Pec Deck Fly', 4], ['Cable Lateral Raise', 3], ['Overhead Cable Extension', 3]]);
  });

  it('opens with an empty name for a hand-picked session (not the stored “Session”)', async () => {
    await mount();
    await pressDay('Pick exercises');
    await press('Add Lat Pulldown from Pull A');
    await press('Start this exercise');
    await screen.findByText('Session');
    await press(T.action);
    expect(screen.getByLabelText(T.nameLabel).props.value).toBe('');
  });

  it('after Complete workout saves the planned session and offers one button, not two', async () => {
    const db = await mount();
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    await expand('Barbell Bench Press');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 kg'), '10');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 reps'), '10');
    await press('Mark Barbell Bench Press set 1 done');
    await press('Complete workout');
    await press('Confirm');
    await screen.findByText('Session done');
    expect(screen.getAllByLabelText(T.action)).toHaveLength(1);
    await press(T.action);
    await press(T.save);
    await waitFor(async () => expect(await loadRoutines(db)).toHaveLength(1));
    const [r] = await loadRoutines(db);
    expect(r!.exercises.map((e) => [e.name, e.sets])).toEqual([['Barbell Bench Press', 3], ['Machine Shoulder Press', 3], ['Pec Deck Fly', 3], ['Cable Lateral Raise', 3], ['Overhead Cable Extension', 3]]);
  });

  it('allows saving the same session twice, without a warning', async () => {
    const db = await mount();
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    for (let i = 0; i < 2; i++) {
      await press(T.action);
      await press(T.save);
      await screen.findByText(T.saved('Push B'));
      await waitFor(() => expect(screen.queryByLabelText(T.nameLabel)).toBeNull());
    }
    expect(await loadRoutines(db)).toHaveLength(2);
  });
});

describe('Save as routine in the completion panel', () => {
  const row = { id: 'a', version: 0, updated_at: '', deleted_at: null, w: '10', r: '10', done: true, rate: null, t: null } as never;
  const exs = [{ name: 'Squat', part: 1, bridge: false, form: null, found: null, skipRamp: false, feel: null, sets: [row], ramp: [] }] as never;
  const panel = (onSaveRoutine?: () => void) =>
    render(<CompletionPanel db={{} as never} date="2026-10-08" profileKg={80} exs={exs} cardio={null} lifts={{}} reloadKey={0} {...(onSaveRoutine ? { onSaveRoutine } : {})} />);

  it('has the action, which calls back', async () => {
    const open = jest.fn();
    await panel(open);
    await press(T.action);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('has no action when there is nothing to save', async () => {
    await panel();
    expect(screen.getByText('Session done')).toBeTruthy();
    expect(screen.queryByLabelText(T.action)).toBeNull();
  });
});
