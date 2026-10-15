import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { SetupScreen } from '../src/screens/SetupScreen';
import SetupRoute from '../app/setup';
import { saveLog, saveDayNote } from '../src/db/food';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveConsent, saveProfile } from '../src/db/records';
import { saveLift, saveSet, saveWorkout } from '../src/db/workouts';
import { saveMeasurement, saveWeight } from '../src/db/progress';
import { addDays, targetFromBurn } from '@plate-and-bar/core';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';
import measuresShipped from '../../../content/measures.json';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored } from '../src/content/store';
import { openDb } from './sync-helpers';

const mockPush = jest.fn();
const mockFocus = { n: 0 };
const mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => mockParams,
  // Runs when the screen mounts and each time `mockFocus.n` changes on a re-render (the tab being shown again).
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [mockFocus.n]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';

function profile(sex: 'male' | 'female' = 'male') {
  return buildProfile(
    { ...emptyDraft(), sex, age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
}

type Db = ReturnType<typeof memoryDb>;
async function setup(opts: { sex?: 'male' | 'female'; db?: Db } = {}) {
  const db = opts.db ?? memoryDb();
  await saveProfile(db, profile(opts.sex));
  await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Progress' });
  return db;
}
const docs = (db: Db, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v));
const weigh = (date: string, kg: number) => ({ id: null, version: 0, updated_at: `${date}T00:00:00Z`, deleted_at: null, date, weight_kg: kg });

describe('Progress screen', () => {
  it('saves a weigh-in to SQLite, rounded to 0.1, and shows it as the latest', async () => {
    const db = await setup();
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '81.64');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    expect(await screen.findByText('Latest: 81.6 kg')).toBeTruthy();
    await waitFor(() => expect(docs(db, 'weights')).toEqual([expect.objectContaining({ date: DATE, weight_kg: 81.6, deleted_at: null })]));
  });

  it('rejects a weight outside the contract range and writes nothing', async () => {
    const db = await setup();
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '12');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    expect(await screen.findByText('Enter your weight in kg, like 81.6')).toBeTruthy();
    expect(docs(db, 'weights')).toEqual([]);
  });

  it('clearing the box tombstones the weigh-in instead of deleting it', async () => {
    const db = memoryDb();
    await saveWeight(db, weigh(DATE, 80));
    await setup({ db });
    expect(screen.getByDisplayValue('80')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    await waitFor(() => expect(docs(db, 'weights')[0].deleted_at).not.toBeNull());
    expect(docs(db, 'weights')[0].weight_kg).toBe(80);
    expect(screen.queryByText('Latest: 80 kg')).toBeNull();
  });

  it('keeps writes in the order the user acted when the first is slow', async () => {
    const db = memoryDb();
    // The first write is the slowest, so a queue that let the second overtake it would end with 81.
    let n = 0;
    db.lag = (sql) => (sql.includes('weights') ? [80, 10][n++] ?? 0 : 0);
    await setup({ db });
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '81');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '80.5');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    await waitFor(() => expect(docs(db, 'weights')[0].weight_kg).toBe(80.5));
    // The slow first write must not land afterwards and put 81 back.
    await new Promise((r) => setTimeout(r, 150));
    expect(docs(db, 'weights')[0].weight_kg).toBe(80.5);
  });

  it('shows the navy body-fat estimate from core once waist and neck are saved', async () => {
    const db = await setup();
    expect(screen.getByText('Add waist and neck for a body-fat estimate.')).toBeTruthy();
    expect(screen.queryByLabelText('Hips in cm')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Waist (at navel) in cm'), '90');
    await fireEvent.changeText(screen.getByLabelText('Neck in cm'), '38');
    await fireEvent.press(screen.getByLabelText('Save for today'));
    expect(await screen.findByText(/Estimated body fat: about \d+%/)).toBeTruthy();
    await waitFor(() => expect(docs(db, 'measurements')).toEqual([expect.objectContaining({ date: DATE, waist_cm: 90, neck_cm: 38, chest_cm: null })]));
  });

  it('asks for at least one valid measurement', async () => {
    const db = await setup();
    await fireEvent.changeText(screen.getByLabelText('Waist (at navel) in cm'), '5');
    await fireEvent.press(screen.getByLabelText('Save for today'));
    expect(await screen.findByText('Enter at least one measurement in cm.')).toBeTruthy();
    expect(docs(db, 'measurements')).toEqual([]);
  });

  it('shows hips for women, and body fat needs hips for them', async () => {
    await setup({ sex: 'female' });
    expect(screen.getByLabelText('Hips in cm')).toBeTruthy();
    expect(screen.getByText('Add waist and neck and hips for a body-fat estimate.')).toBeTruthy();
  });

  it('saves steps and sleep on the day note and keeps its other fields', async () => {
    const db = memoryDb();
    await saveDayNote(db, { id: null, version: 2, deleted_at: null, updated_at: '2026-10-08T01:00:00Z', date: DATE, complete: true, steps: null, sleep: null, fast: true });
    await setup({ db });
    await fireEvent.changeText(screen.getByLabelText('Steps today'), '8200');
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), '7.5');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ date: DATE, steps: 8200, steps_source: 'manual', sleep: 7.5, fast: true, complete: true, version: 2 })]));
    expect(screen.getByText('steps today, target about 7,000')).toBeTruthy();
  });

  it('shows the steps source, treats a missing source as manual, and clears it with the steps', async () => {
    const db = memoryDb();
    await saveDayNote(db, { id: null, version: 1, deleted_at: null, updated_at: '2026-10-08T01:00:00Z', date: DATE, complete: null, steps: 5000, sleep: null, fast: false });
    await setup({ db });
    expect(screen.getByText('Source: entered by you')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Steps today'), '');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ steps: null, steps_source: null })]));
    expect(screen.queryByText(/^Source:/)).toBeNull();
  });

  it('a stored 0 steps shows as 0 and stays 0 when saved (#303)', async () => {
    const db = memoryDb();
    await saveDayNote(db, { id: null, version: 1, deleted_at: null, updated_at: '2026-10-08T01:00:00Z', date: DATE, complete: null, steps: 0, sleep: 7, fast: false });
    await setup({ db });
    expect(screen.getByLabelText('Steps today').props.value).toBe('0');
    expect(screen.getByText('Source: entered by you')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ steps: 0, steps_source: 'manual', sleep: 7 })]));
  });

  it('a stored 0 h sleep shows as 0 and stays 0; with nothing stored both boxes start empty', async () => {
    const db = memoryDb();
    await saveDayNote(db, { id: null, version: 1, deleted_at: null, updated_at: '2026-10-08T01:00:00Z', date: DATE, complete: null, steps: null, sleep: 0, fast: false });
    await setup({ db });
    expect(screen.getByLabelText('Steps today').props.value).toBe('');
    expect(screen.getByLabelText('Hours slept last night').props.value).toBe('0');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ steps: null, sleep: 0 })]));
  });

  it('a manual entry overrides a device source', async () => {
    const db = memoryDb();
    await saveDayNote(db, { id: null, version: 1, deleted_at: null, updated_at: '2026-10-08T01:00:00Z', date: DATE, complete: null, steps: 4000, steps_source: 'device', sleep: null, fast: false });
    await setup({ db });
    expect(screen.getByText('Source: phone step sensor')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Steps today'), '4100');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ steps: 4100, steps_source: 'manual' })]));
    expect(await screen.findByText('Source: entered by you')).toBeTruthy();
  });

  it('shows an error for non-numeric steps or sleep instead of saving 0', async () => {
    const db = await setup();
    await fireEvent.changeText(screen.getByLabelText('Steps today'), 'lots');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    expect(await screen.findByText('Enter steps as a whole number, like 8000.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Steps today'), '');
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), 'ok');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    expect(await screen.findByText('Enter hours slept, like 7.5.')).toBeTruthy();
    expect(docs(db, 'day_notes')).toEqual([]);
  });

  it('merges new measurements into the ones already saved today', async () => {
    const db = memoryDb();
    await saveMeasurement(db, { id: null, version: 1, updated_at: '2026-10-08T01:00:00Z', deleted_at: null, date: DATE, waist_cm: 90, neck_cm: null, chest_cm: 100, arm_cm: null, thigh_cm: null, hips_cm: null });
    await setup({ db });
    await fireEvent.changeText(screen.getByLabelText('Neck in cm'), '38');
    await fireEvent.press(screen.getByLabelText('Save for today'));
    await waitFor(() => expect(docs(db, 'measurements')).toEqual([expect.objectContaining({ waist_cm: 90, neck_cm: 38, chest_cm: 100, version: 1 })]));
  });

  it('saving over a deleted measurement row revives it with its version, without the old values', async () => {
    const db = memoryDb();
    await saveMeasurement(db, { id: null, version: 3, updated_at: '2026-10-08T01:00:00Z', deleted_at: '2026-10-08T02:00:00Z', date: DATE, waist_cm: 90, neck_cm: 38, chest_cm: null, arm_cm: null, thigh_cm: null, hips_cm: null });
    await setup({ db });
    await fireEvent.changeText(screen.getByLabelText('Chest in cm'), '101');
    await fireEvent.press(screen.getByLabelText('Save for today'));
    await waitFor(() => expect(docs(db, 'measurements')).toEqual([expect.objectContaining({ version: 3, deleted_at: null, waist_cm: null, neck_cm: null, chest_cm: 101, updated_at: expect.not.stringMatching(/T01:00:00Z/) })]));
  });

  it('rejects more than 24 hours of sleep', async () => {
    const db = await setup();
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), '30');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    expect(await screen.findByText('Enter hours slept, like 7.5.')).toBeTruthy();
    expect(docs(db, 'day_notes')).toEqual([]);
  });

  it('tells the user when the read fails', async () => {
    const db = memoryDb();
    db.getAllAsync = async () => {
      throw new Error('locked');
    };
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    expect(await screen.findByText('Couldn’t read your saved progress.')).toBeTruthy();
    await act(async () => {});
  });
});

