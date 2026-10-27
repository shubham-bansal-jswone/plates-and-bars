import { ScrollView } from 'react-native';
import { press, pressDay } from './disclosure-helpers';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SetupScreen } from '../src/screens/SetupScreen';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));


const TOP = { x: 0, y: 0, animated: false };
const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
beforeEach(() => scrollTo.mockClear());

describe('a changed step or preview starts at the top (#1060)', () => {
  it('setup scrolls to the top when the step changes, forwards and back, not on first render', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await screen.findByText('Before you start');
    expect(scrollTo).not.toHaveBeenCalled();
    await fireEvent(screen.getByLabelText('I understand and agree to my data being stored as described'), 'valueChange', true);
    await press('Continue');
    await screen.findByText('Let’s work out your targets');
    expect(scrollTo).not.toHaveBeenCalled(); // consent is not a numbered step
    await press('Male');
    await fireEvent.changeText(screen.getByLabelText('Age'), '30');
    await press('Use cm');
    await fireEvent.changeText(screen.getByLabelText('Height in cm'), '165');
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '82');
    await press('Continue');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith(TOP);
    await press('‹ Back');
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith(TOP);
  });

  it('the workout tab scrolls to the top when a preview opens and closes', async () => {
    const db = memoryDb();
    await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1)));
    await saveSettings(db, defaultSettings('2026-10-08T00:00:00Z'));
    await render(withProfile(db, <WorkoutScreen db={db} now={() => new Date(2026, 9, 8, 10, 0, 0)} />));
    await screen.findByText('Push B day');
    expect(scrollTo).not.toHaveBeenCalled();
    await pressDay('Choose Pull A');
    await screen.findByText('Pull A day');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith(TOP);
    await press('Back to workouts');
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith(TOP);
  });

  it('pressing Start on a preview opens the session at the top', async () => {
    const db = memoryDb();
    await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1)));
    await saveSettings(db, defaultSettings('2026-10-08T00:00:00Z'));
    await render(withProfile(db, <WorkoutScreen db={db} now={() => new Date(2026, 9, 8, 10, 0, 0)} />));
    await screen.findByText('Push B day');
    await pressDay('Choose Pull A');
    await screen.findByText('Pull A day');
    scrollTo.mockClear();
    await press('Start Pull A');
    await screen.findByText('Pull A');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith(TOP);
  });
});
