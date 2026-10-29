import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import * as workoutsDb from '../src/db/workouts';
import { saveSet, saveWorkout } from '../src/db/workouts';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { WeightUnitProvider } from '../src/settings/weightUnit';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { STRENGTH_ERROR } from '../src/progress/strengthCopy';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { KEY_WEIGHT_UNIT, setKv } from '../src/sync/store';
import { withProfile } from './helpers';
import { openDb } from './sync-helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = () => buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '175', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
type Db = Awaited<ReturnType<typeof openDb>>;

/** A logged day with one done work set. */
const day = async (db: Db, date: string, exercise: string, kg: number) => {
  await saveWorkout(db, { id: null, version: 0, updated_at: '', deleted_at: null, date, template: 'Upper A', base: 'Upper A', where: 'gym', cardio_min: 0, mods: {}, exercises: [], ci_choice: null });
  await saveSet(db, date, { id: `s-${date}-${exercise}`, version: 0, updated_at: '', deleted_at: null, workout_id: null, exercise, kind: 'work', set_index: 0, weight_kg: kg, reps: 5, done: true, rate: null, t: null });
};
/** Ten days from 1 Sep: one plate a side (1 Sep), bench at bodyweight (2 Sep), two plates (3 Sep), three plates and squat at 1.5 x bodyweight (5 Sep), the 10th workout (10 Sep). */
const history = async (db: Db) => {
  for (let d = 1; d <= 10; d++) {
    const date = `2026-09-${String(d).padStart(2, '0')}`;
    const [lift, kg] = d === 1 ? ['Barbell Back Squat', 60] : d === 2 ? ['Barbell Bench Press', 85] : d === 3 ? ['Barbell Back Squat', 100] : d === 5 ? ['Barbell Back Squat', 140] : ['Dumbbell Curl', 10];
    await day(db, date, lift as string, kg as number);
  }
};

async function open(seed: (db: Db) => Promise<void>, unit: 'kg' | 'lb' = 'kg') {
  const db = await openDb();
  if (unit === 'lb') await setKv(db, KEY_WEIGHT_UNIT, 'lb');
  await saveSettings(db, defaultSettings('2026-10-08T00:00:00Z'));
  await saveProfile(db, profile());
  await seed(db);
  await render(withProfile(db, <WeightUnitProvider db={db}><ProgressScreen db={db} now={NOW} /></WeightUnitProvider>));
  await screen.findByRole('header', { name: 'Progress' });
  return db;
}
const rows = () => screen.queryAllByLabelText(/, \d+ \w{3,4}$/).filter((n) => /plate|bodyweight|workout|weeks/.test(String(n.props.accessibilityLabel))).map((n) => String(n.props.accessibilityLabel));

describe('Milestones on Progress (#1351 A9)', () => {
  it('lists the last 5, newest first, each as one line with title, detail and date, and Show all reveals the rest', async () => {
    await open(history);
    expect(await screen.findByRole('header', { name: 'Milestones' })).toBeTruthy();
    expect(rows()).toEqual([
      '10th workout, 10 workouts completed, 10 Sept',
      'Three plates a side, Barbell Back Squat, 140 kg, 5 Sept',
      'Squat at 1.5 times your bodyweight, Barbell Back Squat, 140 kg, 5 Sept',
      'Two plates a side, Barbell Back Squat, 100 kg, 3 Sept',
      'Bench press at your bodyweight, Barbell Bench Press, 85 kg, 2 Sept',
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'Show all 6' }));
    expect(rows()).toHaveLength(6);
    expect(rows()[5]).toBe('One plate a side, Barbell Back Squat, 60 kg, 1 Sept');
    await fireEvent.press(screen.getByRole('button', { name: 'Show fewer' }));
    expect(rows()).toHaveLength(5);
  });

  it('each row sits on the soft surface, not the card colour it is inside, with compact padding (#1393)', async () => {
    await open(history);
    await screen.findByRole('header', { name: 'Milestones' });
    const row = screen.getByLabelText('10th workout, 10 workouts completed, 10 Sept');
    const st = StyleSheet.flatten(row.props.style);
    const { light } = jest.requireActual('../src/theme/tokens');
    expect(st.backgroundColor).toBe(light.surfaceSoft);
    expect(st.paddingVertical).toBeLessThan(16);
  });

  it('with no milestone yet it says one gentle line, with no locked entries and no Show all', async () => {
    await open(async () => undefined);
    expect(await screen.findByText('Milestones you earn will show up here.')).toBeTruthy();
    expect(rows()).toEqual([]);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('an lb user reads the weights in lb, and no 45 lb plate is implied', async () => {
    await open(history, 'lb');
    expect(await screen.findByLabelText('Three plates a side, Barbell Back Squat, 308.6 lb, 5 Sept')).toBeTruthy();
    expect(screen.queryByLabelText(/ kg, \d+ \w{3,4}$/)).toBeNull();
    expect(screen.queryByText(/45/)).toBeNull();
  });

  it('sits in the Strength section after Recent PRs, and a failed read shows the section error with no list', async () => {
    await open(history);
    const heads = (await screen.findAllByRole('header')).map((h) => h.props.children);
    expect(heads.indexOf('Milestones')).toBeGreaterThan(heads.indexOf('Recent personal bests'));
    expect(heads.indexOf('Milestones')).toBeGreaterThan(heads.indexOf('Strength'));
  });

  it('a failed read hides the list and shows the Strength error line', async () => {
    const spy = jest.spyOn(workoutsDb, 'loadDoneSets').mockRejectedValue(new Error('x'));
    await open(history);
    expect(await screen.findByText(STRENGTH_ERROR)).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Milestones' })).toBeNull();
    spy.mockRestore();
  });
});
