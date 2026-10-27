import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { expand, press, pressDay } from './disclosure-helpers';
import { kcalTarget, planFlex, undoFlex } from '@plate-and-bar/core';
import { FoodScreen } from '../src/screens/FoodScreen';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveHold } from '../src/db/labs';
import { loadSettings, saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { buildResults } from '../src/setup/results';
import { buildSession } from '../src/workout/buildSession';
import { profileWhyValues } from '../src/why/values';
import { labs } from '../src/labs/content';
import { fmt } from '../src/format';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
// Spy on the two flex functions (still the real ones) to see what the Food screen hands them.
jest.mock('@plate-and-bar/core', () => {
  const actual = jest.requireActual('@plate-and-bar/core');
  return { ...actual, planFlex: jest.fn(actual.planFlex), undoFlex: jest.fn(actual.undoFlex) };
});

const NOW = () => new Date(2026, 9, 8, 10, 0, 0); // Thursday 8 Oct 2026: Push B for a 6-day plan
const DATE = '2026-10-08';
const realFlag = process.env.EXPO_PUBLIC_LAB_REPORTS;
beforeEach(() => {
  process.env.EXPO_PUBLIC_LAB_REPORTS = '1';
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  if (realFlag === undefined) delete process.env.EXPO_PUBLIC_LAB_REPORTS;
  else process.env.EXPO_PUBLIC_LAB_REPORTS = realFlag;
});

const profile = () => buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const maintenance = (p: ReturnType<typeof profile>) => Math.round(buildResults(p).r.tdee / 10) * 10;
const HELD = { on: true, since: '2026-10-07' };

async function food(opts: { hold?: boolean; flex?: number } = {}) {
  const db = memoryDb();
  await saveProfile(db, profile());
  if (opts.hold) await saveHold(db, HELD);
  if (opts.flex) await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), flex: [{ id: 'flex-1', date: DATE, kcal_delta: opts.flex }] });
  await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Food' });
  return db;
}

describe('the lab hold on the Food tab', () => {
  it('the profile target is below maintenance, so the test means something', () => {
    expect(profile().targets.kcal).toBeLessThan(maintenance(profile()));
  });

  it('holds the target at maintenance or more, and ignores flex, while the hold is on', async () => {
    const p = profile();
    const held = kcalTarget(DATE, { flex: [], labHold: true }, p);
    expect(held).toBeGreaterThanOrEqual(maintenance(p));
    await food({ hold: true, flex: 300 });
    expect(await screen.findByLabelText(`0 of ${fmt(held)} kcal eaten`)).toBeTruthy(); // not held + 300, not 2,290
  });

  it('plans and undoes a flex with the hold passed to core', async () => {
    const db = await food({ hold: true });
    await waitFor(() => expect(screen.getByLabelText(`0 of ${fmt(maintenance(profile()))} kcal eaten`)).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: /What should I eat next\? Breakfast ideas/ }));
    await fireEvent.press(screen.getByLabelText('Plan a bigger day'));
    await fireEvent.press(screen.getByLabelText('+300 kcal today'));
    expect(planFlex).toHaveBeenLastCalledWith(expect.objectContaining({ labHold: true }), expect.anything());
    await waitFor(async () => expect(((await loadSettings(db))?.flex ?? []).length).toBeGreaterThan(0));
    await fireEvent.press(await screen.findByLabelText('Undo bigger day'));
    expect(undoFlex).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ labHold: true }));
  });

  it('the hold lifts again after "I\'ve seen my doctor" (the stored hold is off)', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveHold(db, { on: false });
    await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
    expect(await screen.findByLabelText(`0 of ${fmt(profile().targets.kcal)} kcal eaten`)).toBeTruthy();
  });

  it('flag off: a stored hold changes nothing', async () => {
    delete process.env.EXPO_PUBLIC_LAB_REPORTS;
    await food({ hold: true, flex: 300 });
    expect(await screen.findByLabelText(`0 of ${fmt(profile().targets.kcal + 300)} kcal eaten`)).toBeTruthy();
  });
});

