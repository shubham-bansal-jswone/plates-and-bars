import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { LiftRecord } from '@plate-and-bar/core';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings, type Settings } from '../src/settings/types';
import { ExerciseSettings } from '../src/workout/ExerciseSettingsSheet';
import { useSettings } from '../src/state/SettingsProvider';
import { Button } from '../src/components/ui';
import { EXERCISE_OVERRIDES_MAX as OVERRIDES_MAX } from '@plate-and-bar/core';
import { withOverride, withoutOverride } from '../src/workout/exerciseSettings';
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
    expect(screen.getByLabelText(`Reset to default for ${BENCH}`)).toBeTruthy();
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
    await press(`Reset to default for ${BENCH}`);
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
    // Each range caption is visible but hidden from screen readers, so the field's name is read once.
    for (const name of ['Range low (reps)', 'Range high']) {
      expect(screen.getByText(name, { includeHiddenElements: true })).toBeTruthy();
      expect(screen.queryByText(name)).toBeNull();
    }
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
    await press(`Reset to default for ${BENCH}`);
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

describe('exercise settings sheet: failed writes and the entry cap', () => {
  const NOT_STORED = 'Couldn’t save that on this device. Try again.';

  it('reports every failed save of the sheet, also a second one in a row', async () => {
    const db = await open();
    db.failWrites = true;
    await press(`${BENCH} settings`);
    await press(`Save settings for ${BENCH}`);
    expect(await screen.findByText(NOT_STORED)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(NOT_STORED)).toBeNull(), { timeout: 4000 });
    await press(`${BENCH} settings`);
    await press('Equipment: Cable');
    await press(`Save settings for ${BENCH}`);
    expect(screen.queryByText('Saved for this exercise')).toBeNull();
    expect(await screen.findByText(NOT_STORED)).toBeTruthy();
  });

  it('does not report a later failed write that is not this sheet’s save', async () => {
    const notify = jest.fn();
    const db = memoryDb();
    function Other() {
      const { update } = useSettings();
      return <Button label="Other write" onPress={() => void update({ rest_off: true })} />;
    }
    const info = { type: 'barbell' as const, lo: 6, hi: 10, step: 2.5 };
    await render(withProfile(db, <><ExerciseSettings name={BENCH} info={info} notify={notify} /><Other /></>));
    await press(`${BENCH} settings`);
    await press(`Save settings for ${BENCH}`);
    await waitFor(() => expect(settingsOf(db).exercise_overrides[BENCH]).toBeDefined());
    await act(async () => {});
    notify.mockClear();
    db.failWrites = true;
    await press('Other write');
    await act(async () => {});
    await act(async () => {});
    expect(notify).not.toHaveBeenCalled();
  });

  it('a retry that is stored after a failed save is not reported as failed', async () => {
    const db = await open();
    db.failWrites = true;
    await press(`${BENCH} settings`);
    await press(`Save settings for ${BENCH}`);
    expect(await screen.findByText(NOT_STORED)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(NOT_STORED)).toBeNull(), { timeout: 4000 });
    db.failWrites = false;
    await press(`${BENCH} settings`);
    await fireEvent.changeText(input('Range high'), '12');
    await press(`Save settings for ${BENCH}`);
    await waitFor(() => expect(settingsOf(db).exercise_overrides[BENCH]?.rep_high).toBe(12));
    await act(async () => {});
    expect(screen.queryByText(NOT_STORED)).toBeNull();
  });

  it('says nothing for a gear mounted after another screen’s failed write', async () => {
    const notify = jest.fn();
    const db = memoryDb();
    function Host() {
      const { update } = useSettings();
      const [show, setShow] = useState(false);
      return (
        <>
          <Button label="Other write" onPress={() => void update({ rest_off: true })} />
          <Button label="Show" onPress={() => setShow(true)} />
          {show ? <ExerciseSettings name={BENCH} info={{ type: 'barbell', lo: 6, hi: 10, step: 2.5 }} notify={notify} /> : null}
        </>
      );
    }
    await render(withProfile(db, <Host />));
    db.failWrites = true;
    await press('Other write');
    await act(async () => {});
    await press('Show');
    await act(async () => {});
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not report a failed sheet save again when later unrelated writes fail', async () => {
    const notify = jest.fn();
    const db = memoryDb();
    function Host() {
      const { update } = useSettings();
      return (
        <>
          <Button label="Other write" onPress={() => void update({ rest_off: true })} />
          <ExerciseSettings name={BENCH} info={{ type: 'barbell', lo: 6, hi: 10, step: 2.5 }} notify={notify} />
        </>
      );
    }
    await render(withProfile(db, <Host />));
    db.failWrites = true;
    await press(`${BENCH} settings`);
    await press(`Save settings for ${BENCH}`);
    await waitFor(() => expect(notify).toHaveBeenCalledWith(NOT_STORED));
    notify.mockClear();
    await press('Other write');
    await act(async () => {});
    await act(async () => {});
    expect(notify).not.toHaveBeenCalled();
  });

  it('writes the override onto the stored record, not the screen’s copy', async () => {
    const db = await open();
    // Another device’s override reached the store after the screen read it.
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), exercise_overrides: { 'Pec Deck Fly': { type: 'machine', step_kg: 5, rep_low: 6, rep_high: 8 } } });
    await press(`${BENCH} settings`);
    await press(`Save settings for ${BENCH}`);
    await waitFor(() => expect(Object.keys(settingsOf(db).exercise_overrides).sort()).toEqual([BENCH, 'Pec Deck Fly']));
  });

  const full = () => Object.fromEntries(Array.from({ length: OVERRIDES_MAX }, (_, i) => [`Custom ${i}`, { type: 'machine' as const, step_kg: 5, rep_low: 8, rep_high: 12 }]));

  it('refuses a new name past the 500-entry cap and keeps the sheet, but still changes an existing entry', async () => {
    const db = await open((d) => saveSettings(d, { ...defaultSettings('2026-10-08T00:00:00Z'), exercise_overrides: full() }));
    await press(`${BENCH} settings`);
    await press(`Save settings for ${BENCH}`);
    expect(screen.getByText(new RegExp(`most exercises that can be changed \\(${OVERRIDES_MAX}\\)`))).toBeTruthy();
    expect(screen.getByLabelText(`Close ${BENCH} settings`)).toBeTruthy();
    await act(async () => {});
    expect(Object.keys(settingsOf(db).exercise_overrides)).toHaveLength(OVERRIDES_MAX);
    expect(settingsOf(db).exercise_overrides[BENCH]).toBeUndefined();
    // Reset frees nothing here (no entry), but an entry already there can be replaced at the cap.
    await press(`Close ${BENCH} settings`);
  });

  it('refuses at the cap on the stored record when the screen’s copy is under it, and writes nothing', async () => {
    const db = await open();
    // The store filled up (a pull) after the screen read it: only the save sees it.
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), exercise_overrides: full() });
    await press(`${BENCH} settings`);
    await press(`Save settings for ${BENCH}`);
    // The save is queued, so the sheet has closed by the time the stored record says no: the cap message follows the saved one.
    expect(await screen.findByText(new RegExp(`most exercises that can be changed \\(${OVERRIDES_MAX}\\)`))).toBeTruthy();
    await act(async () => {});
    expect(Object.keys(settingsOf(db).exercise_overrides)).toHaveLength(OVERRIDES_MAX);
    expect(settingsOf(db).exercise_overrides[BENCH]).toBeUndefined();
    expect(screen.queryByText(NOT_STORED)).toBeNull();
    expect(screen.queryByText('Saved for this exercise')).toBeNull(); // the cap toast replaced it
  });

  it('Reset says so when the write to the device fails', async () => {
    const db = await open((d) => saveSettings(d, { ...defaultSettings('2026-10-08T00:00:00Z'), exercise_overrides: { [BENCH]: { type: 'machine', step_kg: 5, rep_low: 6, rep_high: 8 } } }));
    await press(`${BENCH} settings`);
    db.failWrites = true;
    await press(`Reset to default for ${BENCH}`);
    expect(await screen.findByText(NOT_STORED)).toBeTruthy();
    db.failWrites = false;
    expect(settingsOf(db).exercise_overrides[BENCH]).toBeDefined();
  });

  it('Reset removes the entry from the stored record when that record was replaced since the screen read it', async () => {
    const db = await open((d) => saveSettings(d, { ...defaultSettings('2026-10-08T00:00:00Z'), exercise_overrides: { [BENCH]: { type: 'machine', step_kg: 5, rep_low: 6, rep_high: 8 } } }));
    const other = { type: 'cable' as const, step_kg: 5, rep_low: 10, rep_high: 12 };
    await saveSettings(db, { ...defaultSettings('2026-10-08T01:00:00Z'), diet: 'veg', exercise_overrides: { [BENCH]: { type: 'machine', step_kg: 5, rep_low: 6, rep_high: 8 }, 'Pec Deck Fly': other } });
    await press(`${BENCH} settings`);
    await press(`Reset to default for ${BENCH}`);
    await waitFor(() => expect(Object.keys(settingsOf(db).exercise_overrides)).toEqual(['Pec Deck Fly']));
    expect(settingsOf(db).diet).toBe('veg');
  });

  it('allows replacing an entry when the cap is reached', async () => {
    const db = await open((d) => saveSettings(d, { ...defaultSettings('2026-10-08T00:00:00Z'), exercise_overrides: { ...full(), [BENCH]: { type: 'barbell', step_kg: 2.5, rep_low: 6, rep_high: 10 } } }));
    await press(`${BENCH} settings`);
    await fireEvent.changeText(input('Range high'), '11');
    await press(`Save settings for ${BENCH}`);
    await waitFor(() => expect(settingsOf(db).exercise_overrides[BENCH]?.rep_high).toBe(11));
  });
});

