import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { saveProfile } from '../src/db/records';
import { ProfileProvider, useProfile } from '../src/state/ProfileProvider';
import { SettingsProvider } from '../src/state/SettingsProvider';
import { ViewedDateProvider } from '../src/state/ViewedDate';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('../src/photos/vault', () => ({
  POSES: ['front', 'side', 'back'],
  persistent: true,
  putPhoto: async () => undefined,
  getPhoto: async () => null,
  deletePhoto: async () => undefined,
  onPhotosWiped: () => () => undefined,
  photoDates: async () => [],
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const YESTERDAY = '2026-10-07';

const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );

/** Wraps the app the way Stores and the tabs layout do: a wipe bumps the epoch, which remounts the providers and the viewed day under them. */
function App({ db, wipeRef }: { db: ReturnType<typeof memoryDb>; wipeRef: { current: () => void } }) {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    wipeRef.current = () => setEpoch((n) => n + 1);
  }, [wipeRef]);
  return (
    <ProfileProvider key={epoch} db={db}>
      <SettingsProvider db={db}>
        <ViewedDateProvider>
          <Skip />
          <ProgressScreen db={db} now={NOW} />
        </ViewedDateProvider>
      </SettingsProvider>
    </ProfileProvider>
  );
}
const Skip = () => {
  const { skipSetup } = useProfile();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Skip setup" onPress={skipSetup}>
      <Text>skip</Text>
    </Pressable>
  );
};

describe('Progress after Delete everything with setup skipped (#1371)', () => {
  it('a weigh-in saved on a past day is stored under that day, not today', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const wipeRef = { current: () => undefined as void };
    await render(<App db={db} wipeRef={wipeRef} />);
    await screen.findByRole('header', { name: 'Progress' });
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' })); // a day picked before the wipe

    db.rows.clear(); // Delete everything: the store is empty, the epoch remounts the providers
    await act(async () => wipeRef.current());
    await fireEvent.press(await screen.findByLabelText('Skip setup'));
    await screen.findByRole('header', { name: 'Progress' });
    expect(screen.getByText('Today')).toBeTruthy(); // the wipe reset the viewed day too

    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    await screen.findByText('Yesterday');
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '81.4');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    await waitFor(() => {
      const w = [...db.rows].filter(([k]) => k.startsWith('weights:')).map(([, v]) => JSON.parse(v));
      expect(w).toEqual([expect.objectContaining({ date: YESTERDAY, weight_kg: 81.4 })]);
    });
  });
});
