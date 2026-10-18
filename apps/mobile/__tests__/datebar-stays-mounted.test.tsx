import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

// Counts how often a DateBar mounts. A remount while a day loads would drop a tap that spans it (#1032).
const mockMounts = jest.fn();
jest.mock('../src/components/DateBar', () => {
  const actual = jest.requireActual('../src/components/DateBar');
  return {
    ...actual,
    DateBar: (props: React.ComponentProps<typeof actual.DateBar>) => {
      jest.requireActual('react').useEffect(() => void mockMounts(), []);
      return actual.DateBar(props);
    },
  };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );

type Db = ReturnType<typeof memoryDb>;
/** Holds reads whose SQL contains `table`, so the screen shows Loading until the returned function opens them. */
function hold(db: Db, table: string) {
  const read = db.getAllAsync.bind(db);
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
    if (sql.includes(table)) await gate;
    return read(sql, ...p);
  }) as typeof db.getAllAsync;
  return open;
}

describe.each([
  ['Food', (db: Db) => <FoodScreen db={db} now={NOW} />, 'FROM food_logs WHERE log_date', () => screen.findByRole('header', { name: 'Food' })],
  ['Workout', (db: Db) => <WorkoutScreen db={db} now={NOW} />, 'FROM workout_sets WHERE workout_date', () => screen.findByLabelText('Start Push B')],
  ['Progress', (db: Db) => <ProgressScreen db={db} now={NOW} />, 'FROM weights', () => screen.findByRole('header', { name: 'Progress' })],
] as const)('%s: the date bar while a day loads', (_name, ui, table, shown) => {
  it('stays the same mounted bar through Loading, so a tap that spans the load is not lost', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await render(withProfile(db, ui(db)));
    await shown();
    mockMounts.mockClear(); // the first load is not the point; the bar must not mount again from here
    const open = hold(db, table);
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    await act(async () => open());
    await screen.findByText('Wednesday, 7 Oct');
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(mockMounts).not.toHaveBeenCalled();
  });
});

beforeEach(() => mockMounts.mockClear());