describe('Day note shared by Food and Progress', () => {
  const both = async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveLog(db, { id: 'l1', version: 0, updated_at: '2026-10-08T01:00:00Z', deleted_at: null, date: DATE, meal: 'Breakfast', name: 'Roti', qty: 1, kcal: 100, protein_g: 3, carbs_g: 20, fat_g: 1, food_id: null });
    await render(withProfile(db, <><FoodScreen db={db} now={NOW} /><ProgressScreen db={db} now={NOW} /></>));
    await screen.findByLabelText('Steps today');
    await screen.findByLabelText('I’ve logged everything I ate today');
    return db;
  };
  const tick = () => fireEvent.press(screen.getByLabelText('I’ve logged everything I ate today'));
  const steps = async () => {
    await fireEvent.changeText(screen.getByLabelText('Steps today'), '8200');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
  };

  it('Food then Progress: both the tick and the steps survive', async () => {
    const db = await both();
    await tick();
    await steps();
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ complete: true, steps: 8200 })]));
  });

  it('Progress then Food: both survive', async () => {
    const db = await both();
    await steps();
    await tick();
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ complete: true, steps: 8200 })]));
  });
});

describe('Targets: recalculate after weigh-in drift (#161)', () => {
  const targets = async (db: Db) => {
    await render(withProfile(db, <TargetsScreen db={db} now={NOW} />));
    await screen.findByLabelText('Redo setup');
  };

  it('offers Recalculate when the latest weigh-in is 2 kg or more from the setup weight', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveWeight(db, weigh('2026-10-01', 79.4));
    await targets(db);
    expect(await screen.findByText('Your latest weight is 79.4 kg, 2.6 kg lower than at setup. Recalculate your targets?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Recalculate targets'));
    expect(mockPush).toHaveBeenCalledWith('/setup?recalc=1');
  });

  it('Redo setup opens setup plainly', async () => {
    mockPush.mockClear();
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveWeight(db, weigh('2026-10-01', 79.4));
    await targets(db);
    await screen.findByText(/Recalculate your targets/);
    await fireEvent.press(screen.getByLabelText('Redo setup'));
    expect(mockPush).toHaveBeenCalledWith('/setup?redo=1');
  });

  it('reads the weigh-ins again each time the tab is shown', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const ui = () => withProfile(db, <TargetsScreen db={db} now={NOW} />);
    const view = await render(ui());
    await screen.findByLabelText('Redo setup');
    expect(screen.queryByLabelText('Recalculate targets')).toBeNull();
    await saveWeight(db, weigh('2026-10-02', 79));
    mockFocus.n = 1;
    await view.rerender(ui());
    expect(await screen.findByLabelText('Recalculate targets')).toBeTruthy();
    await saveWeight(db, weigh('2026-10-03', 82));
    mockFocus.n = 2;
    await view.rerender(ui());
    await waitFor(() => expect(screen.queryByLabelText('Recalculate targets')).toBeNull());
    mockFocus.n = 0;
  });

  const consent = { id: 'c1', version: 0, updated_at: '2026-09-01T00:00:00Z', deleted_at: null, kind: 'data_storage' as const, given_at: '2026-09-01T00:00:00Z', text_version: 'x' };

  it('setup in recalculate reads the latest weigh-in itself, so the saved targets change and the drift clears', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveWeight(db, weigh('2026-10-01', 79.4));
    await saveConsent(db, consent);
    await render(withProfile(db, <SetupScreen recalc />));
    await fireEvent.press(await screen.findByLabelText('Use these targets'));
    await waitFor(() => expect(JSON.parse(db.rows.get('profiles:me')!)).toMatchObject({ weight_kg: 79.4 }));
    expect(JSON.parse(db.rows.get('profiles:me')!).targets.kcal).not.toBe(1990);
  });

  it('waits for a slow weigh-ins read before showing setup, so the form starts from the latest weight', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveConsent(db, consent);
    await saveWeight(db, weigh('2026-10-01', 79.4));
    const read = db.getAllAsync.bind(db);
    db.getAllAsync = async <T,>(sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM weights')) await new Promise((r) => setTimeout(r, 150));
      return read<T>(sql, ...p);
    };
    await render(withProfile(db, <SetupScreen recalc />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByLabelText('Use these targets')).toBeNull();
    await fireEvent.press(await screen.findByLabelText('Use these targets'));
    await waitFor(() => expect(JSON.parse(db.rows.get('profiles:me')!)).toMatchObject({ weight_kg: 79.4 }));
  });

  it('ignores a ?weight= deep link: only stored weigh-ins set the weight', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveConsent(db, consent);
    await saveWeight(db, weigh('2026-10-01', 79.4));
    Object.assign(mockParams, { recalc: '1', weight: '50' });
    await render(withProfile(db, <SetupRoute />));
    await fireEvent.press(await screen.findByLabelText('Use these targets'));
    await waitFor(() => expect(JSON.parse(db.rows.get('profiles:me')!)).toMatchObject({ weight_kg: 79.4 }));
    for (const k of Object.keys(mockParams)) delete mockParams[k];
  });

  it('does not offer it for a small change, nor for a deleted weigh-in', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveWeight(db, weigh('2026-10-01', 81));
    await saveWeight(db, { ...weigh('2026-10-02', 70), deleted_at: '2026-10-02T01:00:00Z' });
    await targets(db);
    await act(async () => {});
    expect(screen.queryByLabelText('Recalculate targets')).toBeNull();
  });
});

