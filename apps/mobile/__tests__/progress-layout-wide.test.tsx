import { Dimensions, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { saveProfile } from '../src/db/records';
import { saveSet, saveWorkout } from '../src/db/workouts';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({ ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'), findNodeHandle: () => 7 }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const meta = { version: 0, updated_at: '', deleted_at: null };
const at = (width: number) => jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 });

type J = { type?: string; props?: { role?: string; style?: unknown }; children?: (J | string)[] | null };
const flat = (n: J) => (StyleSheet.flatten(n.props?.style as object) ?? {}) as Record<string, unknown>;
const walk = (n: J, f: (n: J) => void) => { f(n); (n.children ?? []).forEach((k) => typeof k === 'object' && walk(k, f)); };
const main = () => { let m: J | undefined; walk(screen.toJSON() as unknown as J, (n) => { if (n.props?.role === 'main') m ??= n; }); return m!; };
/** The row that holds the two section columns: a row-direction view with two children that each flex. */
const columns = () => { const found: J[] = []; walk(main(), (n) => { const k = (n.children ?? []).filter((c): c is J => typeof c === 'object'); if (flat(n).flexDirection === 'row' && flat(n).gap === 24 && k.length === 2 && k.every((c) => flat(c).flex === 1)) found.push(n); }); return found; };

async function open() {
  const db = memoryDb();
  await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1)));
  await saveWorkout(db, { ...meta, id: null, date: '2026-10-06', template: 'Pull A', base: 'Pull A', where: 'gym', cardio_min: null, mods: {}, exercises: [], ci_choice: null });
  await saveSet(db, '2026-10-06', { ...meta, id: 'a', workout_id: null, exercise: 'Row', kind: 'work', set_index: 0, weight_kg: 60, reps: 8, done: true, rate: null, t: null });
  await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Progress' });
  await screen.findByRole('header', { name: 'Body weight' });
}

afterEach(() => jest.restoreAllMocks());

describe('Progress layout (#1393)', () => {
  it('at 1280 the column is 1040 with two section columns', async () => {
    at(1280);
    await open();
    expect(flat(main()).maxWidth).toBe(1040);
    expect(columns()).toHaveLength(1);
  });

  it('at 375 the column is 560 and the sections stack (no row)', async () => {
    at(375);
    await open();
    expect(flat(main()).maxWidth).toBe(560);
    expect(columns()).toHaveLength(0);
  });

  it('with a day open at 1280 the column goes back to 560', async () => {
    at(1280);
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: /^Pull A, 6 Oct/ }));
    await screen.findByRole('header', { name: 'Pull A' });
    expect(flat(main()).maxWidth).toBe(560);
  });
});