describe('withOverride and withoutOverride', () => {
  const one = { type: 'machine', step_kg: 5, rep_low: 6, rep_high: 8 } as const;
  const two = { type: 'cable', step_kg: 5, rep_low: 10, rep_high: 12 } as const;
  it('sets one entry and keeps the others', () => expect(withOverride({ a: one }, 'b', two)).toEqual({ a: one, b: two }));
  it('adds an entry for a name like __proto__ instead of setting the prototype', () => {
    const out = withOverride({ a: one }, '__proto__', two);
    expect(Object.keys(out).sort()).toEqual(['__proto__', 'a']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual(two);
  });
  it('withoutOverride drops only the named entry, also a name like __proto__', () => {
    expect(withoutOverride({ a: one, b: one }, 'a')).toEqual({ b: one });
    expect(Object.keys(withoutOverride(withOverride({ b: one }, '__proto__', one), 'b'))).toEqual(['__proto__']);
  });
  it('keeps an existing own __proto__ entry when another is set', () => {
    const stored = JSON.parse('{"__proto__":{"type":"machine","step_kg":5,"rep_low":6,"rep_high":8}}');
    const out = withOverride(stored, 'b', two);
    expect(Object.keys(out).sort()).toEqual(['__proto__', 'b']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(withoutOverride(out, 'b'))).toEqual(['__proto__']);
  });
});