describe('Progress trends and scale-jump note', () => {
  it('draws the weight chart and the "Down X since" line from core', async () => {
    const db = memoryDb();
    await saveWeight(db, weigh('2026-10-01', 82));
    await saveWeight(db, weigh('2026-10-05', 80.5));
    await setup({ db });
    expect(await screen.findByLabelText('Weight from 82 to 80.5 kg')).toBeTruthy();
    expect(screen.getByText('Down 1.5 kg since 1 Oct.')).toBeTruthy();
  });

  it('asks for more weigh-ins with fewer than two', async () => {
    const db = memoryDb();
    await saveWeight(db, weigh('2026-10-01', 80));
    await setup({ db });
    expect(screen.getByText('Log a few weigh-ins to see your trend line here.')).toBeTruthy();
  });

  it('shows the waist chart and change with two waist measurements', async () => {
    const db = memoryDb();
    const tape = (date: string, waist_cm: number) => ({ id: null, version: 0, updated_at: `${date}T00:00:00Z`, deleted_at: null, date, waist_cm, neck_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, hips_cm: null });
    await saveMeasurement(db, tape('2026-10-01', 90));
    await saveMeasurement(db, tape('2026-10-06', 90.5));
    await setup({ db });
    expect(await screen.findByLabelText('Waist from 90 to 90.5 cm')).toBeTruthy();
    expect(screen.getByText('Waist up 0.5 cm since 1 Oct.')).toBeTruthy();
  });

  it('says "No change since" when the weight ended where it started', async () => {
    const db = memoryDb();
    await saveWeight(db, weigh('2026-10-01', 80));
    await saveWeight(db, weigh('2026-10-05', 81));
    await saveWeight(db, weigh('2026-10-06', 80.04));
    await setup({ db });
    expect(await screen.findByText('No change since 1 Oct.')).toBeTruthy();
  });

  it('says "No change in waist since" when the waist ended where it started', async () => {
    const db = memoryDb();
    const tape = (date: string, waist_cm: number) => ({ id: null, version: 0, updated_at: `${date}T00:00:00Z`, deleted_at: null, date, waist_cm, neck_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, hips_cm: null });
    await saveMeasurement(db, tape('2026-10-01', 90));
    await saveMeasurement(db, tape('2026-10-06', 90));
    await setup({ db });
    expect(await screen.findByText('No change in waist since 1 Oct.')).toBeTruthy();
  });

  it('shows the scale-jump note on a big rise, keeps it after a later non-jump save, and dismisses it', async () => {
    const db = memoryDb();
    await saveWeight(db, weigh('2026-10-07', 80));
    await setup({ db });
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '81');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    expect(await screen.findByText('The scale went up 1 kg')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '80.2');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    expect(screen.getByText('The scale went up 1 kg')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Got it'));
    expect(screen.queryByText('The scale went up 1 kg')).toBeNull();
  });

  it('judges the jump on the saved, rounded kg (#246): 80.86 saves as 80.9, 0.8 above 80.1', async () => {
    const db = memoryDb();
    await saveWeight(db, weigh('2026-10-07', 80.1));
    await setup({ db });
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '80.86');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    expect(await screen.findByText('The scale went up 0.8 kg')).toBeTruthy();
  });

  it('shows no note for a rise under 0.8 kg or an invalid save', async () => {
    const db = memoryDb();
    await saveWeight(db, weigh('2026-10-07', 80));
    await setup({ db });
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '80.5');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '12');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    expect(screen.queryByText(/The scale went up/)).toBeNull();
  });
});

