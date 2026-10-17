import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { LiftRecord } from '@plate-and-bar/core';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings, type Settings } from '../src/settings/types';
import { overrideFromDraft, withoutOverride } from '../src/workout/exerciseSettings';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

// Thursday 2026-10-08, Push B: Barbell Bench Press (barbell 6-10, step 2.5), Machine Shoulder Press (machine 8-12, step 5), ...
const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const BENCH = 'Barbell Bench Press';
const SUGGESTED_BEFORE = 'Suggested: 62.5 kg × 6–10 reps';

type Db = ReturnType<typeof memoryDb>;
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));
const settingsOf = (db: Db) => JSON.parse(db.rows.get('user_settings:me') as string) as Settings;
const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );

/** A finished last session of the bench at 60 kg for 10 reps (the top of 6-10), so the card suggests a step up. */
function seedBench(db: Db) {
  const set = { w: 60, r: 10, rate: 'right' as const };
  const rec: LiftRecord = { date: '2026-10-05', sets: [set, set, set], form: 'yes', n: 2, first: '2026-09-20', prev: null, hist: [{ date: '2026-09-20', e: 80 }], pbToast: null };
  db.rows.set(`lift_stats:${BENCH}`, JSON.stringify(rec));
}

async function open(prep?: (db: Db) => Promise<void> | void) {
  const db = memoryDb();
  await saveProfile(db, profile());
  seedBench(db);
  await prep?.(db);
  await mount(db);
  await press('Start Push B');
  await screen.findByText('Push B');
  return db;
}
const mount = (db: Db) => render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
const input = (label: string) => screen.getByLabelText(label);

