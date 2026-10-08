import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import golden from '../../../docs/spec/golden/targets.json';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveProfile } from '../src/db/records';
import { loadSettings, saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import type { TargetsRules } from '../src/targets/rules';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';


const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: mockPush }) }));

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

  it('offers Recalculate targets and Redo setup, which open the setup route', async () => {
    mockPush.mockClear();
    const db = memoryDb();
    await saveProfile(db, goldenProfile());
    await render(withProfile(db, <TargetsScreen db={db} />));
    await fireEvent.press(await screen.findByLabelText('Recalculate targets'));
    expect(mockPush).toHaveBeenLastCalledWith('/setup?recalc=1');
    await fireEvent.press(screen.getByLabelText('Redo setup'));
    expect(mockPush).toHaveBeenLastCalledWith('/setup');
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

  describe('focus muscles and coverage', () => {
    // Stand-in for core's rules (#148): the screen only calls them, the limit here is the test's.
    const rules = (over: Partial<TargetsRules> = {}): TargetsRules => ({
      focusChoices: ['chest', 'lats', 'hams'],
      focusMax: 2,
      toggleFocus: (cur, m) => (cur.includes(m) ? cur.filter((x) => x !== m) : cur.length >= 2 ? null : [...cur, m]),
      coverage: async () => [
        { muscle: 'chest', planned: 12, done: 6, low: false },
        { muscle: 'hams', planned: 3, done: 0, low: true },
      ],
      ...over,
    });

    it('shows neither section while core has no rules', async () => {
      const db = memoryDb();
      await saveProfile(db, goldenProfile());
      await render(withProfile(db, <TargetsScreen db={db} rules={null} />));
      await screen.findByLabelText('Start a rest timer after each set');
      expect(screen.queryByText('Focus muscles')).toBeNull();
      expect(screen.queryByText('Weekly coverage')).toBeNull();
    });

    it('stores the focus muscles core allows and refuses the one over its limit', async () => {
      const db = memoryDb();
      await saveProfile(db, goldenProfile());
      await render(withProfile(db, <TargetsScreen db={db} rules={rules()} />));
      await fireEvent.press(await screen.findByLabelText('Chest'));
      await fireEvent.press(screen.getByLabelText('Lats'));
      await waitFor(async () => expect((await loadSettings(db))?.focus).toEqual(['chest', 'lats']));
      await fireEvent.press(screen.getByLabelText('Hamstrings'));
      expect(await screen.findByText('Up to 2 focus muscles. Remove one first.')).toBeTruthy();
      expect((await loadSettings(db))?.focus).toEqual(['chest', 'lats']);
      expect(screen.getByLabelText('Chest').props.accessibilityState.selected).toBe(true);
      expect(screen.getByLabelText('Hamstrings').props.accessibilityState.selected).toBe(false);
      await fireEvent.press(screen.getByLabelText('Chest'));
      await waitFor(async () => expect((await loadSettings(db))?.focus).toEqual(['lats']));
    });

    it('lists planned against done per muscle, as core returns them', async () => {
      const db = memoryDb();
      await saveProfile(db, goldenProfile());
      await render(withProfile(db, <TargetsScreen db={db} rules={rules()} />));
      expect(await screen.findByLabelText('Chest: 12 sets planned, 6 done')).toBeTruthy();
      expect(screen.getByLabelText('Hamstrings: 3 sets planned, 0 done, low')).toBeTruthy();
    });

    it('says so when coverage cannot be read', async () => {
      const db = memoryDb();
      await saveProfile(db, goldenProfile());
      await render(withProfile(db, <TargetsScreen db={db} rules={rules({ coverage: async () => Promise.reject(new Error('x')) })} />));
      expect(await screen.findByText('Couldn’t read your coverage.')).toBeTruthy();
    });
  });
});