describe('Weekly check-in, burn and habits', () => {
  const meal = (date: string, n: number, kcal: number) => ({ id: `m-${date}-${n}`, version: 0, updated_at: `${date}T00:00:00Z`, deleted_at: null, date, meal: 'Lunch' as const, name: 'Dal', qty: 1, kcal, protein_g: 40, carbs_g: 100, fat_g: 20, food_id: null });
  const day = (offset: number) => addDays(DATE, -offset);
  const seed = async (db: Db, kcal: number, weights: boolean) => {
    for (let i = 0; i < 14; i++) {
      await saveLog(db, meal(day(i), 1, kcal));
      await saveDayNote(db, { id: null, version: 0, updated_at: '', deleted_at: null, date: day(i), complete: true, steps: 8000, sleep: 6.5, fast: false });
    }
    if (weights) for (let i = 0; i < 12; i++) await saveWeight(db, weigh(day(i), Math.round((80 + i * 0.1) * 10) / 10));
  };

  it('shows the week numbers from core, the burn card waiting for data, and the habits', async () => {
    const db = memoryDb();
    await saveLog(db, meal(DATE, 1, 600));
    await saveDayNote(db, { id: null, version: 0, updated_at: '', deleted_at: null, date: DATE, complete: null, steps: 8000, sleep: 6.5, fast: false });
    await setup({ db });
    expect(await screen.findByText('Weekly check-in')).toBeTruthy();
    expect(screen.getByText('The 7 days up to 8 Oct')).toBeTruthy();
    expect(screen.getByText(/Steps: about 8,000 a day\. Sleep: 6\.5 hours a night, under the 7–9 hours/)).toBeTruthy();
    expect(screen.getByText(/Needs 10 more complete days in the last 2 weeks.* and 6 more weigh-ins/)).toBeTruthy();
    expect(screen.getByLabelText('1/7 days with food logged')).toBeTruthy();
    expect(screen.getByText(/Missed a few days\?/)).toBeTruthy();
  });

  it('shows the week-on-week weight change, the burn card\'s weekly trend and the sleep warning from core (#264)', async () => {
    const db = memoryDb();
    await seed(db, 1500, true);
    await setup({ db });
    // Weigh-ins 80.0 today up to 81.1 eleven days ago: this week averages 80.3, last week (5 of them) 80.9.
    expect(await screen.findByText('Weight: weekly average 80.3 kg, down 0.6 kg from last week.')).toBeTruthy();
    expect(screen.getByText(/your weight trend \(down 0\.7 kg a week\)/)).toBeTruthy();
    expect(screen.getByText(/Sleep: 6\.5 hours a night, under the 7–9 hours/)).toBeTruthy();
  });

  it('7 hours of sleep is not short, and two weigh-ins give no weekly change (#264)', async () => {
    const db = memoryDb();
    await saveDayNote(db, { id: null, version: 0, updated_at: '', deleted_at: null, date: DATE, complete: null, steps: null, sleep: 7, fast: false });
    for (const i of [0, 1]) await saveWeight(db, weigh(day(i), 80));
    await setup({ db });
    expect(await screen.findByText(/Sleep: 7 hours a night\.$/)).toBeTruthy();
    expect(screen.queryByText(/under the 7–9 hours/)).toBeNull();
    expect(screen.getByText(/^Weight: log at least 3 weigh-ins a week/)).toBeTruthy();
  });

  it('counts a day with a done work set as a session', async () => {
    const db = memoryDb();
    await saveWorkout(db, { id: null, version: 0, updated_at: '', deleted_at: null, date: DATE, template: 'Upper A', base: 'Upper A', where: 'gym', cardio_min: 30, mods: {}, exercises: [], ci_choice: null });
    await saveSet(db, DATE, { id: 's1', version: 0, updated_at: '', deleted_at: null, workout_id: null, exercise: 'Bench', kind: 'work', set_index: 0, weight_kg: 40, reps: 8, done: true, rate: null, t: null });
    await setup({ db });
    expect(await screen.findByLabelText(/^1 \/ \d+ sessions$/)).toBeTruthy();
    expect(screen.getByText(/Cardio: 30 of 150 min/)).toBeTruthy();
    expect(screen.getByLabelText('Thu, trained, not logged')).toBeTruthy();
  });

  it('suggests new targets from the real burn and applies them to the profile only, then hides the card', async () => {
    const db = memoryDb();
    await seed(db, 1500, true);
    await setup({ db });
    const update = await screen.findByLabelText('Update my targets');
    await fireEvent.press(update);
    await waitFor(() => expect(JSON.parse(db.rows.get('profiles:me')!).targets.kcal).not.toBe(profile().targets.kcal));
    await waitFor(() => expect(screen.queryByLabelText('Update my targets')).toBeNull());
    expect(JSON.parse(db.rows.get('user_settings:me')!).adjustments.dismissed).toEqual({ 'ci:2026-10-05': true });
  });

  it('offers a 4-day plan next week when sessions fall short', async () => {
    const db = memoryDb();
    await setup({ db });
    await fireEvent.press(await screen.findByLabelText('Use a 4-day plan next week'));
    await waitFor(() => expect(JSON.parse(db.rows.get('user_settings:me')!).adjustments.weekPlan).toEqual({ start: '2026-10-12', list: ['Upper A', 'Lower A', 'Upper B', 'Lower B'] }));
  });

  it('"Not now" hides the suggestion for the week and counts a decline', async () => {
    const db = memoryDb();
    await setup({ db });
    await fireEvent.press(await screen.findByLabelText('Not now'));
    await waitFor(() => expect(JSON.parse(db.rows.get('user_settings:me')!).adjustments).toMatchObject({ declines: { checkin: 1 }, dismissed: { 'ci:2026-10-05': true } }));
    expect(screen.queryByLabelText('Use a 4-day plan next week')).toBeNull();
  });

  const settingsDoc = (db: Db) => JSON.parse(db.rows.get('user_settings:me')!);

  it('waits for the stored settings before writing any, so a slow read cannot overwrite them with defaults', async () => {
    const db = memoryDb();
    await seed(db, 1500, true);
    await saveSettings(db, { ...defaultSettings('2026-10-01T00:00:00Z'), focus: ['Chest'], diet: 'veg', adjustments: { declines: { checkin: 2 } } });
    const read = db.getFirstAsync.bind(db);
    db.getFirstAsync = async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('user_settings')) await new Promise((r) => setTimeout(r, 300));
      return read(sql, ...p);
    };
    await setup({ db });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(settingsDoc(db)).toMatchObject({ focus: ['Chest'], diet: 'veg', checkin_seen: '2026-10-05', adjustments: { declines: { checkin: 2 } } });
  });

  it('saves the real-burn state and that this week\'s check-in was seen', async () => {
    const db = memoryDb();
    await seed(db, 1500, true);
    await setup({ db });
    await waitFor(() => expect(settingsDoc(db)).toMatchObject({ checkin_seen: '2026-10-05', adaptive: { prev: null, week: '2026-10-05', value: expect.any(Number) } }));
  });

  it('puts all four suggested targets on the profile, protein kept', async () => {
    const db = memoryDb();
    await seed(db, 1500, true);
    await setup({ db });
    await waitFor(() => expect(settingsDoc(db).adaptive.value).toEqual(expect.any(Number)));
    const before = JSON.parse(db.rows.get('profiles:me')!);
    const weights = docs(db, 'weights');
    await fireEvent.press(await screen.findByLabelText('Update my targets'));
    const want = targetFromBurn(settingsDoc(db).adaptive.value, before, weights, before.targets.protein_g)!;
    await waitFor(() => expect(JSON.parse(db.rows.get('profiles:me')!).targets).toEqual({ kcal: want.kcal, protein_g: before.targets.protein_g, carbs_g: want.carbs, fat_g: want.fat }));
  });

  it.each([
    [2, false],
    [3, true],
  ])('with %i declines, "Stop suggesting this" shown: %s', async (n, shown) => {
    const db = memoryDb();
    await saveSettings(db, { ...defaultSettings('2026-10-01T00:00:00Z'), adjustments: { declines: { checkin: n } } });
    await setup({ db });
    await screen.findByLabelText('Not now');
    expect(!!screen.queryByLabelText('Stop suggesting this')).toBe(shown);
    if (shown) {
      await fireEvent.press(screen.getByLabelText('Stop suggesting this'));
      await waitFor(() => expect(settingsDoc(db).adjustments).toMatchObject({ muted: { checkin: true }, declines: { checkin: 3 } }));
      expect(screen.queryByLabelText('Not now')).toBeNull();
    }
  });

  it('two quick "Not now" taps count two declines', async () => {
    const db = memoryDb();
    await setup({ db });
    const btn = await screen.findByLabelText('Not now');
    await act(async () => {
      fireEvent.press(btn);
      fireEvent.press(btn);
    });
    await waitFor(() => expect(settingsDoc(db).adjustments.declines.checkin).toBe(2));
  });

  it('when the stored settings cannot be read, keeps the card with the message and no actions', async () => {
    const db = memoryDb();
    await saveSettings(db, defaultSettings('2026-10-01T00:00:00Z'));
    const read = db.getFirstAsync.bind(db);
    db.getFirstAsync = async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('user_settings')) throw new Error('locked');
      return read(sql, ...p);
    };
    await setup({ db });
    expect(await screen.findByText(/Couldn’t read your saved settings, so changes are not saved/)).toBeTruthy();
    expect(screen.getByText('Weekly check-in')).toBeTruthy();
    expect(screen.queryByLabelText('Not now')).toBeNull();
    expect(screen.queryByLabelText('Update my targets')).toBeNull();
  });
});