describe('exercise settings sheet', () => {
  it('opens from the gear with the exercise as its title and its current equipment, step and range', async () => {
    await open();
    expect(screen.queryByLabelText(`Close ${BENCH} settings`)).toBeNull();
    const titles = () => screen.getAllByRole('header').filter((h) => h.props['aria-level'] === 2 && (h.children as unknown[]).join('') === BENCH).length;
    const before = titles();
    await press(`${BENCH} settings`);
    // The sheet's title is a level-2 heading with the exercise's name, next to the card's own.
    expect(titles()).toBe(before + 1);
    expect(screen.getByText('Equipment')).toBeTruthy();
    expect(screen.getByLabelText('Equipment: Barbell').props['aria-pressed']).toBe(true);
    expect(screen.getByLabelText('Equipment: Dumbbells').props['aria-pressed']).toBe(false);
    for (const t of ['Machine', 'Cable', 'Assisted machine', 'Bodyweight', 'Timed hold']) expect(screen.getByLabelText(`Equipment: ${t}`)).toBeTruthy();
    expect(screen.getByText('Smallest weight jump on this equipment')).toBeTruthy();
    expect(screen.getByLabelText('Weight jump 2.5 kg').props['aria-pressed']).toBe(true);
    for (const x of ['1', '1.25', '2', '5', '10']) expect(screen.getByLabelText(`Weight jump ${x} kg`).props['aria-pressed']).toBe(false);
    expect(screen.getByText('Machines differ between gyms. Set this to the real step on your gym’s machine.')).toBeTruthy();
    expect(input('Range low (reps)').props.value).toBe('6');
    expect(input('Range high').props.value).toBe('10');
    expect(screen.getByLabelText(`Save settings for ${BENCH}`)).toBeTruthy();
    expect(screen.getByLabelText(`Reset ${BENCH} to default`)).toBeTruthy();
  });

  it('Save writes the override and the card shows it at once: type, step, range, each-suffix and suggestion', async () => {
    const db = await open();
    expect(screen.getByText(SUGGESTED_BEFORE)).toBeTruthy();
    expect(screen.getByText(/Barbell, 6–10 reps, steps of 2.5 kg/)).toBeTruthy();
    expect(screen.getByLabelText(`${BENCH} set 1 kg`)).toBeTruthy();
    await press(`${BENCH} settings`);
    await press('Equipment: Dumbbells');
    await press('Weight jump 1 kg');
    await fireEvent.changeText(input('Range low (reps)'), '8');
    await fireEvent.changeText(input('Range high'), '12');
    await press(`Save settings for ${BENCH}`);

    // The sheet closes, and the card has the new setting before anything is read back from the store.
    expect(screen.queryByLabelText(`Close ${BENCH} settings`)).toBeNull();
    expect(screen.getByText('Saved for this exercise')).toBeTruthy();
    expect(screen.getByText(/Dumbbells, 8–12 reps, steps of 1 kg/)).toBeTruthy();
    expect(screen.getByLabelText(`${BENCH} set 1 kg each`)).toBeTruthy();
    expect(screen.queryByText(SUGGESTED_BEFORE)).toBeNull();
    // Dumbbells now: the weight is per dumbbell, and 8–12 reps aims for 11 after three sets of 10.
    expect(screen.getByText('Suggested: 60 kg each × 11 reps')).toBeTruthy();
    await waitFor(() => expect(settingsOf(db).exercise_overrides[BENCH]).toEqual({ type: 'dumbbell', step_kg: 1, rep_low: 8, rep_high: 12 }));
  });

  it('keeps the override after a reload, and the sheet opens on it', async () => {
    const db = await open();
    await press(`${BENCH} settings`);
    await press('Equipment: Machine');
    await fireEvent.changeText(input('Range high'), '15');
    await press(`Save settings for ${BENCH}`);
    await waitFor(() => expect(settingsOf(db).exercise_overrides[BENCH]).toEqual({ type: 'machine', step_kg: 5, rep_low: 6, rep_high: 15 }));
    await screen.unmount();
    await mount(db);
    await screen.findByText('Push B');
    expect(screen.getByText(/Machine, 6–15 reps, steps of 5 kg/)).toBeTruthy();
    await press(`${BENCH} settings`);
    expect(screen.getByLabelText('Equipment: Machine').props['aria-pressed']).toBe(true);
    expect(screen.getByLabelText('Weight jump 5 kg').props['aria-pressed']).toBe(true);
    expect(input('Range high').props.value).toBe('15');
  });

  it('keeps another exercise’s override and the fields it does not know when it saves', async () => {
    const db = await open(async (d) => {
      await saveSettings(d, { ...defaultSettings('2026-10-08T00:00:00Z'), diet: 'veg', exercise_overrides: { 'Pec Deck Fly': { type: 'machine', step_kg: 5, rep_low: 6, rep_high: 8 } } });
    });
    await press(`${BENCH} settings`);
    await press('Save settings for Barbell Bench Press');
    await waitFor(() => expect(Object.keys(settingsOf(db).exercise_overrides).sort()).toEqual([BENCH, 'Pec Deck Fly']));
    expect(settingsOf(db).diet).toBe('veg');
    expect(settingsOf(db).exercise_overrides[BENCH]).toEqual({ type: 'barbell', step_kg: 2.5, rep_low: 6, rep_high: 10 });
  });

  it('Reset to default removes only this exercise’s entry and the card goes back to the catalogue', async () => {
    const db = await open(async (d) => {
      await saveSettings(d, {
        ...defaultSettings('2026-10-08T00:00:00Z'),
        exercise_overrides: { [BENCH]: { type: 'dumbbell', step_kg: 1, rep_low: 8, rep_high: 12 }, 'Pec Deck Fly': { type: 'machine', step_kg: 5, rep_low: 6, rep_high: 8 } },
      });
    });
    expect(screen.getByText(/Dumbbells, 8–12 reps, steps of 1 kg/)).toBeTruthy();
    await press(`${BENCH} settings`);
    await press(`Reset ${BENCH} to default`);
    expect(screen.getByText('Back to defaults')).toBeTruthy();
    expect(screen.getByText(/Barbell, 6–10 reps, steps of 2.5 kg/)).toBeTruthy();
    expect(screen.getByText(SUGGESTED_BEFORE)).toBeTruthy();
    await waitFor(() => expect(Object.keys(settingsOf(db).exercise_overrides)).toEqual(['Pec Deck Fly']));
  });

  it('refuses an invalid range with a message, keeps the sheet and its values, and writes nothing', async () => {
    const db = await open();
    await press(`${BENCH} settings`);
    await press('Equipment: Cable');
    for (const [lo, hi] of [['12', '8'], ['', '10'], ['6', '  '], ['0', '10'], ['-3', '10'], ['abc', '10']] as const) {
      await fireEvent.changeText(input('Range low (reps)'), lo);
      await fireEvent.changeText(input('Range high'), hi);
      await press(`Save settings for ${BENCH}`);
      expect(screen.getByText('Set a valid range, like 8 to 12.')).toBeTruthy();
      expect(screen.getByLabelText(`Close ${BENCH} settings`)).toBeTruthy();
      expect(screen.getByLabelText('Equipment: Cable').props['aria-pressed']).toBe(true);
      expect(input('Range low (reps)').props.value).toBe(lo);
      expect(input('Range high').props.value).toBe(hi);
    }
    await act(async () => {});
    expect(db.rows.get('user_settings:me')).toBeUndefined();
    expect(screen.queryByText('Saved for this exercise')).toBeNull();
  });

  it('rounds the range to whole reps, as the prototype does', async () => {
    const db = await open();
    await press(`${BENCH} settings`);
    await fireEvent.changeText(input('Range low (reps)'), '7.6');
    await fireEvent.changeText(input('Range high'), '12,4');
    await press(`Save settings for ${BENCH}`);
    await waitFor(() => expect(settingsOf(db).exercise_overrides[BENCH]).toMatchObject({ rep_low: 8, rep_high: 12 }));
  });

  it('picking another equipment starts at that equipment’s default step, and hides the step for bodyweight and timed holds', async () => {
    await open();
    await press(`${BENCH} settings`);
    await press('Weight jump 10 kg');
    await press('Equipment: Assisted machine');
    expect(screen.getByLabelText('Weight jump 5 kg').props['aria-pressed']).toBe(true);
    expect(screen.getByLabelText('Weight jump 10 kg').props['aria-pressed']).toBe(false);
    await press('Equipment: Dumbbells');
    expect(screen.getByText('Smallest weight jump (per dumbbell)')).toBeTruthy();
    expect(screen.getByLabelText('Weight jump 2.5 kg').props['aria-pressed']).toBe(true);
    await press('Equipment: Timed hold');
    expect(screen.queryByText(/Smallest weight jump/)).toBeNull();
    expect(screen.queryByLabelText('Weight jump 5 kg')).toBeNull();
    expect(screen.queryByText(/Machines differ between gyms/)).toBeNull();
    expect(screen.getByLabelText('Range low (sec)')).toBeTruthy();
    await press('Equipment: Bodyweight');
    expect(screen.queryByText(/Smallest weight jump/)).toBeNull();
    expect(screen.getByLabelText('Range low (reps)')).toBeTruthy();
  });

  it('saves a no-load type with step 0 and the card shows no weight steps', async () => {
    const db = await open();
    await press(`${BENCH} settings`);
    await press('Equipment: Bodyweight');
    await press(`Save settings for ${BENCH}`);
    await waitFor(() => expect(settingsOf(db).exercise_overrides[BENCH]).toEqual({ type: 'bodyweight', step_kg: 0, rep_low: 6, rep_high: 10 }));
    expect(screen.getByText(/Bodyweight, 6–10 reps/).children.join('')).not.toMatch(/steps of/);
    expect(screen.getByLabelText(`${BENCH} set 1 +kg`)).toBeTruthy();
  });

  it('Close leaves the settings as they were', async () => {
    const db = await open();
    await press(`${BENCH} settings`);
    await press('Equipment: Cable');
    await fireEvent.changeText(input('Range high'), '30');
    await press(`Close ${BENCH} settings`);
    await act(async () => {});
    expect(screen.queryByLabelText(`Close ${BENCH} settings`)).toBeNull();
    expect(db.rows.get('user_settings:me')).toBeUndefined();
    expect(screen.getByText(/Barbell, 6–10 reps, steps of 2.5 kg/)).toBeTruthy();
    // Opened again, it starts from the card's setting, not from the abandoned edit.
    await press(`${BENCH} settings`);
    expect(input('Range high').props.value).toBe('10');
  });

  it('says so, and keeps the sheet’s values, when the stored settings could not be read', async () => {
    const db = await open((d) => {
      const get = d.getFirstAsync.bind(d);
      d.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
        if (sql.includes('user_settings')) throw new Error('unreadable');
        return get(sql, ...p);
      }) as Db['getFirstAsync'];
    });
    await press(`${BENCH} settings`);
    await press('Equipment: Cable');
    await fireEvent.changeText(input('Range high'), '14');
    await press(`Save settings for ${BENCH}`);
    expect(screen.getByText(/Couldn’t read your saved settings, so changes are not saved/)).toBeTruthy();
    expect(screen.getByLabelText(`Close ${BENCH} settings`)).toBeTruthy();
    expect(screen.getByLabelText('Equipment: Cable').props['aria-pressed']).toBe(true);
    expect(input('Range high').props.value).toBe('14');
    await press(`Reset ${BENCH} to default`);
    expect(screen.getByText(/Couldn’t read your saved settings/)).toBeTruthy();
    expect(db.rows.get('user_settings:me')).toBeUndefined();
  });

  it('says so when the write to the device fails after the sheet closed', async () => {
    const db = await open();
    await press(`${BENCH} settings`);
    db.failWrites = true;
    await press(`Save settings for ${BENCH}`);
    expect(await screen.findByText('Couldn’t save that on this device. Try again.')).toBeTruthy();
    // The card still shows what was chosen; the edit is written with the next save.
    expect(screen.getByLabelText(`${BENCH} settings`)).toBeTruthy();
  });
});

