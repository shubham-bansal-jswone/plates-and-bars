import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { addDays, lbToKg, type LiftRecord } from '@plate-and-bar/core';
import { saveProfile } from '../src/db/records';
import { saveWeight } from '../src/db/progress';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { WeightUnitProvider } from '../src/settings/weightUnit';
import { RecentWorkouts, WorkoutDay } from '../src/progress/history/History';
import { buildSessions, setText } from '../src/progress/history/logic';
import { e1rmSummary } from '../src/progress/e1rm';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { WorkoutSet } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const KEY = 'settings:device.weight_unit';
const day = (n: number) => addDays(DATE, -n);
const weigh = (date: string, kg: number) => ({ id: null, version: 0, updated_at: `${date}T00:00:00Z`, deleted_at: null, date, weight_kg: kg });
const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const weights = (db: ReturnType<typeof memoryDb>) => [...db.rows].filter(([k]) => k.startsWith('weights:')).map(([, v]) => JSON.parse(v));

async function mount(unit: 'kg' | 'lb', seed: (db: ReturnType<typeof memoryDb>) => Promise<void>) {
  const db = memoryDb();
  if (unit === 'lb') db.rows.set(KEY, 'lb');
  await saveSettings(db, defaultSettings('2026-10-08T00:00:00Z'));
  await saveProfile(db, profile());
  await seed(db);
  await render(withProfile(db, <WeightUnitProvider db={db}><ProgressScreen db={db} now={NOW} /></WeightUnitProvider>));
  await screen.findByRole('header', { name: 'Progress' });
  return db;
}

// 80 kg this week, 80.9 the week before, 82 before that: 80 kg is 176.4 lb.
const threeWeeks = async (db: ReturnType<typeof memoryDb>) => {
  for (let i = 0; i < 21; i++) await saveWeight(db, weigh(day(i), i < 7 ? 80 : i < 14 ? 80.9 : 82));
};

beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('Progress in pounds (#1185)', () => {
  it('an lb user sees lb in the weigh-in box, the latest line, the rows, the check-in and the rapid-loss card', async () => {
    await mount('lb', threeWeeks);
    expect(screen.getByLabelText('Weight in lb').props.value).toBe('176.4');
    expect(screen.getByText('Latest: 176.4 lb')).toBeTruthy();
    expect(screen.getAllByText('176.4 lb').length).toBeGreaterThan(0);
    expect(await screen.findByText('Weight: weekly average 176.4 lb, down 2 lb from last week.')).toBeTruthy();
    expect(screen.getByText(/Your weekly average fell about 2 lb, faster than 1%/)).toBeTruthy();
    expect(screen.queryByLabelText('Weight in kg')).toBeNull();
  });

  it('a kg user is unchanged', async () => {
    await mount('kg', threeWeeks);
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('80');
    expect(screen.getByText('Latest: 80 kg')).toBeTruthy();
    expect(await screen.findByText('Weight: weekly average 80 kg, down 0.9 kg from last week.')).toBeTruthy();
  });

  it('typing 180 lb stores the exact kg and shows 180 again; a bad entry names lb', async () => {
    const db = await mount('lb', async () => undefined);
    await fireEvent.changeText(screen.getByLabelText('Weight in lb'), '12');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    expect(await screen.findByText('Enter your weight in lb, like 180.2')).toBeTruthy();
    expect(weights(db)).toEqual([]);
    await fireEvent.changeText(screen.getByLabelText('Weight in lb'), '180');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    await waitFor(() => expect(weights(db)).toHaveLength(1));
    expect(weights(db)[0].weight_kg).toBeCloseTo(lbToKg(180), 9);
    expect(screen.getByText('Latest: 180 lb')).toBeTruthy();
    expect(screen.getByLabelText('Weight in lb').props.value).toBe('180');
  });

  it('a weigh-in that is shown in lb and left alone is never re-saved', async () => {
    const db = await mount('lb', async (d) => saveWeight(d, weigh(DATE, 81.64)));
    expect(screen.getByLabelText('Weight in lb').props.value).toBe('180');
    await act(async () => { await new Promise<void>((r) => setImmediate(r)); });
    expect(weights(db)).toEqual([expect.objectContaining({ weight_kg: 81.64, version: 0 })]);
  });
});