describe('Body-fat wording follows the profile sex, not the content rules (#330)', () => {
  // A stored copy with hips 'always' and a male-only rule on chest: no part has a female rule, and one has a male rule.
  async function launchWithRules() {
    const copy = JSON.parse(JSON.stringify(measuresShipped));
    copy.measures[5].show = 'always';
    copy.measures[2].show = { sex: 'male', or_entered_that_day: false };
    const cdb = await openDb();
    await putStored(cdb, { name: 'measures', sha256: 'x', schema_version: BUNDLED['measures']!.schema_version, updated_at: '2099-01-01T00:00:00Z', body: JSON.stringify(copy) });
    await loadContent(cdb);
  }
  afterEach(async () => { await loadContent(await openDb()); });

  it('female: the hint names hips even though no part has a female rule; hips and the male-only chest follow the content', async () => {
    await launchWithRules();
    await setup({ sex: 'female' });
    expect(screen.getByText('Add waist and neck and hips for a body-fat estimate.')).toBeTruthy();
    expect(screen.getByLabelText('Hips in cm')).toBeTruthy();
    expect(screen.queryByLabelText('Chest in cm')).toBeNull();
  });

  it('male: the hint does not name hips even though a part has a male rule; hips always shows', async () => {
    await launchWithRules();
    await setup({ sex: 'male' });
    expect(screen.getByText('Add waist and neck for a body-fat estimate.')).toBeTruthy();
    expect(screen.getByLabelText('Hips in cm')).toBeTruthy();
    expect(screen.getByLabelText('Chest in cm')).toBeTruthy();
  });
});

