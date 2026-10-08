import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import golden from '../../../docs/spec/golden/targets.json';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveProfile } from '../src/db/records';
import { loadSettings, saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';


const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: mockPush }) }));

const loadSettingsRaw = async (db: ReturnType<typeof memoryDb>) => JSON.parse(db.rows.get('user_settings:me') ?? 'null');

const g = golden.find((c) => c.input.id === 'male-30-lose-moderate')!;

function goldenProfile() {
  return buildProfile(
    {
      ...emptyDraft(),
      sex: 'male',
      age: '30',
      unit: 'cm',
      cm: '165',
      weight: '82',
      activity: 'sitting',
      where: 'gym',
      days: 6,
      exp: 'some',
      minutes: 60,
      goal: 'lose',
      pace: 'moderate',
      screen: ['no', 'no', 'no', 'no', 'no', 'no'],
    },
    new Date(2026, 9, 8),
  );
}

describe('TargetsScreen', () => {
  it('shows the golden targets for the stored profile, en-IN formatted', async () => {
    const db = memoryDb();
    await saveProfile(db, goldenProfile());
    await render(withProfile(db, <TargetsScreen db={db} />));
    expect(await screen.findByLabelText('1,990 kcal')).toBeTruthy();
    expect(g.output.kcal).toBe(1990);
    expect(screen.getByLabelText(`${g.output.protein} g protein`)).toBeTruthy();
    expect(screen.getByLabelText(`${g.output.carbs} g carbs`)).toBeTruthy();
    expect(screen.getByLabelText(`${g.output.fat} g fat`)).toBeTruthy();
    expect(screen.getByText('You burn about 2,493 kcal a day')).toBeTruthy();
  });

  it('offers the doctor card and notes when a health answer is yes, and home-plan note off the gym', async () => {
    const db = memoryDb();
    const p = { ...goldenProfile(), screen: ['yes', 'no', 'no', 'no', 'no', 'no'] as const, where: 'bodyweight' as const };
    await saveProfile(db, { ...p, screen: [...p.screen] });
    await render(withProfile(db, <TargetsScreen db={db} />));
    expect(await screen.findByText('Check with your doctor first')).toBeTruthy();
    expect(screen.getByLabelText('My doctor has cleared me')).toBeTruthy();
    expect(screen.getByText(/^Home plan: bodyweight/)).toBeTruthy();
  });

  it('with no profile offers Start setup, which opens the setup route', async () => {
    mockPush.mockClear();
    const db = memoryDb();
    await render(withProfile(db, <TargetsScreen db={db} />));
    await fireEvent.press(await screen.findByLabelText('Start setup'));
    expect(mockPush).toHaveBeenCalledWith('/setup');
  });

  it('offers Redo setup, which opens the setup route asking to stay there; Recalculate waits for weigh-ins', async () => {
    mockPush.mockClear();
    const db = memoryDb();
    await saveProfile(db, goldenProfile());
    await render(withProfile(db, <TargetsScreen db={db} />));
    expect(screen.queryByLabelText('Recalculate targets')).toBeNull();
    await fireEvent.press(await screen.findByLabelText('Redo setup'));
    expect(mockPush).toHaveBeenLastCalledWith('/setup?redo=1');
  });

  describe('rest timer', () => {
    it('is on by default, and turning it off is stored as Settings.rest_off', async () => {
      const db = memoryDb();
      await saveProfile(db, goldenProfile());
      await render(withProfile(db, <TargetsScreen db={db} />));
      const sw = await screen.findByLabelText('Start a rest timer after each set');
      expect(sw.props.value).toBe(true);
      await fireEvent(sw, 'valueChange', false);
      await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ rest_off: true, id: null, deleted_at: null }));
      expect(screen.getByLabelText('Start a rest timer after each set').props.value).toBe(false);
    });

    it('shows a stored rest_off, and turning it back on is stored', async () => {
      const db = memoryDb();
      await saveProfile(db, goldenProfile());
      await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: true });
      await render(withProfile(db, <TargetsScreen db={db} />));
      const sw = await screen.findByLabelText('Start a rest timer after each set');
      await waitFor(() => expect(sw.props.value).toBe(false));
      await fireEvent(screen.getByLabelText('Start a rest timer after each set'), 'valueChange', true);
      await waitFor(async () => expect((await loadSettings(db))?.rest_off).toBe(false));
    });

    it('says so when the save fails', async () => {
      const db = memoryDb();
      await saveProfile(db, goldenProfile());
      await render(withProfile(db, <TargetsScreen db={db} />));
      const sw = await screen.findByLabelText('Start a rest timer after each set');
      db.failWrites = true;
      await fireEvent(sw, 'valueChange', false);
      expect(await screen.findByText('Couldn’t save that on this device. Try again.')).toBeTruthy();
    });
  });

  it('says so, and refuses to write, when the stored settings cannot be read', async () => {
    const db = memoryDb();
    await saveProfile(db, goldenProfile());
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), focus: ['abs'] });
    const read = db.getFirstAsync.bind(db);
    db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('user_settings')) throw new Error('corrupt');
      return read(sql, ...p);
    }) as typeof db.getFirstAsync;
    await render(withProfile(db, <TargetsScreen db={db} />));
    expect(await screen.findByText(/Couldn’t read your saved settings/)).toBeTruthy();
    await fireEvent(screen.getByLabelText('Start a rest timer after each set'), 'valueChange', false);
    expect((await loadSettingsRaw(db))).toMatchObject({ focus: ['abs'], rest_off: false });
  });

  describe('focus muscles and coverage (core rules)', () => {
    it('stores the focus muscles, refuses a 4th with core’s limit, and shows the abs note', async () => {
      const db = memoryDb();
      await saveProfile(db, goldenProfile());
      await render(withProfile(db, <TargetsScreen db={db} />));
      for (const m of ['Chest', 'Lats', 'Abs']) await fireEvent.press(await screen.findByLabelText(m));
      await waitFor(async () => expect((await loadSettings(db))?.focus).toEqual(['chest', 'lats', 'abs']));
      expect(screen.getByText(/Training abs builds them/)).toBeTruthy();
      expect(screen.getByText(/aim for about 12–16 weekly sets/)).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Hamstrings'));
      expect(await screen.findByText('Up to 3 focus muscles. Remove one first.')).toBeTruthy();
      expect((await loadSettings(db))?.focus).toEqual(['chest', 'lats', 'abs']);
      await fireEvent.press(screen.getByLabelText('Chest'));
      await waitFor(async () => expect((await loadSettings(db))?.focus).toEqual(['lats', 'abs']));
      expect(screen.getByLabelText('Lats').props.accessibilityState.selected).toBe(true);
    });

    it('shows planned from the plan and done from logged sets, through core', async () => {
      const db = memoryDb();
      await saveProfile(db, goldenProfile());
      const wk = { id: null, version: 0, updated_at: 'x', deleted_at: null, date: '2026-10-08', template: 'Push B', base: 'Push B', where: null, cardio_min: null, mods: {}, exercises: [{ name: 'Barbell Bench Press' }], ci_choice: null };
      db.rows.set('workouts:2026-10-08', JSON.stringify(wk));
      for (let j = 0; j < 3; j++)
        db.sets.set(`s${j}`, { date: '2026-10-08', kind: 'work', done: 1, deleted: 0, data: JSON.stringify({ exercise: 'Barbell Bench Press', kind: 'work', done: true, deleted_at: null }) });
      await render(withProfile(db, <TargetsScreen db={db} now={() => new Date(2026, 9, 8)} />));
      const done = await screen.findByLabelText('Done in the last 7 days, Chest: 3 sets, low');
      expect(done).toBeTruthy();
      // planned: core's count for the 6-day split, no hard-coded figure here
      const planned = screen.getByLabelText(/^Weekly coverage: your plan, Chest: \d+ sets/);
      expect(planned).toBeTruthy();
      expect(screen.getByLabelText(/^Done in the last 7 days, Calves: 0 sets, low$/)).toBeTruthy();
    });
  });
});