const meta = { version: 0, updated_at: '', deleted_at: null };
const wset = (id: string, i: number, w: number, r: number, t: string): WorkoutSet => ({ ...meta, id, workout_id: null, exercise: 'Row', kind: 'work', set_index: i, weight_kg: w, reps: r, done: true, rate: null, t });
const sessions = () => buildSessions(
  { '2026-10-01': { t: 'Pull A', n: 1 }, '2026-10-08': { t: 'Pull A', n: 2 } },
  { '2026-10-01': [wset('a', 0, 60, 8, '2026-10-01T10:00:00Z')], '2026-10-08': [wset('c', 0, 70, 8, '2026-10-08T10:00:00Z'), wset('d', 1, 70, 6, '2026-10-08T10:20:00Z')] },
);
const inUnit = (unit: 'kg' | 'lb', ui: React.ReactElement) => {
  const db = memoryDb();
  if (unit === 'lb') db.rows.set(KEY, 'lb');
  return render(<WeightUnitProvider db={db}>{ui}</WeightUnitProvider>);
};

describe('History and trends in pounds (#1185)', () => {
  it('sets, volume, heaviest set and e1RM read in lb', async () => {
    const s = sessions();
    await inUnit('lb', <WorkoutDay session={s.find((x) => x.date === '2026-10-08')!} sessions={s} lifts={{} as Record<string, LiftRecord>} onBack={() => {}} />);
    expect(await screen.findByText('Set 1: 154.3 lb x 8')).toBeTruthy(); // 70 kg
    expect(screen.getByText('lb lifted')).toBeTruthy();
    expect(screen.getByText('2,161')).toBeTruthy(); // 70 x 14 = 980 kg = 2160.6 lb
  });

  it('recent workouts show the volume in lb, and kg stays kg', async () => {
    const s = sessions();
    const { unmount } = await inUnit('lb', <RecentWorkouts sessions={s} onOpen={() => {}} />);
    expect(await screen.findByLabelText(/Pull A, 2 sets, 2,161 lb$/)).toBeTruthy();
    await unmount();
    await inUnit('kg', <RecentWorkouts sessions={s} onOpen={() => {}} />);
    expect(screen.getByLabelText(/Pull A, 2 sets, 980 kg$/)).toBeTruthy();
  });

  it('the e1RM summary and set text take the unit, kg unchanged', () => {
    const pts = [{ date: '2026-09-01', e1rm: 80 }, { date: '2026-10-13', e1rm: 83 }];
    expect(e1rmSummary(pts, 'barbell', 'lb')).toBe('Estimated 1-rep max: 183 lb, up 6.6 lb over 6 weeks');
    expect(e1rmSummary(pts, 'barbell')).toBe('Estimated 1-rep max: 83 kg, up 3 kg over 6 weeks');
    expect(setText({ w: 60, r: 8 }, 'lb')).toBe('132.3 lb x 8');
    expect(setText({ w: 60, r: 8 })).toBe('60 kg x 8');
  });
});

describe('no hard-coded kg in the Progress and History screens', () => {
  const src = join(__dirname, '../src');
  const files = ['screens/ProgressScreen.tsx', ...['progress', 'progress/history'].flatMap((d) => readdirSync(join(src, d)).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => `${d}/${f}`))];
  // A kg inside a string or JSX text. `weight_kg` and the like are identifiers, not text; the unit value 'kg' defaults are fine.
  const bad = (text: string): string[] =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//') && !l.startsWith('export const BURN_HOW =')) // the kg note: its lb twin is BURN_HOW_LB
      .map((l) => l.replace(/\s\/\/.*$/, '').replace(/\$\{[^}]*\}/g, '').replace(/unit(?:: WeightUnit)? = 'kg'/g, '').replace(/(unit\s*(?:=|!==|===)\s*)'kg'/g, '$1UNIT'))
      .filter((l) => (l.match(/(['"`])(?:(?!\1).)*\1/g) ?? []).some((q) => /\bkg\b/i.test(q)) || /(\}\s*kg\b)|(>\s*kg\b)/i.test(l));
  it('catches the shapes it is meant to', () => expect(bad("const a = `${w} kg`;\n<Text>{w} kg</Text>\nconst weight_kg = 1;\nconst f = (unit: WeightUnit = 'kg') => 1;")).toHaveLength(2));
  it.each(files)('%s has no kg in a string or in JSX text', (f) => expect(bad(readFileSync(join(src, f), 'utf8'))).toEqual([]));
});