describe('Rapid-loss card (#258)', () => {
  const day = (offset: number) => addDays(DATE, -offset);
  /** Weekly averages `w1` (this week), `w0` and `w2` (the two before): one weigh-in a day for 21 days. */
  const seedWeights = async (db: Db, w1: number, w0: number, w2: number) => {
    for (let i = 0; i < 21; i++) await saveWeight(db, weigh(day(i), i < 7 ? w1 : i < 14 ? w0 : w2));
  };
  const settingsDoc = (db: Db) => JSON.parse(db.rows.get('user_settings:me')!);
  const stallLift = () => ({ date: DATE, sets: [{ w: 50, r: 8 }], hist: [100, 100, 100, 100].map((e, i) => ({ date: day(10 - i), e })) });

  it('shows after 2 weeks over 1% a week, with the drop and its action', async () => {
    const db = memoryDb();
    await seedWeights(db, 80, 80.9, 82);
    await setup({ db });
    expect(await screen.findByText('Weight is dropping fast')).toBeTruthy();
    expect(screen.getByText(/Your weekly average fell about 0\.9 kg, faster than 1% of your bodyweight a week for 2 weeks running\./)).toBeTruthy();
    expect(screen.getByLabelText('Add 150 kcal')).toBeTruthy();
  });

  it('one fast week alone shows nothing, and exactly 1% is not fast', async () => {
    const db = memoryDb();
    await seedWeights(db, 80, 80.9, 80.9);
    await setup({ db });
    await screen.findByText('Weekly check-in');
    expect(screen.queryByText('Weight is dropping fast')).toBeNull();
    const db2 = memoryDb();
    // The week before fell 2%, so the card would show if exactly 1% counted as fast.
    await seedWeights(db2, 99, 100, 102);
    await setup({ db: db2 });
    await screen.findAllByText('Weekly check-in');
    expect(screen.queryByText('Weight is dropping fast')).toBeNull();
  });

  it('one fast week with 2 stalled lifts shows the stalled wording', async () => {
    const db = memoryDb();
    await seedWeights(db, 80, 80.9, 80.9);
    await saveLift(db, 'Bench Press', stallLift() as never);
    await saveLift(db, 'Squat', stallLift() as never);
    await setup({ db });
    expect(await screen.findByText(/fell about 0\.9 kg, and 2 lifts have stalled\./)).toBeTruthy();
  });

  it('one stalled lift is not enough', async () => {
    const db = memoryDb();
    await seedWeights(db, 80, 80.9, 80.9);
    await saveLift(db, 'Bench Press', stallLift() as never);
    await setup({ db });
    await screen.findByText('Weekly check-in');
    expect(screen.queryByText('Weight is dropping fast')).toBeNull();
  });

  it('"Add 150 kcal" raises calories and carbs (150/4 g) on the profile only, dismisses the card and toasts', async () => {
    const db = memoryDb();
    await seedWeights(db, 80, 80.9, 82);
    await setup({ db });
    const before = profile().targets;
    await fireEvent.press(await screen.findByLabelText('Add 150 kcal'));
    await waitFor(() => expect(JSON.parse(db.rows.get('profiles:me')!).targets).toEqual({ ...before, kcal: before.kcal + 150, carbs_g: before.carbs_g + 38 }));
    await waitFor(() => expect(screen.queryByText('Weight is dropping fast')).toBeNull());
    expect(settingsDoc(db).adjustments.dismissed).toMatchObject({ 'kcal:2026-10-05': true });
    expect(screen.getByText(`Calories raised to ${(before.kcal + 150).toLocaleString('en-IN')}`)).toBeTruthy();
  });

  it('"Not now" hides it for the week and counts a kcal-up decline', async () => {
    const db = memoryDb();
    await seedWeights(db, 80, 80.9, 82);
    await setup({ db });
    // The check-in's own suggestion may also say "Not now"; the rapid-loss card comes after it.
    await fireEvent.press((await screen.findAllByLabelText('Not now')).at(-1)!);
    await waitFor(() => expect(settingsDoc(db).adjustments).toMatchObject({ declines: { 'kcal-up': 1 }, dismissed: { 'kcal:2026-10-05': true } }));
    expect(settingsDoc(db).adjustments.declines.checkin).toBeUndefined();
    expect(screen.queryByText('Weight is dropping fast')).toBeNull();
  });

  it('stays hidden when muted or already dismissed, and "Stop suggesting this" mutes it', async () => {
    const db = memoryDb();
    await seedWeights(db, 80, 80.9, 82);
    const s = defaultSettings('2026-10-01T00:00:00Z');
    await saveSettings(db, { ...s, adjustments: { declines: { 'kcal-up': 3 } } });
    await setup({ db });
    await fireEvent.press(await screen.findByLabelText('Stop suggesting this'));
    await waitFor(() => expect(settingsDoc(db).adjustments.muted).toEqual({ 'kcal-up': true }));
    expect(screen.queryByText('Weight is dropping fast')).toBeNull();
    const db2 = memoryDb();
    await seedWeights(db2, 80, 80.9, 82);
    await saveSettings(db2, { ...s, adjustments: { dismissed: { 'kcal:2026-10-05': true } } });
    await setup({ db: db2 });
    await screen.findAllByText('Weekly check-in');
    expect(screen.queryByText('Weight is dropping fast')).toBeNull();
  });

  it('does not show without a profile, and not when the stored settings cannot be read', async () => {
    const db = memoryDb();
    await seedWeights(db, 80, 80.9, 82);
    await saveSettings(db, defaultSettings('2026-10-01T00:00:00Z'));
    const read = db.getFirstAsync.bind(db);
    db.getFirstAsync = async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('user_settings')) throw new Error('locked');
      return read(sql, ...p);
    };
    await setup({ db });
    expect(await screen.findByText(/Couldn’t read your saved settings/)).toBeTruthy();
    expect(screen.queryByText('Weight is dropping fast')).toBeNull();
    expect(screen.queryByLabelText('Add 150 kcal')).toBeNull();
  });
});

