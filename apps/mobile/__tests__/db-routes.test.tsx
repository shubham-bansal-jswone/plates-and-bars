import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import Food from '../app/(tabs)/index';
import Progress from '../app/(tabs)/progress';
import Targets from '../app/(tabs)/targets';
import Workout from '../app/(tabs)/workout';

// Every tab route must hand its screen the write-locked database, never the raw expo-sqlite one.
const mockLocked = { locked: true };
jest.mock('../src/db/lockedDb', () => ({ useDb: () => mockLocked }));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({ locked: false }) }));
const shows = (name: string) => ({ __esModule: true, [name]: ({ db }: { db: { locked: boolean } }) => <Text>{name}:{String(db.locked)}</Text> });
jest.mock('../src/screens/FoodScreen', () => shows('FoodScreen'));
jest.mock('../src/screens/ProgressScreen', () => shows('ProgressScreen'));
jest.mock('../src/screens/TargetsScreen', () => shows('TargetsScreen'));
jest.mock('../src/screens/WorkoutScreen', () => shows('WorkoutScreen'));

describe('tab routes use the write-locked database', () => {
  it.each([
    ['Food', Food, 'FoodScreen'],
    ['Progress', Progress, 'ProgressScreen'],
    ['Targets', Targets, 'TargetsScreen'],
    ['Workout', Workout, 'WorkoutScreen'],
  ] as const)('%s', async (_n, Route, name) => {
    await render(<Route />);
    expect(screen.getByText(`${name}:true`)).toBeTruthy();
  });
});