describe('the lab hold in the why values', () => {
  it('the fibre target follows the held target for that day, and the flag off path never holds', () => {
    const p = profile();
    const held = kcalTarget(DATE, { labHold: true }, p);
    expect(profileWhyValues(p, { date: DATE, labHold: true }).fibre_g).toBe(profileWhyValues({ ...p, targets: { ...p.targets, kcal: held } }).fibre_g);
    expect(profileWhyValues(p, { date: DATE, labHold: true }).fibre_g).not.toBe(profileWhyValues(p, { date: DATE }).fibre_g);
    expect(profileWhyValues(p, { date: DATE, labHold: false }).fibre_g).toBe(profileWhyValues(p, { date: DATE }).fibre_g);
  });
});

describe('the lab hold in the workout', () => {
  const base = () => ({ template: 'Push B', date: DATE, profile: profile(), where: 'gym' as const, sessions: {}, lifts: {}, ciChoice: null, checkin: {}, focus: [], exclusions: [], swaps: [], adjustments: {} });

  it('builds a lighter session: one set fewer on exercises with more than 2 sets, mods.light on', () => {
    const normal = buildSession(base());
    const held = buildSession({ ...base(), labHold: true });
    expect(normal.mods.light).toBe(false);
    expect(held.mods.light).toBe(true);
    expect(normal.exercises.some((e) => e.sets > 2)).toBe(true);
    held.exercises.forEach((e, i) => expect(e.sets).toBe(normal.exercises[i]!.sets > 2 ? normal.exercises[i]!.sets - 1 : normal.exercises[i]!.sets));
  });

  async function workout(opts: { hold?: boolean } = {}) {
    const db = memoryDb();
    await saveProfile(db, profile());
    if (opts.hold) await saveHold(db, HELD);
    await render(withProfile(db, <WorkoutScreen db={db} now={NOW} />));
    await screen.findByText('Push B day');
    return db;
  }

  it('shows the hold note and a lighter preview, and Start stores a light session', async () => {
    const db = await workout({ hold: true });
    expect(screen.getByText(labs.workout_note)).toBeTruthy();
    expect(screen.getByText(/5 exercises, 2 sets each/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Start Push B'));
    await waitFor(() => expect(db.rows.has(`workouts:${DATE}`)).toBe(true));
    expect(JSON.parse(db.rows.get(`workouts:${DATE}`)!).mods.light).toBe(true);
    expect(await screen.findByText(/Today: lighter session: 1 fewer set, no weight increases\./)).toBeTruthy();
  });

  it('with no hold there is no note and the session is normal', async () => {
    await workout();
    expect(screen.queryByText(labs.workout_note)).toBeNull();
    expect(screen.getByText(/5 exercises, 3 sets each/)).toBeTruthy();
  });

  it('flag off: a stored hold changes nothing', async () => {
    delete process.env.EXPO_PUBLIC_LAB_REPORTS;
    await workout({ hold: true });
    expect(screen.queryByText(labs.workout_note)).toBeNull();
    expect(screen.getByText(/5 exercises, 3 sets each/)).toBeTruthy();
  });
});

describe('before the stored hold has been read', () => {
  /** A db whose read of the hold waits until `release()`. */
  function gated(db: ReturnType<typeof memoryDb>) {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const orig = db.getFirstAsync.bind(db);
    db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('lab_store')) await gate;
      return orig(sql, ...p);
    }) as typeof db.getFirstAsync;
    return release;
  }

  it('Workout offers no Start until the hold is known, so a normal session is never stored under a hold', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveHold(db, HELD);
    const release = gated(db);
    await render(withProfile(db, <WorkoutScreen db={db} now={NOW} />));
    await act(async () => { await new Promise<void>((r) => setImmediate(r)); });
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByLabelText('Start Push B')).toBeNull();
    expect(db.rows.has(`workouts:${DATE}`)).toBe(false);
    await act(async () => release());
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await waitFor(() => expect(db.rows.has(`workouts:${DATE}`)).toBe(true));
    expect(JSON.parse(db.rows.get(`workouts:${DATE}`)!).mods.light).toBe(true);
  });

  it('Food shows no target until the hold is known, then the held one', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveHold(db, HELD);
    const release = gated(db);
    await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
    await act(async () => { await new Promise<void>((r) => setImmediate(r)); });
    expect(screen.queryByLabelText(/kcal eaten/)).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
    await act(async () => release());
    expect(await screen.findByLabelText(`0 of ${fmt(maintenance(profile()))} kcal eaten`)).toBeTruthy();
  });

  it('a failed first read counts as the hold ON (it is protective)', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const orig = db.getFirstAsync.bind(db);
    db.getFirstAsync = ((sql: string, ...p: (string | number)[]) => (sql.includes('lab_store') ? Promise.reject(new Error('disk')) : orig(sql, ...p))) as typeof db.getFirstAsync;
    await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
    expect(await screen.findByLabelText(`0 of ${fmt(maintenance(profile()))} kcal eaten`)).toBeTruthy();
  });
});

