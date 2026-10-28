import { readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { lbToKg } from '@plate-and-bar/core';
import { saveConsent, saveProfile } from '../src/db/records';
import { saveWeight } from '../src/db/progress';
import { saveSettings } from '../src/db/settings';
import { defaultSettings, type Settings } from '../src/settings/types';
import { SetupScreen } from '../src/screens/SetupScreen';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { WeightUnitProvider } from '../src/settings/weightUnit';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const KEY = 'settings:device.weight_unit';
const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
type Db = ReturnType<typeof memoryDb>;
const consent = { id: 'c1', version: 0, updated_at: '2026-09-01T00:00:00Z', deleted_at: null, kind: 'data_storage' as const, given_at: '2026-09-01T00:00:00Z', text_version: 'x' };
const profile = (weight = '82') =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight, activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const stored = (db: Db) => JSON.parse(db.rows.get('profiles:me')!);

async function base(unit: 'kg' | 'lb', kg = 82) {
  const db = memoryDb();
  if (unit === 'lb') db.rows.set(KEY, 'lb');
  await saveProfile(db, { ...profile(), weight_kg: kg });
  await saveConsent(db, consent);
  await saveSettings(db, defaultSettings('2026-10-08T00:00:00Z'));
  return db;
}
const wrap = (db: Db, ui: React.ReactElement) => render(withProfile(db, <WeightUnitProvider db={db}>{ui}</WeightUnitProvider>));

describe('Setup in pounds (#1185)', () => {
  it('shows the stored weight in lb, and a redo left alone keeps the exact stored kg', async () => {
    const db = await base('lb', lbToKg(180));
    await wrap(db, <SetupScreen />);
    expect(await screen.findByLabelText('Weight in lb')).toBeTruthy();
    expect(screen.getByLabelText('Weight in lb').props.value).toBe('180');
    expect(screen.getByText('Weight (lb)', { includeHiddenElements: true })).toBeTruthy();
    for (let i = 0; i < 4; i++) await fireEvent.press(screen.getByLabelText(i === 3 ? 'See my targets' : 'Continue'));
    await fireEvent.press(await screen.findByLabelText('Use these targets'));
    await waitFor(() => expect(stored(db).weight_kg).toBe(lbToKg(180))); // not the 81.6 core would round to
  });

  it('typing 185 lb stores the exact kg, which reads back as 185', async () => {
    const db = await base('lb');
    await wrap(db, <SetupScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Weight in lb'), '185');
    for (let i = 0; i < 4; i++) await fireEvent.press(screen.getByLabelText(i === 3 ? 'See my targets' : 'Continue'));
    await fireEvent.press(await screen.findByLabelText('Use these targets'));
    await waitFor(() => expect(stored(db).weight_kg).toBeCloseTo(lbToKg(185), 9));
    expect(screen.queryByLabelText('Weight in lb')).toBeNull();
  });

  it('an out-of-range lb weight is refused in lb words', async () => {
    const db = await base('lb');
    await wrap(db, <SetupScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Weight in lb'), '20');
    await fireEvent.press(screen.getByLabelText('Continue'));
    expect(await screen.findByText('Enter your weight in lb, like 160.')).toBeTruthy();
  });

  it('switching the unit on the step converts the typed number', async () => {
    const db = await base('kg', 81.6);
    await wrap(db, <SetupScreen />);
    await screen.findByLabelText('Weight in kg');
    await fireEvent.press(screen.getByLabelText('Show weights in pounds'));
    expect(screen.getByLabelText('Weight in lb').props.value).toBe('179.9');
    await fireEvent.press(screen.getByLabelText('Show weights in kilograms'));
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('81.6');
  });

  it('a kg user is unchanged: the typed kg is stored as before', async () => {
    const db = await base('kg');
    await wrap(db, <SetupScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Weight in kg'), '79.4');
    for (let i = 0; i < 4; i++) await fireEvent.press(screen.getByLabelText(i === 3 ? 'See my targets' : 'Continue'));
    await fireEvent.press(await screen.findByLabelText('Use these targets'));
    await waitFor(() => expect(stored(db).weight_kg).toBe(79.4));
  });
});

describe('Targets in pounds (#1185)', () => {
  it('the setup line and the weight-drift note read in lb, and kg stays kg', async () => {
    for (const unit of ['lb', 'kg'] as const) {
      const db = await base(unit, 82);
      await saveWeight(db, { id: null, version: 0, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, date: '2026-10-01', weight_kg: 79.4 });
      const { unmount } = await wrap(db, <TargetsScreen db={db} now={NOW} />);
      if (unit === 'lb') {
        expect(await screen.findByText(/Male, 30, .*, 180\.8 lb\. /)).toBeTruthy();
        expect(await screen.findByText('Your latest weight is 175 lb, 5.7 lb lower than at setup. Recalculate your targets?')).toBeTruthy();
      } else {
        expect(await screen.findByText(/Male, 30, .*, 82 kg\. /)).toBeTruthy();
        expect(await screen.findByText('Your latest weight is 79.4 kg, 2.6 kg lower than at setup. Recalculate your targets?')).toBeTruthy();
      }
      await unmount();
    }
  });
});

describe('exercise jump chips in pounds (#1185)', () => {
  const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
  const BENCH = 'Barbell Bench Press';
  async function sheet(unit: 'kg' | 'lb') {
    const db = await base(unit);
    await saveProfile(db, { ...profile(), where: 'gym' });
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: true });
    await wrap(db, <WorkoutScreen db={db} now={THURSDAY} />);
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    await fireEvent.press(screen.getByLabelText(`${BENCH} settings`));
    return db;
  }
  const settings = (db: Db) => JSON.parse(db.rows.get('user_settings:me')!) as Settings;

  it('an lb user picks from 2.5, 5 and 10 lb, and the kg is stored exactly', async () => {
    const db = await sheet('lb');
    for (const x of ['2.5', '5', '10']) expect(screen.getByLabelText(`Weight jump ${x} lb`)).toBeTruthy();
    expect(screen.queryByLabelText(/Weight jump .* kg/)).toBeNull();
    expect(screen.getByLabelText('Weight jump 5 lb').props['aria-pressed']).toBe(true); // a barbell's default, as 5 lb
    await fireEvent.press(screen.getByLabelText('Weight jump 10 lb'));
    expect(screen.getByLabelText('Weight jump 10 lb').props['aria-pressed']).toBe(true);
    await fireEvent.press(screen.getByLabelText(`Save settings for ${BENCH}`));
    await waitFor(() => expect(settings(db).exercise_overrides[BENCH]?.step_kg).toBe(lbToKg(10)));
  });

  it('saving without touching the jump keeps the stored kg step', async () => {
    const db = await sheet('lb');
    await fireEvent.press(screen.getByLabelText(`Save settings for ${BENCH}`));
    await waitFor(() => expect(settings(db).exercise_overrides[BENCH]?.step_kg).toBe(2.5));
  });

  it('a kg user keeps the kg list', async () => {
    await sheet('kg');
    for (const x of ['1', '1.25', '2', '2.5', '5', '10']) expect(screen.getByLabelText(`Weight jump ${x} kg`)).toBeTruthy();
    expect(screen.queryByLabelText(/Weight jump .* lb/)).toBeNull();
  });
});

describe('no hard-coded kg in Setup and Targets', () => {
  const src = join(__dirname, '../src');
  const files = ['screens/SetupScreen.tsx', 'screens/TargetsScreen.tsx', 'setup/logic.ts', 'setup/summary.ts', 'setup/results.ts', 'components/ResultsView.tsx', 'workout/ExerciseSettingsSheet.tsx'];
  // A "g per kg of bodyweight" protein or fat ratio is a nutrition rule per kg, not a weight shown to the user in kg, so it stays.
  const bad = (text: string): string[] =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//'))
      .map((l) => l.replace(/\s\/\/.*$/, '').replace(/\$\{[^}]*\}/g, '').replace(/(unit(?:: WeightUnit)?\s*(?:=|!==|===)\s*)'kg'/g, '$1UNIT').replace(/\bg per kg\b/g, 'g per UNIT').replace(/weightError\('kg'\)/g, ''))
      .filter((l) => (l.match(/(['"`])(?:(?!\1).)*\1/g) ?? []).some((q) => /\bkg\b/i.test(q)) || /(\}\s*kg\b)|(>\s*kg\b)/i.test(l));
  it('catches the shapes it is meant to', () => expect(bad("a = `${w} kg`;\n<Text>{w} kg</Text>\nb = 'Weight (kg)';\nc = unit === 'kg';")).toHaveLength(3));
  it.each(files)('%s has no kg in a string or in JSX text', (f) => expect(bad(readFileSync(join(src, f), 'utf8'))).toEqual([]));
});
