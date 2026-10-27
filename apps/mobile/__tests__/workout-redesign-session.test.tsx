import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

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

  it('session: Session info starts closed and holds the Why link', async () => {
    await mount();
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    expect(screen.queryByLabelText('Why these exercises? How your sessions are built')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Session info'));
    expect(screen.getByLabelText('Why these exercises? How your sessions are built')).toBeTruthy();
  });
});
