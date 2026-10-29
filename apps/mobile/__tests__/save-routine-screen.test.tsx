import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { CompletionPanel } from '../src/workout/CompletionPanel';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { getCatalog } from '../src/workout/catalog';
import { loadWorkout, saveSet, saveWorkout } from '../src/db/workouts';
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

describe('Save as routine after Complete workout keeps the planned session only while the list is unchanged', () => {
  const PUSH_B = ['Barbell Bench Press', 'Machine Shoulder Press', 'Pec Deck Fly', 'Cable Lateral Raise', 'Overhead Cable Extension'];
  async function tick(name: string, n = 1) {
    await expand(name);
    for (let i = 1; i <= n; i++) {
      await fireEvent.changeText(screen.queryByLabelText(`${name} set ${i} kg`) ?? screen.getByLabelText(`${name} set ${i} kg each`), '10');
      await fireEvent.changeText(screen.getByLabelText(`${name} set ${i} reps`), '10');
      await press(`Mark ${name} set ${i} done`);
    }
  }
  async function completeEarly() {
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    await tick('Barbell Bench Press');
    await press('Complete workout');
    await press('Confirm');
    await screen.findByText('Session done');
  }
  async function saved(db: Awaited<ReturnType<typeof openDb>>) {
    await press(T.save);
    await waitFor(async () => expect(await loadRoutines(db)).toHaveLength(1));
    return (await loadRoutines(db))[0]!.exercises.map((e) => [e.name, e.sets]);
  }

  it('saves the full planned session when nothing changed after Complete (unticked sets included)', async () => {
    const db = await mount();
    await completeEarly();
    await press(T.action);
    expect(await saved(db)).toEqual(PUSH_B.map((n) => [n, 3]));
  });

  it('an exercise added and done after Complete is saved with the current session, not the old plan', async () => {
    const db = await mount();
    await completeEarly();
    await press('Add exercise');
    await press('Add Goblet Squat');
    await screen.findByText('Goblet Squat added');
    await tick('Goblet Squat', 3);
    await screen.findByText('Session done');
    await press(T.action);
    expect(await saved(db)).toEqual([['Barbell Bench Press', 1], ['Goblet Squat', 3]]);
  });

  it('an edit undone after Complete does not bring the old plan back (the snapshot is thrown away for good)', async () => {
    const db = await mount();
    await completeEarly();
    await expand('Barbell Bench Press');
    await press('Add set to Barbell Bench Press');
    await press('Remove last set of Barbell Bench Press');
    await press(T.action);
    expect(await saved(db)).toEqual([['Barbell Bench Press', 1]]);
  });

  it('a second session added after an early finish is saved with the current session', async () => {
    const db = await mount();
    await completeEarly();
    await press('Training again later today?');
    await press('Add Pull A');
    await waitFor(() => expect(screen.queryByText('Session done')).toBeNull());
    // Tick every open set, one exercise at a time, until the session is done again.
    const ticked = new Set<string>();
    for (let guard = 0; guard < 60 && !screen.queryByText('Session done'); guard++) {
      const mark = screen.queryAllByLabelText(/^Mark .* set \d+ done$/).find((m) => !ticked.has(m.props.accessibilityLabel) && !m.props.accessibilityLabel.includes('Barbell'));
      if (!mark) {
        const open = screen.queryAllByRole('button', { name: /\d+\/\d+ sets\. Show sets/ }).find((b) => /(\d+)\/(\d+)/.test(b.props.accessibilityLabel) && RegExp.$1 !== RegExp.$2);
        await fireEvent.press(open!);
        continue;
      }
      const [, n, i] = /^Mark (.*) set (\d+) done$/.exec(mark.props.accessibilityLabel as string)!;
      await fireEvent.changeText(screen.queryByLabelText(`${n} set ${i} kg`) ?? screen.getByLabelText(`${n} set ${i} kg each`), '10');
      await fireEvent.changeText(screen.getByLabelText(`${n} set ${i} reps`), '10');
      await fireEvent.press(mark);
      ticked.add(mark.props.accessibilityLabel);
    }
    await screen.findByText('Session done');
    await press(T.action);
    const rows = await saved(db);
    expect(rows[0]).toEqual(['Barbell Bench Press', 1]);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((r) => r[0])).not.toContain('Machine Shoulder Press');
  });

  it('a sync pull that changes the day while the panel shows discards the plan', async () => {
    const db = await openDb();
    await saveSettings(db as never, defaultSettings('2026-10-08T00:00:00Z'));
    await saveProfile(db as never, { ...profile, where: 'gym' });
    const ui = (dataVersion: number) => <SyncContext.Provider value={{ dataVersion } as SyncState}>{withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />)}</SyncContext.Provider>;
    const view = await render(ui(0));
    await completeEarly();
    const wk = (await loadWorkout(db as never, '2026-10-08'))!;
    await saveWorkout(db as never, { ...wk, exercises: [...wk.exercises, { name: 'Goblet Squat', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }] });
    for (let i = 0; i < 3; i++) await saveSet(db as never, '2026-10-08', { id: `pulled-${i}`, version: 0, updated_at: '2026-10-08T06:00:00Z', deleted_at: null, workout_id: null, exercise: 'Goblet Squat', kind: 'work', set_index: i, weight_kg: 10, reps: 10, done: true, rate: null, t: null });
    await view.rerender(ui(1));
    await waitFor(() => expect(screen.getByLabelText(T.action)).toBeTruthy());
    await press(T.action);
    expect(await saved(db)).toEqual([['Barbell Bench Press', 1], ['Goblet Squat', 3]]);
  });

  it('a 51-exercise day shows the first-50 notice and saves 50', async () => {
    const db = await openDb();
    await saveSettings(db as never, defaultSettings('2026-10-08T00:00:00Z'));
    await saveProfile(db as never, { ...profile, where: 'gym' });
    const names = Object.keys(getCatalog().meta).slice(0, 51);
    expect(names).toHaveLength(51);
    await saveWorkout(db as never, { id: null, version: 0, updated_at: '2026-10-08T05:00:00Z', deleted_at: null, date: '2026-10-08', template: 'Big', base: 'Big', where: 'gym', cardio_min: null, mods: {}, ci_choice: null, exercises: names.map((name) => ({ name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false })) });
    for (const [i, name] of names.entries()) await saveSet(db as never, '2026-10-08', { id: `s-${i}`, version: 0, updated_at: '2026-10-08T05:00:00Z', deleted_at: null, workout_id: null, exercise: name, kind: 'work', set_index: 0, weight_kg: null, reps: null, done: false, rate: null, t: null });
    await render(withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />));
    await press(T.action);
    expect(screen.getByText(T.capped(50))).toBeTruthy();
    await press(T.save);
    await waitFor(async () => expect(await loadRoutines(db)).toHaveLength(1));
    expect((await loadRoutines(db))[0]!.exercises).toHaveLength(50);
  });
});

describe('Save as routine in the completion panel', () => {
  const row = { id: 'a', version: 0, updated_at: '', deleted_at: null, w: '10', r: '10', done: true, rate: null, t: null } as never;
  const exs = [{ name: 'Squat', part: 1, bridge: false, form: null, found: null, skipRamp: false, feel: null, sets: [row], ramp: [] }] as never;
  const panel = (onSaveRoutine?: () => void) =>
    render(<CompletionPanel db={{} as never} date="2026-10-08" profileKg={80} exs={exs} cardio={null} reloadKey={0} {...(onSaveRoutine ? { onSaveRoutine } : {})} />);

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
