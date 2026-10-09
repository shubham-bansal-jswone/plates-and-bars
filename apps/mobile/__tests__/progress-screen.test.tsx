import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { SetupScreen } from '../src/screens/SetupScreen';
import SetupRoute from '../app/setup';
import { saveLog, saveDayNote } from '../src/db/food';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveConsent, saveProfile } from '../src/db/records';
import { saveMeasurement, saveWeight } from '../src/db/progress';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

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
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ date: DATE, steps: 8200, sleep: 7.5, fast: true, complete: true, version: 2 })]));
    expect(screen.getByText('steps today, target about 7,000')).toBeTruthy();
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
