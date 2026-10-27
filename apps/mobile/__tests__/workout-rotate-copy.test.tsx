import { render, screen } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);

async function start(minutes: 30 | 45) {
  const db = memoryDb();
  await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1)));
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
}

describe('left-out exercises note on the Start view (#1144)', () => {
  it('says "rotates" for one left-out exercise, evaluated, not literal template text', async () => {
    await start(45);
    expect(await screen.findByText(/Overhead Cable Extension rotates in on your other Push B days\./)).toBeTruthy();
    expect(screen.queryByText(/\$\{|built\.left/)).toBeNull();
  });

  it('says "rotate" for two', async () => {
    await start(30);
    expect(await screen.findByText(/Cable Lateral Raise and Overhead Cable Extension rotate in on your other Push B days\./)).toBeTruthy();
  });
});
