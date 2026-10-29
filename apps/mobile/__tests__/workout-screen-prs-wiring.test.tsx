import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { expand, press } from './disclosure-helpers';
import { memoryDb, withProfile } from './helpers';

// #1372: the screen hands the panel the hook's `prs` and `settlePrs`, so Share can wait for the badge.
const mockPanel = jest.fn();
jest.mock('../src/workout/CompletionPanel', () => ({
  CompletionPanel: (p: unknown) => {
    mockPanel(p);
    return null;
  },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

it('WorkoutScreen passes prs and settlePrs to the completion panel', async () => {
  const db = memoryDb();
  await saveSettings(db, defaultSettings('2026-10-08T00:00:00Z'));
  await saveProfile(db, { ...profile, where: 'gym' });
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  await fireEvent.press(await screen.findByLabelText('Start Push B'));
  await screen.findByText('Push B');
  const n = 'Barbell Bench Press';
  await expand(n);
  await fireEvent.changeText(screen.getByLabelText(`${n} set 1 kg`), '10');
  await fireEvent.changeText(screen.getByLabelText(`${n} set 1 reps`), '10');
  await press(`Mark ${n} set 1 done`);
  await press('Complete workout');
  await press('Confirm');
  await waitFor(() => expect(mockPanel).toHaveBeenCalled());
  const props = mockPanel.mock.calls.at(-1)?.[0] as { prs: ReadonlySet<string>; settlePrs: () => Promise<void> };
  expect(props.prs).toBeInstanceOf(Set);
  expect(typeof props.settlePrs).toBe('function');
});
