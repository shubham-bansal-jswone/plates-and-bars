import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { lbToKg } from '@plate-and-bar/core';
import { SetRow } from '../src/workout/SetRow';
import { blankRow } from '../src/workout/model';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { WeightUnitSection } from '../src/settings/WeightUnitSection';
import { WeightUnitProvider, loadWeightUnit, parseWeightUnit, saveWeightUnit, useWeightUnit } from '../src/settings/weightUnit';
import { saveProfile } from '../src/db/records';
import { loadSets, saveLift } from '../src/db/workouts';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { dayQueue } from '../src/workout/dayQueue';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import { memoryDb, withProfile } from './helpers';
import { openDb } from './sync-helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const KEY = 'settings:device.weight_unit';
const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const lift = (w: number) => ({ date: '2026-10-01', sets: [{ w, r: 8 }, { w, r: 8 }, { w, r: 8 }], n: 3, first: '2026-09-01', hist: [] });

async function mountScreen(unit: 'kg' | 'lb') {
  const db = memoryDb();
  if (unit === 'lb') db.rows.set(KEY, 'lb');
  await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: true });
  await saveProfile(db, { ...profile(), where: 'gym' });
  await saveLift(db, 'Barbell Bench Press', lift(80) as never);
  await render(withProfile(db, <WeightUnitProvider db={db}><WorkoutScreen db={db} now={THURSDAY} /></WeightUnitProvider>));
  await fireEvent.press(await screen.findByLabelText('Start Push B'));
  await screen.findByText('Push B');
  return db;
}

describe('weight unit setting (#1185)', () => {
  it('defaults to kg, and a damaged value reads as kg', async () => {
    const db = await openDb();
    expect(await loadWeightUnit(db)).toBe('kg');
    expect(parseWeightUnit('stone')).toBe('kg');
    expect(parseWeightUnit(null)).toBe('kg');
  });

  it('persists on the device across a restart', async () => {
    const db = await openDb();
    await saveWeightUnit(db, 'lb');
    expect(await loadWeightUnit(db)).toBe('lb');
    const first = await render(<WeightUnitProvider db={db}><WeightUnitSection /></WeightUnitProvider>);
    await waitFor(() => expect(screen.getByLabelText('Show weights in pounds').props.accessibilityState).toMatchObject({ selected: true }));
    await fireEvent.press(screen.getByLabelText('Show weights in kilograms'));
    await waitFor(async () => expect(await loadWeightUnit(db)).toBe('kg'));
    await act(async () => first.unmount());
    await render(<WeightUnitProvider db={db}><WeightUnitSection /></WeightUnitProvider>);
    await waitFor(() => expect(screen.getByLabelText('Show weights in kilograms').props.accessibilityState).toMatchObject({ selected: true }));
  });

  it('a screen outside the provider shows kg', async () => {
    const { result } = await renderHook(() => useWeightUnit());
    expect(result.current.unit).toBe('kg');
  });
});

