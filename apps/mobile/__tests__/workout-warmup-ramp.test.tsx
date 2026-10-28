import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { exInfo, suggestBase, warmupRamp } from '@plate-and-bar/core';
import { ExerciseCard, type Actions } from '../src/workout/ExerciseCard';
import { blankRow, type ExState } from '../src/workout/model';
import { getCatalog } from '../src/workout/catalog';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { loadLifts, loadSets, saveLift } from '../src/db/workouts';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const lift = (w: number) => ({ date: '2026-10-01', sets: [{ w, r: 8 }, { w, r: 8 }, { w, r: 8 }], n: 3, first: '2026-09-01', hist: [] });

async function mount(lifts: Record<string, number>) {
  const db = memoryDb();
  await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: true });
  await saveProfile(db, { ...profile(), where: 'gym' });
  for (const [n, w] of Object.entries(lifts)) await saveLift(db, n, lift(w) as never);
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  await fireEvent.press(await screen.findByLabelText('Start Push B'));
  await screen.findByText('Push B');
  return db;
}

const HEAVY = 'Warm up first: 8 reps at 32.5 kg, then 5 at 47.5 kg, then 3 at 65 kg. Not logged.';
const LIGHT = 'Warm up first: 8 reps at 20 kg, then 4 at 30 kg. Not logged.';
const lines = () => screen.queryAllByLabelText(/^Warm up first/).map((n) => n.props.accessibilityLabel as string);

describe('Workout screen: warm-up ramp (#1240, #1242)', () => {
  it('a heavy first compound shows three snapped steps; a later compound on new muscles shows the prototype two-step line', async () => {
    await mount({ 'Barbell Bench Press': 80, 'Machine Shoulder Press': 40 });
    expect(lines()).toEqual([HEAVY, LIGHT]); // chest first, then shoulders: new muscles, light load
  });

  it('a light first compound shows the prototype two-step text', async () => {
    await mount({ 'Barbell Bench Press': 40 });
    expect(lines()).toEqual([LIGHT]);
  });

  it('the line is one sentence for a screen reader and is gone once a set is ticked', async () => {
    const db = await mount({ 'Barbell Bench Press': 80 });
    expect(screen.getByLabelText(HEAVY)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Mark Barbell Bench Press set 1 done'));
    await waitFor(() => expect(lines()).toEqual([]));
    expect((await loadSets(db, '2026-10-08')).every((x) => x.kind === 'work')).toBe(true); // nothing is stored for the warm-up
  });

  it('ticking sets after a warm-up line leaves the next suggestion the same as the logged sets alone', async () => {
    const db = await mount({ 'Barbell Bench Press': 80 });
    expect(lines()).toEqual([HEAVY]);
    for (const n of [1, 2, 3]) await fireEvent.press(screen.getByLabelText(`Mark Barbell Bench Press set ${n} done`));
    await waitFor(async () => expect((await loadLifts(db))['Barbell Bench Press']?.date).toBe('2026-10-08'));
    const stored = (await loadLifts(db))['Barbell Bench Press']!;
    expect(stored.sets.map((x) => x.w)).toEqual([80, 80, 80]); // no 32.5 / 47.5 / 65 anywhere
    const next = (l: typeof stored) => suggestBase({ name: 'Barbell Bench Press' }, { date: '2026-10-15', lifts: { 'Barbell Bench Press': l }, catalog: getCatalog() });
    const control = { date: '2026-10-08', first: stored.first, n: stored.n, sets: stored.sets.map((x) => ({ w: 80, r: x.r })) };
    expect(next(stored)).toEqual(next(control));
  });
});

describe('ExerciseCard warm-up line for a later compound', () => {
  const act = new Proxy({}, { get: () => jest.fn() }) as unknown as Actions;
  const state = (name: string): ExState => ({ name, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [], sets: [{ ...blankRow(), w: '40', r: '8' }] });
  const view = (exs: string[], i: number) => {
    const states = exs.map(state);
    const name = exs[i]!;
    const info = exInfo(name, getCatalog());
    const warm = warmupRamp(states[i]!, i, { w: 80 }, states, info, getCatalog().tags);
    return { warm, ui: <ExerciseCard ex={states[i]!} info={info} sug={{ mode: 'hold', reps: 8, w: 80, text: '80 kg', reason: '' }} focus={[]} warm={warm} act={act} infoOf={(n) => exInfo(n, getCatalog())} expanded={false} /> };
  };

  it('shows on a collapsed row when the muscles are new', async () => {
    const v = view(['Barbell Squat', 'Barbell Bench Press'], 1);
    await render(v.ui);
    expect(v.warm).not.toBeNull();
    expect(screen.getByLabelText(HEAVY)).toBeTruthy();
  });

  it('shows nothing when an earlier compound already worked the muscle', async () => {
    const v = view(['Barbell Bench Press', 'Incline Dumbbell Press'], 1);
    await render(v.ui);
    expect(v.warm).toBeNull();
    expect(lines()).toEqual([]);
  });
});
