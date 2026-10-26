import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveWorkout } from '../src/db/workouts';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { musclesOf } from '../src/workout/muscles';
import type { Workout } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

/** Thursday 2026-10-08 plans Push B: chest, front and side shoulders, triceps. */
const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const MAIN = 'chest, front shoulders, side shoulders and triceps';

async function mount(now = THURSDAY, db = memoryDb()) {
  // Rest timer off: ticking a set then starts no interval.
  await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: true });
  await saveProfile(db, { ...profile(), where: 'gym' });
  await render(withProfile(db, <WorkoutScreen db={db} now={now} />));
  return db;
}
/** Fills set 1 of the bench press and ticks it. */
async function tickFirstSet() {
  await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 kg'), '60');
  await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 reps'), '8');
  await press('Mark Barbell Bench Press set 1 done');
}
async function press(label: string) {
  await fireEvent.press(screen.getByLabelText(label));
}
/** The session's muscle map sits in the "Session info" disclosure, closed until opened. */
const openInfo = () => press('Session info');

describe('musclesOf', () => {
  it('rolls the exercises up to main muscles and also-working ones that are not already main', () => {
    expect(musclesOf(['Barbell Bench Press'])).toEqual({ primary: ['chest'], secondary: ['triceps', 'front-delt'] });
    // The press makes triceps and front delts main for the session, so they drop out of also-working.
    expect(musclesOf(['Barbell Bench Press', 'Machine Shoulder Press', 'Overhead Cable Extension'])).toEqual({ primary: ['chest', 'front-delt', 'side-delt', 'triceps'], secondary: [] });
  });

  it('skips an exercise the content does not know', () => {
    expect(musclesOf(['Not An Exercise'])).toEqual({ primary: [], secondary: [] });
  });
});

describe('Workout start preview: muscle map', () => {
  it('shows the map with a text alternative, the legend and the muscle lists', async () => {
    await mount();
    expect(await screen.findByText('Push B day')).toBeTruthy();
    expect(screen.queryByLabelText(/^Muscles worked: /)).toBeNull(); // closed until opened
    await press('Muscles today');
    expect(screen.getByLabelText(`Muscles worked: ${MAIN}`)).toBeTruthy();
    expect(screen.getByText('Main focus')).toBeTruthy();
    expect(screen.getByText('Also working')).toBeTruthy();
    expect(screen.getByText(/Main focus:/)).toBeTruthy();
  });

  it('says which muscles are also working when the session has any', async () => {
    // Pull A (Tuesday): rows and pulldowns also work the biceps.
    await mount(() => new Date(2026, 9, 6, 10, 0, 0));
    expect(await screen.findByText("Pull A day")).toBeTruthy();
    await press('Muscles today');
    const label = screen.getByLabelText(/^Muscles worked: /).props.accessibilityLabel as string;
    expect(label).toMatch(/\. Also working: /);
    expect(screen.getByText(/Also working: /, { exact: false })).toBeTruthy();
  });

  it('shows no map on a rest day', async () => {
    await mount(() => new Date(2026, 9, 11, 10, 0, 0));
    expect(await screen.findByText('Rest day')).toBeTruthy();
    expect(screen.queryByLabelText(/^Muscles worked: /)).toBeNull();
  });
});

describe('Workout session: Muscles today', () => {
  async function started() {
    const db = await mount();
    await screen.findByText('Push B day');
    await press('Start Push B');
    await screen.findByText('Push B');
    return db;
  }

  it('is a button inside Session info, with the map closed until it is opened', async () => {
    await started();
    expect(screen.queryByLabelText(`Muscles today: ${MAIN}`)).toBeNull(); // Session info is closed
    expect(screen.getByLabelText('Session info').props.accessibilityState).toMatchObject({ expanded: false });
    await openInfo();
    const toggle = screen.getByLabelText(`Muscles today: ${MAIN}`);
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByLabelText(/^Muscles worked: /)).toBeNull();
    await press(`Muscles today: ${MAIN}`);
    expect(screen.getByLabelText(`Muscles worked: ${MAIN}`)).toBeTruthy();
    expect(screen.getByText('Main focus')).toBeTruthy();
  });

  it('opens and closes on a tap, and keeps the choice once made', async () => {
    await started();
    await openInfo();
    await press(`Muscles today: ${MAIN}`);
    expect(screen.getByLabelText(`Muscles worked: ${MAIN}`)).toBeTruthy();
    await tickFirstSet();
    await screen.findByText('1 of 15 sets done, 480 kg lifted');
    expect(screen.getByLabelText(`Muscles worked: ${MAIN}`)).toBeTruthy();
    await press(`Muscles today: ${MAIN}`);
    expect(screen.queryByLabelText(/^Muscles worked: /)).toBeNull();
    expect(screen.getByLabelText(`Muscles today: ${MAIN}`).props.accessibilityState).toMatchObject({ expanded: false });
  });

  it('shows the also-working muscles on the session map when the session has any', async () => {
    // Pull A (Tuesday): the forearms are also working, not main.
    await mount(() => new Date(2026, 9, 6, 10, 0, 0));
    await screen.findByText('Pull A day');
    await press('Start Pull A');
    await screen.findByText('Pull A');
    await openInfo();
    await press(screen.getByLabelText(/^Muscles today: /).props.accessibilityLabel);
    const label = screen.getByLabelText(/^Muscles worked: /).props.accessibilityLabel as string;
    expect(label).toMatch(/\. Also working: forearms$/);
    expect(screen.getByText('Also working')).toBeTruthy();
  });

  it('has no disclosure when none of the session exercises has tagged muscles', async () => {
    const db = memoryDb();
    const untagged: Workout = { id: null, version: 1, updated_at: '2026-10-08T08:00:00Z', deleted_at: null, date: '2026-10-08', template: 'Push B', base: 'Push B', where: null, cardio_min: null, mods: {}, exercises: [{ name: 'Not An Exercise', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], ci_choice: null };
    await saveWorkout(db, untagged);
    await mount(THURSDAY, db);
    await screen.findByText('Not An Exercise');
    expect(screen.queryByLabelText(/^Muscles today: /)).toBeNull();
    expect(screen.queryByLabelText(/^Muscles worked: /)).toBeNull();
  });

  it('does not carry a tap choice to another day: each date starts closed', async () => {
    const db = memoryDb();
    // Thursday's session is stored first; then Tuesday's is started and its map opened by a tap.
    await mount(THURSDAY, db);
    await screen.findByText('Push B day');
    await press('Start Push B');
    await screen.findByText('Push B');
    await screen.unmount();
    let clock = new Date(2026, 9, 6, 10, 0, 0);
    const ui = () => withProfile(db, <WorkoutScreen db={db} now={() => clock} />);
    const view = await render(ui());
    await press((await screen.findByLabelText('Start Pull A')).props.accessibilityLabel);
    await screen.findByText('Pull A');
    await openInfo();
    await press(screen.getByLabelText(/^Muscles today: /).props.accessibilityLabel);
    expect(screen.getByLabelText(/^Muscles worked: /)).toBeTruthy();
    clock = THURSDAY();
    await view.rerender(ui());
    await screen.findByText('Push B');
    expect(screen.queryByLabelText(/^Muscles worked: /)).toBeNull();
  });
});