describe('session screen in lb', () => {
  it('shows the suggestion, the warm-up line, the column heading and the placeholders in lb', async () => {
    await mountScreen('lb');
    await waitFor(() => expect(screen.getAllByText(/^Suggested: .* lb/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Suggested: .* kg/)).toBeNull();
    expect(screen.getByLabelText(/^Warm up first: .* lb.*Not logged\.$/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Warm up first: .* kg/)).toBeNull();
    expect(screen.getByLabelText('Barbell Bench Press set 1 lb').props.placeholder).toMatch(/^\d+(\.\d)?$/); // 80 kg is 176.4 lb, on the 5 lb grid
    expect(screen.getByText(/sets done, 0 lb lifted/)).toBeTruthy();
  });

  it('typing 135 lb stores the exact kg and shows 135 again', async () => {
    const db = await mountScreen('lb');
    const input = await screen.findByLabelText('Barbell Bench Press set 1 lb');
    await fireEvent.changeText(input, '135');
    await waitFor(async () => expect((await loadSets(db, DATE)).find((s) => s.exercise === 'Barbell Bench Press' && s.set_index === 0)?.weight_kg).toBeCloseTo(lbToKg(135), 9));
    await fireEvent(input, 'blur');
    expect(screen.getByLabelText('Barbell Bench Press set 1 lb').props.value).toBe('135');
  });

  it('a kg user is unchanged: kg text, kg column and the typed number stored as is', async () => {
    const db = await mountScreen('kg');
    expect(screen.getAllByText(/^Suggested: .* kg/).length).toBeGreaterThan(0);
    const input = await screen.findByLabelText('Barbell Bench Press set 1 kg');
    await fireEvent.changeText(input, '62.5');
    await waitFor(async () => expect((await loadSets(db, DATE)).find((s) => s.exercise === 'Barbell Bench Press' && s.set_index === 0)?.weight_kg).toBe(62.5));
  });
});

describe('set row edges', () => {
  const row = { ...blankRow(), w: '100.123', r: '8' };
  it('an unedited weight is never written back: editing reps reports only reps', async () => {
    const onEdit = jest.fn();
    await render(<SetRow n="1" label="Squat set 1" row={row} wHead="lb" repsHead="reps" ph={{ w: '–', r: '–' }} onEdit={onEdit} onTick={() => undefined} unit="lb" />);
    expect(screen.getByLabelText('Squat set 1 lb').props.value).toBe('220.7'); // shown in lb
    await fireEvent.changeText(screen.getByLabelText('Squat set 1 reps'), '9');
    expect(onEdit.mock.calls).toEqual([['r', '9']]);
  });

  it('a typed weight reports kg text, and text that is not one number reports blank', async () => {
    const onEdit = jest.fn();
    await render(<SetRow n="1" label="Squat set 1" row={blankRow()} wHead="lb" repsHead="reps" ph={{ w: '–', r: '–' }} onEdit={onEdit} onTick={() => undefined} unit="lb" />);
    const input = screen.getByLabelText('Squat set 1 lb');
    await fireEvent.changeText(input, '225');
    await fireEvent.changeText(input, '12abc');
    expect(onEdit.mock.calls[0]).toEqual(['w', String(lbToKg(225))]);
    expect(onEdit.mock.calls[1]).toEqual(['w', '']);
  });

  it('ticking in lb leaves a typed weight untouched and stores a suggested one as kg', async () => {
    const db = await openDb();
    const opts = { db, profile: profile(), now: THURSDAY, focus: [], adjustments: {}, notify: jest.fn(), startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: { unit: 'lb' } } as unknown as Parameters<typeof useWorkoutDay>[0];
    const view = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(view.result.current.day.ready).toBe(true));
    await act(async () => void (await view.result.current.start('Upper A', {}, null)));
    await act(async () => void (await dayQueue.current));
    await act(async () => view.result.current.editSet(0, 'work', 0, 'w', '100.123'));
    await act(async () => view.result.current.editSet(0, 'work', 0, 'r', '8'));
    await act(async () => void view.result.current.tick(0, 0));
    await act(async () => void (await dayQueue.current));
    expect(view.result.current.day.exs[0]!.sets[0]!.w).toBe('100.123');
    const name = view.result.current.day.exs[0]!.name;
    expect((await loadSets(db, DATE)).find((s) => s.exercise === name && s.set_index === 0 && s.kind === 'work')?.weight_kg).toBe(100.123);
  });
});

describe('no hard-coded kg in the session screens', () => {
  const files = ['workout/SetRow.tsx', 'workout/ExerciseCard.tsx', 'workout/CompletionPanel.tsx', 'workout/copy.ts', 'workout/ExerciseSettingsSheet.tsx', 'screens/WorkoutScreen.tsx'];
  it.each(files)('%s has no " kg" in a string or in JSX text', (f) => {
    const src = readFileSync(join(__dirname, '../src', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .map((l) => l.replace(/\s\/\/.*$/, '').replace(/(unit\s*(?:=|!==|===)\s*)'kg'/gi, '$1UNIT')); // the unit value 'kg' is not text
    const bad = src.filter((l) => /(['"`][^'"`\n]*\bkg\b)|(\}\s*kg\b)|(>\s*kg\b)/.test(l));
    expect(bad).toEqual([]);
  });
});
