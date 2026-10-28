import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { CompletionPanel } from '../src/workout/CompletionPanel';
import { blankRow, type ExState, type Row } from '../src/workout/model';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const row = (w: string, r: string, done: boolean, rate: Row['rate'] = null): Row => ({ ...blankRow(), w, r, done, rate });
const ex = (name: string, sets: Row[], part: 1 | 2 = 1): ExState => ({ name, part, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], sets });
const panel = (exs: ExState[], o: { cardio?: number | null; pbOn?: string } = {}) =>
  render(<CompletionPanel db={memoryDb()} date="2026-10-08" profileKg={80} exs={exs} cardio={o.cardio ?? null} lifts={o.pbOn ? { 'Barbell Bench Press': { pbToast: o.pbOn } as never } : {}} reloadKey={0} />);

describe('CompletionPanel', () => {
  it('shows only values derived from the sets: done/all, volume, exercises, best set, ratings', async () => {
    await panel([ex('Barbell Bench Press', [row('60', '8', true, 'right'), row('62.5', '6', true, 'hard')]), ex('Pec Deck Fly', [row('30', '12', true)])]);
    expect(screen.getByText('Session done')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByText('Session done').props.style).textAlign).toBe('center'); // centred like the stats row
    expect(screen.getByLabelText('Sets: 3/3')).toBeTruthy();
    expect(screen.getByLabelText('Volume (kg): 1,215')).toBeTruthy(); // 60x8 + 62.5x6 + 30x12 = 480 + 375 + 360
    expect(screen.getByLabelText('Exercises: 2')).toBeTruthy();
    expect(screen.getByText('62.5 x 6')).toBeTruthy(); // the heaviest set
    expect(screen.getByText('Felt: Just right, Hard')).toBeTruthy();
    expect(screen.queryByText(/streak|crushed|duration/i)).toBeNull();
    expect(screen.queryByText('Personal record')).toBeNull();
  });

  it('is nothing while any set is undone, and nothing for an empty session', async () => {
    await panel([ex('Barbell Bench Press', [row('60', '8', true), row('60', '8', false)])]);
    expect(screen.queryByText('Session done')).toBeNull();
    await screen.unmount();
    await panel([]);
    expect(screen.queryByText('Session done')).toBeNull();
  });

  it('marks a personal record only when the lift record says today set one', async () => {
    await panel([ex('Barbell Bench Press', [row('60', '8', true)])], { pbOn: '2026-10-08' });
    expect(screen.getByText('Personal record')).toBeTruthy();
    await screen.unmount();
    await panel([ex('Barbell Bench Press', [row('60', '8', true)])], { pbOn: '2026-10-01' });
    expect(screen.queryByText('Personal record')).toBeNull();
  });

  it('a bodyweight session shows total reps in place of volume; cardio minutes and a second session are labelled', async () => {
    await panel([ex('Push-up', [row('', '10', true), row('', '8', true)]), ex('Pec Deck Fly', [row('', '12', true)], 2)], { cardio: 20 });
    expect(screen.queryByLabelText(/^Volume/)).toBeNull();
    expect(screen.getByLabelText('Reps: 30')).toBeTruthy();
    expect(screen.getByLabelText('Cardio (min): 20')).toBeTruthy();
    expect(screen.getByText('Today, both sessions together.')).toBeTruthy();
    expect(screen.getByText('10 reps')).toBeTruthy();
  });
});

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

describe('Workout screen: start view and session', () => {
  async function mount() {
    const db = memoryDb();
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: true });
    await saveProfile(db, { ...profile(), where: 'gym' });
    await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
    return db;
  }

  it('start view: a 56 high lime Start, the metric row from real data, and the day choices behind a disclosure', async () => {
    await mount();
    await screen.findByText('Push B day');
    const start = screen.getByLabelText('Start Push B');
    expect(StyleSheet.flatten(start.props.style).minHeight).toBe(56);
    expect(screen.getByLabelText('Exercises: 5')).toBeTruthy();
    expect(screen.getByLabelText('Sets: 15')).toBeTruthy();
    expect(screen.getByLabelText('Min per session: 60')).toBeTruthy();
    expect(screen.queryByLabelText('Choose Pull A')).toBeNull();
    const day = screen.getByLabelText('Choose another day');
    expect(day.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(day);
    expect(screen.getByLabelText('Choose Pull A')).toBeTruthy();
  });

  it('session: one exercise is expanded at a time, the first with sets left; tapping another row swaps them', async () => {
    await mount();
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    expect(screen.getByLabelText('Barbell Bench Press set 1 kg')).toBeTruthy();
    expect(screen.queryByLabelText('Machine Shoulder Press set 1 kg')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /^Machine Shoulder Press, 0\/3 sets/ }));
    expect(screen.getByLabelText('Machine Shoulder Press set 1 kg')).toBeTruthy();
    expect(screen.queryByLabelText('Barbell Bench Press set 1 kg')).toBeNull();
    expect(screen.getByRole('button', { name: /^Barbell Bench Press, 0\/3 sets/ })).toBeTruthy();
    // No completion panel while sets are undone.
    expect(screen.queryByText('Session done')).toBeNull();
  });

  it('session: the Why link is inline in the header', async () => {
    await mount();
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    expect(screen.getByLabelText('Why these exercises? How your sessions are built')).toBeTruthy();
  });
});