describe('Progress screen, seven days', () => {
  const food = (date: string, kcal: number, p: number, id: string) => ({ id, version: 0, updated_at: `${date}T00:00:00Z`, deleted_at: null, date, meal: 'Lunch', name: 'dal', qty: 2, kcal: kcal / 2, protein_g: p / 2, carbs_g: 1, fat_g: 1 });
  /** The style the day's bar was drawn with: the fill (width) and the target line (left), found by the bar's label. */
  const weekBar = (label: string) => {
    const [fill, tgt] = screen.getByLabelText(label).children;
    const flat = (el: unknown) => StyleSheet.flatten((el as { props: { style?: unknown } }).props.style as never) as Record<string, unknown>;
    return { fill: flat(fill), tgt: flat(tgt) };
  };

  it('shows a bar per day with the average and sessions, and "not logged" for empty days', async () => {
    const db = memoryDb();
    await saveLog(db, food(DATE, 2400, 90, 'a') as never);
    await saveLog(db, food(addDays(DATE, -2), 1600, 70, 'b') as never);
    await setup({ db });
    expect(await screen.findByRole('header', { name: 'Seven days to 8 Oct' })).toBeTruthy();
    expect(await screen.findByText('2,400 kcal')).toBeTruthy();
    expect(screen.getByText('1,600 kcal')).toBeTruthy();
    expect(screen.getAllByText('not logged')).toHaveLength(5);
    expect(screen.getByLabelText('2,000 avg kcal')).toBeTruthy();
    expect(screen.getByLabelText('80 g avg protein')).toBeTruthy();
    expect(screen.getByLabelText('0 sessions')).toBeTruthy();
    // This day's 2,400 kcal is 92.7715…% of core's scale (1.3 × the 1,990 kcal target) and the target line sits at
    // 76.9230…% (1,990 / 2,587); over target, so the fill is the caution colour at the prototype's 0.85 opacity.
    expect(weekBar('Thu, 2,400 kcal, 90 g protein')).toMatchObject({
      fill: { width: '92.77155005798222%', opacity: 0.85 },
      tgt: { left: '76.92307692307693%' },
    });
    // A blank day's bar announces the day and that nothing was logged, not the prototype's "0 kcal, 0 g protein".
    expect(screen.getByLabelText('Wed, not logged')).toBeTruthy();
  });

  it('shows "–" for both averages when nothing was logged all week', async () => {
    const db = memoryDb();
    await setup({ db });
    // The check-in card above carries its own averages, so read the week block from its heading down.
    const week = within(screen.getByRole('header', { name: 'Seven days to 8 Oct' }).parent as never);
    expect(await week.findByLabelText('– avg kcal')).toBeTruthy();
    expect(week.getByLabelText('– avg protein')).toBeTruthy();
    expect(week.getByLabelText('0 sessions')).toBeTruthy();
    expect(week.getAllByText('not logged')).toHaveLength(7);
    expect(week.getByLabelText('Fri, not logged')).toBeTruthy();
  });
});