describe('the hold reaches a second session and a seeded pick session', () => {
  
  const sets = (db: ReturnType<typeof memoryDb>) => {
    const n: Record<string, number> = {};
    for (const s of db.sets.values()) {
      const name = (JSON.parse(s.data) as { exercise: string }).exercise;
      n[name] = (n[name] ?? 0) + 1;
    }
    return n;
  };
  const stored = (db: ReturnType<typeof memoryDb>) => JSON.parse(db.rows.get(`workouts:${DATE}`)!) as { mods: { light: boolean }; exercises: { name: string; part: number }[] };

  async function mount(hold: boolean) {
    const db = memoryDb();
    await saveProfile(db, profile());
    if (hold) await saveHold(db, HELD);
    await render(withProfile(db, <WorkoutScreen db={db} now={NOW} />));
    await screen.findByText('Push B day');
    return db;
  }

  async function secondSessionMax(hold: boolean) {
    const db = await mount(hold);
    await press('Start Push B');
    await screen.findByText('Push B');
    for (const n of ['Barbell Bench Press', 'Machine Shoulder Press', 'Pec Deck Fly', 'Cable Lateral Raise', 'Overhead Cable Extension']) {
      await expand(n);
      await fireEvent.changeText(screen.getByLabelText(`${n} set 1 kg`), '20');
      await fireEvent.changeText(screen.getByLabelText(`${n} set 1 reps`), '10');
      await press(`Mark ${n} set 1 done`);
    }
    await press('Training again later today?');
    await press('Add Pull B');
    await waitFor(() => expect(stored(db).exercises.some((e) => e.part === 2)).toBe(true));
    const names = stored(db).exercises.filter((e) => e.part === 2).map((e) => e.name);
    return Math.max(...names.map((n) => sets(db)[n] ?? 0));
  }

  it('the second session has one set fewer under the hold, and not without it', async () => {
    expect(await secondSessionMax(true)).toBeLessThanOrEqual(2);
  });

  it('control: without the hold the second session has 3-set exercises', async () => {
    expect(await secondSessionMax(false)).toBeGreaterThan(2);
  });

  async function seededPick(hold: boolean) {
    const db = await mount(hold);
    await pressDay('Choose Pull A');
    await pressDay('Pick exercises');
    await press('Start these exercises');
    await screen.findByText('Pull A');
    return { w: stored(db), max: Math.max(...Object.values(sets(db))) };
  }

  it('a seeded pick session stores mods.light and one set fewer under the hold', async () => {
    const { w, max } = await seededPick(true);
    expect(w.mods.light).toBe(true);
    expect(max).toBeLessThanOrEqual(2);
  });

  it('control: without the hold a seeded pick session is normal', async () => {
    const { w, max } = await seededPick(false);
    expect(w.mods.light).toBe(false);
    expect(max).toBeGreaterThan(2);
  });
});
