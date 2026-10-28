import { readdirSync, readFileSync } from 'fs';
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
import { getCatalog } from '../src/workout/catalog';
import { guidance, progressionContext } from '../src/workout/guidance';
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

  const stored = async (db: Awaited<ReturnType<typeof openDb>>, name: string, kind: 'work' | 'ramp', j: number) =>
    (await loadSets(db, DATE)).find((x) => x.exercise === name && x.set_index === j && x.kind === kind && !x.deleted_at);
  async function hook(unit: 'kg' | 'lb', seed?: string) {
    const db = await openDb();
    if (seed) await saveLift(db, seed, lift(80) as never);
    const opts = { db, profile: profile(), now: THURSDAY, focus: [], adjustments: {}, notify: jest.fn(), startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: { unit } } as unknown as Parameters<typeof useWorkoutDay>[0];
    const view = await renderHook(() => useWorkoutDay({ ...opts, reloadKey: 0 }));
    await waitFor(() => expect(view.result.current.day.ready).toBe(true));
    await act(async () => void (await view.result.current.start('Push B', {}, null)));
    await act(async () => void (await dayQueue.current));
    return { db, view };
  }
  const settle = () => act(async () => void (await dayQueue.current));

  it('ticking in lb leaves a typed weight untouched', async () => {
    const { db, view } = await hook('lb');
    const name = view.result.current.day.exs[0]!.name;
    await act(async () => view.result.current.editSet(0, 'work', 0, 'w', '100.123'));
    await act(async () => view.result.current.editSet(0, 'work', 0, 'r', '8'));
    await act(async () => void view.result.current.tick(0, 0));
    await settle();
    expect(view.result.current.day.exs[0]!.sets[0]!.w).toBe('100.123');
    expect((await stored(db, name, 'work', 0))?.weight_kg).toBe(100.123);
  });

  it('ticking a blank weight in lb stores the suggestion as its exact kg, not the rounded lb text', async () => {
    const { db, view } = await hook('lb', 'Barbell Bench Press');
    const ex = view.result.current.day.exs[0]!;
    expect(ex.name).toBe('Barbell Bench Press');
    const day = view.result.current.day;
    const ctx = progressionContext(DATE, day.lifts, profile(), day.workout, { unit: 'lb' });
    const sug = guidance(ex, ctx, day.workout).sug;
    expect(typeof sug.w === 'number' && sug.w > 0).toBe(true);
    await act(async () => view.result.current.editSet(0, 'work', 0, 'r', '8'));
    await act(async () => void view.result.current.tick(0, 0));
    await settle();
    const kg = (await stored(db, ex.name, 'work', 0))?.weight_kg;
    expect(kg).toBe(sug.w);
    expect(kg).not.toBe(Math.round((kg as number) * 10) / 10); // 79.37866475, not 79.4
  });

  it('a ramp tick after an Easy set stores the next weight as exact kg', async () => {
    const { db, view } = await hook('lb');
    const name = view.result.current.day.exs[1]!.name;
    await act(async () => view.result.current.rampStart(1));
    await settle();
    await act(async () => view.result.current.editSet(1, 'ramp', 0, 'w', String(lbToKg(45))));
    await act(async () => void view.result.current.rampTick(1, 0));
    await act(async () => view.result.current.rampRated(1, 0, 'easy'));
    await settle();
    await act(async () => void view.result.current.rampTick(1, 1));
    await settle();
    const ramp = view.result.current.day.exs[1]!.ramp;
    const { exInfo, infoForUnit, rampTickFill } = jest.requireActual('@plate-and-bar/core') as typeof import('@plate-and-bar/core');
    const info = infoForUnit(exInfo(name, getCatalog()), 'lb');
    const want = rampTickFill([{ w: '45', r: '5', done: true, rate: 'easy' }, { w: '', r: '', done: false }], 1, info, 'lb').w;
    expect(Number(want)).toBeGreaterThan(45);
    expect((await stored(db, name, 'ramp', 1))?.weight_kg).toBe(lbToKg(Number(want)));
    expect(ramp[1]!.done).toBe(true);
  });

  const setRow = (unit: 'kg' | 'lb', onTick = jest.fn(), locked = false) =>
    render(<SetRow n="1" label="Squat set 1" row={blankRow()} wHead={unit} repsHead="reps" ph={{ w: '–', r: '–' }} onEdit={jest.fn()} onTick={onTick} unit={unit} locked={locked} />);

  it.each([['135.', 135], ['135,', 135], ['.5', 0.5]])('a part-typed %s is a number in lb: saved, and the tick goes ahead', async (text, lb) => {
    const onEdit = jest.fn();
    const onTick = jest.fn();
    await render(<SetRow n="1" label="Squat set 1" row={blankRow()} wHead="lb" repsHead="reps" ph={{ w: '–', r: '–' }} onEdit={onEdit} onTick={onTick} unit="lb" />);
    await fireEvent.changeText(screen.getByLabelText('Squat set 1 lb'), text);
    expect(onEdit).toHaveBeenLastCalledWith('w', String(lbToKg(lb)));
    await fireEvent.press(screen.getByLabelText('Mark Squat set 1 done'));
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('in kg a part-typed 135. is passed on as typed and ticks', async () => {
    const onTick = jest.fn();
    await setRow('kg', onTick);
    await fireEvent.changeText(screen.getByLabelText('Squat set 1 kg'), '135.');
    await fireEvent.press(screen.getByLabelText('Mark Squat set 1 done'));
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('in lb a weight that is not a number refuses the tick, with a message, until it is fixed', async () => {
    const onTick = jest.fn();
    await setRow('lb', onTick);
    await fireEvent.changeText(screen.getByLabelText('Squat set 1 lb'), '12abc');
    await fireEvent.press(screen.getByLabelText('Mark Squat set 1 done'));
    expect(onTick).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the weight as a number, like 135 or 62.5.')).toBeTruthy();
    expect(screen.getByLabelText('Squat set 1 lb').props['aria-invalid']).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Squat set 1 lb'), '125');
    expect(screen.queryByText(/Enter the weight as a number/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Mark Squat set 1 done'));
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('a weight that is not a number stays marked after blur and still refuses the tick; fixing it clears it', async () => {
    const onTick = jest.fn();
    await setRow('lb', onTick);
    const input = screen.getByLabelText('Squat set 1 lb');
    await fireEvent.changeText(input, '135lb');
    await fireEvent(input, 'blur');
    expect(screen.getByLabelText('Squat set 1 lb').props.value).toBe('135lb');
    expect(screen.getByLabelText('Squat set 1 lb').props['aria-invalid']).toBe(true);
    await fireEvent.press(screen.getByLabelText('Mark Squat set 1 done'));
    expect(onTick).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Squat set 1 lb'), '');
    await fireEvent(screen.getByLabelText('Squat set 1 lb'), 'blur');
    await fireEvent.press(screen.getByLabelText('Mark Squat set 1 done'));
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('screen: junk in lb, blur, reps, tick stores nothing and does not tick', async () => {
    const db = await mountScreen('lb');
    const w = await screen.findByLabelText('Barbell Bench Press set 1 lb');
    await fireEvent.changeText(w, '135lb');
    await fireEvent(w, 'blur');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 reps'), '8');
    await fireEvent.press(screen.getByLabelText('Mark Barbell Bench Press set 1 done'));
    await waitFor(async () => expect((await loadSets(db, DATE)).find((x) => x.exercise === 'Barbell Bench Press' && x.set_index === 0)?.reps).toBe(8));
    expect((await loadSets(db, DATE)).find((x) => x.exercise === 'Barbell Bench Press' && x.set_index === 0)).toMatchObject({ done: false, weight_kg: null });
  });

  it('an empty weight still ticks (the suggestion fills it)', async () => {
    const onTick = jest.fn();
    await setRow('lb', onTick);
    await fireEvent.press(screen.getByLabelText('Mark Squat set 1 done'));
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('a kg value that came from lb shows rounded, a typed kg value stays as typed', async () => {
    const mk = (w: string) => <SetRow n="1" label="Squat set 1" row={{ ...blankRow(), w }} wHead="kg" repsHead="reps" ph={{ w: '–', r: '–' }} onEdit={jest.fn()} onTick={() => undefined} unit="kg" />;
    const v = await render(mk('61.23496995'));
    expect(screen.getByLabelText('Squat set 1 kg').props.value).toBe('61.2');
    await v.rerender(mk('101.25'));
    expect(screen.getByLabelText('Squat set 1 kg').props.value).toBe('101.25');
  });

  it('until the stored unit has loaded the set row cannot be edited or ticked', async () => {
    const onTick = jest.fn();
    await setRow('kg', onTick, true);
    expect(screen.getByLabelText('Squat set 1 kg').props.editable).toBe(false);
    expect(screen.getByLabelText('Squat set 1 reps').props.editable).toBe(false);
    expect(screen.getByLabelText('Squat set 1 kg').props.value).toBe(''); // no kg text flashes for an lb user
    await fireEvent.press(screen.getByLabelText('Mark Squat set 1 done'));
    expect(onTick).not.toHaveBeenCalled();
  });

  it('the provider is not ready until it has read the stored unit', async () => {
    const db = memoryDb();
    db.rows.set(KEY, 'lb');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const read = db.getFirstAsync.bind(db);
    db.getFirstAsync = (async (...a: Parameters<typeof read>) => (await gate, read(...a))) as typeof db.getFirstAsync;
    const { result } = await renderHook(() => useWeightUnit(), { wrapper: ({ children }) => <WeightUnitProvider db={db}>{children}</WeightUnitProvider> });
    expect(result.current.ready).toBe(false);
    release();
    await waitFor(() => expect(result.current).toMatchObject({ ready: true, unit: 'lb' }));
  });
});

describe('no hard-coded kg in the session screens', () => {
  const dir = join(__dirname, '../src/workout');
  const files = [...readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && f !== 'unitText.ts').map((f) => `workout/${f}`), 'screens/WorkoutScreen.tsx'];
  const badLines = (src: string): string[] =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .map((l) => l.replace(/\s\/\/.*$/, '').replace(/const unit = \w+\.unit \?\? 'kg';/g, '').replace(/(unit\s*(?:=|!==|===)\s*)'kg'/gi, '$1UNIT')) // the unit value 'kg' is not text
      .filter((l) => /(['"`][^'"`\n]*\bkg\b)|(\}\s*kg\b)|(>\s*kg\b)|(^\s*kg\b)/i.test(l));
  it('catches the shapes it is meant to', () => {
    expect(badLines("const a = 'Kg';\nx = `${w} KG`;\n<Text>{w}\n  kg lifted</Text>\n<Text>{w} kg</Text>")).toHaveLength(4);
    expect(badLines("const weight_kg = 1; const unit = tune.unit ?? 'kg'; if (unit === 'kg') {}")).toEqual([]);
    expect(badLines("const t = `${w} ${unit ?? 'kg'}`;")).toHaveLength(1);
  });
  it('covers every session file', () => expect(files.length).toBeGreaterThan(30));
  it.each(files)('%s has no kg in a string or in JSX text', (f) => {
    expect(badLines(readFileSync(join(__dirname, '../src', f), 'utf8'))).toEqual([]);
  });
});