describe('overrideFromDraft', () => {
  const d = { type: 'barbell' as const, step: 2.5, lo: '6', hi: '10' };
  it('builds the contract entry', () => expect(overrideFromDraft(d)).toEqual({ type: 'barbell', step_kg: 2.5, rep_low: 6, rep_high: 10 }));
  it('accepts a range of one rep count', () => expect(overrideFromDraft({ ...d, lo: '8', hi: '8' })).toMatchObject({ rep_low: 8, rep_high: 8 }));
  it.each([
    ['low above high', '11', '10'],
    ['zero low', '0', '10'],
    ['rounds to zero', '0.4', '10'],
    ['negative', '-1', '10'],
    ['blank with zero-width characters', '​', '10'],
    ['not a number', 'x', '10'],
    ['not a safe integer', '6', '1e30'],
  ])('refuses %s', (_n, lo, hi) => expect(overrideFromDraft({ ...d, lo, hi })).toBeNull());
  it('never writes a step below the contract’s 0', () => expect(overrideFromDraft({ ...d, step: -1 })?.step_kg).toBe(0));
  it('withoutOverride drops only the named entry, also a name like __proto__', () => {
    const one = { type: 'machine', step_kg: 5, rep_low: 6, rep_high: 8 } as const;
    expect(withoutOverride({ a: one, b: one }, 'a')).toEqual({ b: one });
    expect(Object.keys(withoutOverride(JSON.parse('{"__proto__": {"type":"machine","step_kg":5,"rep_low":6,"rep_high":8}, "b": {"type":"machine","step_kg":5,"rep_low":6,"rep_high":8}}'), 'b'))).toEqual(['__proto__']);
  });
});
