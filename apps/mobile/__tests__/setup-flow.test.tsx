import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { normaliseSetup } from '@plate-and-bar/core';
import golden from '../../../docs/spec/golden/targets.json';
import { SetupScreen } from '../src/screens/SetupScreen';
import { loadConsent, loadProfile, saveConsent, saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft, localDate } from '../src/setup/logic';
import { SCREEN_Q } from '../src/setup/copy';
import { memoryDb, withProfile } from './helpers';
import { loadWeights, saveWeight } from '../src/db/progress';
import { buildResults } from '../src/setup/results';
import { fmt } from '../src/format';
import { resetPendingToast, usePendingToast } from '../src/state/pendingToast';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: () => mockCanGoBack }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const g = golden.find((c) => c.input.id === 'male-30-lose-moderate')!;
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));

async function consent() {
  await screen.findByText('Before you start');
  await press('Continue');
  expect(screen.getByText('Tick the box to continue.')).toBeTruthy();
  expect(screen.getByText(/Withdrawing your consent means deleting your account/)).toBeTruthy();
  await fireEvent(screen.getByLabelText('I understand and agree to my data being stored as described'), 'valueChange', true);
  await press('Continue');
}

describe('setup flow', () => {
  beforeEach(() => mockReplace.mockClear());

  it('consent screen describes on-device storage, server storage after sign-in and opt-in AI, with no Claude', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await screen.findByText('Before you start');
    expect(
      screen.getByText(/Your data stays on this device\. If you sign in, it is also stored on our own server so it syncs between your devices\./),
    ).toBeTruthy();
    expect(screen.getByText(/AI features are off by default and need their own opt-in\. No photos are sent anywhere\./)).toBeTruthy();
    expect(screen.queryByText(/Claude/)).toBeNull();
  });

  it('hides the visible Age caption from screen readers; the field speaks the label', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await consent();
    expect(screen.getByText('Age', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('Age')).toBeNull();
    expect(screen.getAllByLabelText('Age')).toHaveLength(1);
  });

  it('hides the visible Weight (kg) caption from screen readers; the field speaks its own label', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await consent();
    expect(screen.getByText('Weight (kg)', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('Weight (kg)')).toBeNull();
    expect(screen.getByLabelText('Weight in kg')).toBeTruthy();
  });

  it('consent first, then answers stored as the contract Profile; results match calcTargets', async () => {
    const db = memoryDb();
    await render(withProfile(db, <SetupScreen />));
    await consent();

    await screen.findByText('Let’s work out your targets');
    await press('Continue');
    expect(screen.getByText('Choose male or female for the calorie formula.')).toBeTruthy();
    await press('Male');
    await fireEvent.changeText(screen.getByLabelText('Age'), '30');
    await press('Use cm');
    await fireEvent.changeText(screen.getByLabelText('Height in cm'), '165');
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '82');
    await press('Continue');

    await press('Continue');
    expect(screen.getByText('Pick the option closest to a typical weekday.')).toBeTruthy();
    await press('Mostly sitting. Desk job, little walking (under ~5,000 steps)');
    await press('Continue');

    await press('Continue');
    expect(screen.getByText('Choose how many sessions you do a week.')).toBeTruthy();
    await press('6');
    await press('Continue');
    expect(screen.getByText('Choose where you train.')).toBeTruthy();
    await press('At a gym. Machines, cables, barbells and dumbbells');
    await press('Continue');
    expect(screen.getByText('Choose your training experience.')).toBeTruthy();
    await press('Some experience. 6 months to 2 years of regular training');
    await press('Continue');
    expect(screen.getByText('Choose a typical session length.')).toBeTruthy();
    await press('60 min');
    await press('Continue');

    await press('Lose fat. Steady fat loss while keeping muscle');
    await press('See my targets');
    expect(screen.getByText('Answer the health check questions.')).toBeTruthy();
    expect(screen.getByLabelText('Why? Why a health check before training?')).toBeTruthy();
    for (const q of SCREEN_Q) await fireEvent.press(within(screen.getByLabelText(q)).getByLabelText('No'));
    await press('See my targets');

    expect(screen.getByLabelText("1,990 kcal")).toBeTruthy();
    expect(screen.getByLabelText(`${g.output.protein} g protein`)).toBeTruthy();
    expect(screen.getByLabelText(`${g.output.carbs} g carbs`)).toBeTruthy();
    expect(screen.getByLabelText(`${g.output.fat} g fat`)).toBeTruthy();
    expect(await loadProfile(db)).toBeNull();

    expect(g.output.tdee).toBe(2493);
    const levelOne = screen.getAllByRole('header').filter((h) => h.props['aria-level'] === 1);
    expect(levelOne).toHaveLength(1);
    expect(levelOne[0]!.props.children).toBe('You burn about 2,493 kcal a day');

    await press('Use these targets');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    const p = await loadProfile(db);
    expect(p).toMatchObject({
      id: null,
      sex: 'male',
      age: 30,
      height_cm: 165,
      weight_kg: 82,
      activity: 'sitting',
      where: 'gym',
      days: 6,
      exp: 'some',
      minutes: 60,
      goal: 'lose',
      pace: 'moderate',
      special: 'none',
      screen: ['no', 'no', 'no', 'no', 'no', 'no'],
      cleared: null,
      version: 0,
      deleted_at: null,
      targets: { kcal: g.output.kcal, protein_g: g.output.protein, carbs_g: g.output.carbs, fat_g: g.output.fat },
    });
    const { id, version, updated_at, deleted_at, ...stored } = p!;
    expect(id).toBeNull();
    expect(version).toBe(0);
    expect(deleted_at).toBeNull();
    expect(updated_at).toMatch(/Z$/);
    expect(stored).toEqual(
      normaliseSetup(
        {
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
        p!.created,
      ),
    );
    expect(p!.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await loadConsent(db)).toMatchObject({ kind: 'data_storage', text_version: '2026-10-17', version: 0 });
  });

  it('accepts zero training days and stores exp and minutes as null', async () => {
    const db = memoryDb();
    await render(withProfile(db, <SetupScreen />));
    await consent();
    await press('Female');
    await press('Breastfeeding');
    await fireEvent.changeText(screen.getByLabelText('Age'), '62');
    await fireEvent.changeText(screen.getByLabelText('Height feet'), '5');
    await fireEvent.changeText(screen.getByLabelText('Height inches'), '4');
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '70');
    await press('Continue');
    await press('Some walking. Errands and short walks (~5,000–7,500 steps)');
    await press('Continue');
    await press('None yet');
    expect(screen.queryByText('Where do you train?')).toBeNull();
    expect(screen.queryByLabelText('60 min')).toBeNull();
    await press('Continue');
    await press('Maintain. Keep weight steady and get stronger');
    for (const q of SCREEN_Q) await fireEvent.press(within(screen.getByLabelText(q)).getByLabelText('No'));
    await press('See my targets');
    expect(screen.getByText(/^For 60 and over/)).toBeTruthy();
    expect(screen.getByLabelText('Why? Training and eating after 60')).toBeTruthy();
    expect(screen.queryByText(/^Home plan/)).toBeNull();
    await press('Use these targets');
    await waitFor(async () => expect(await loadProfile(db)).not.toBeNull());
    expect(await loadProfile(db)).toMatchObject({ days: 0, exp: null, minutes: null, special: 'breastfeeding', where: 'gym' });
  });

  it('profile id stays null locally; consent ids are random and earlier consents are kept', async () => {
    const db = memoryDb();
    await render(withProfile(db, <SetupScreen />));
    await consent();
    const keys = [...db.rows.keys()].filter((k) => k.startsWith('consents:'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^consents:[0-9a-f-]{36}$/);
    await saveConsent(db, { ...(await loadConsent(db))!, id: 'second', given_at: '2099-01-01T00:00:00Z' });
    expect([...db.rows.keys()].filter((k) => k.startsWith('consents:'))).toHaveLength(2);
    expect((await loadConsent(db))!.id).toBe('second');
  });

  it('shows an error and stays on consent when the write fails', async () => {
    const db = memoryDb();
    db.failWrites = true;
    await render(withProfile(db, <SetupScreen />));
    await screen.findByText('Before you start');
    await fireEvent(screen.getByLabelText('I understand and agree to my data being stored as described'), 'valueChange', true);
    await press('Continue');
    expect(await screen.findByText('Could not save on this device. Please try again.')).toBeTruthy();
    expect(screen.getByText('Before you start')).toBeTruthy();
  });

  it('shows an error and stays on the results when saving the profile fails', async () => {
    const db = memoryDb();
    await render(withProfile(db, <SetupScreen />));
    await consent();
    await press('Female');
    await fireEvent.changeText(screen.getByLabelText('Age'), '30');
    await fireEvent.changeText(screen.getByLabelText('Height feet'), '5');
    await fireEvent.changeText(screen.getByLabelText('Height inches'), '4');
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '70');
    await press('Continue');
    await press('Some walking. Errands and short walks (~5,000–7,500 steps)');
    await press('Continue');
    await press('None yet');
    await press('Continue');
    await press('Maintain. Keep weight steady and get stronger');
    for (const q of SCREEN_Q) await fireEvent.press(within(screen.getByLabelText(q)).getByLabelText('No'));
    await press('See my targets');
    db.failWrites = true;
    await press('Use these targets');
    expect(await screen.findByText('Could not save on this device. Please try again.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(await loadProfile(db)).toBeNull();
  });

  it('Skip for now leaves setup without a profile', async () => {
    const db = memoryDb();
    await render(withProfile(db, <SetupScreen />));
    await consent();
    await press('Skip for now');
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(await loadProfile(db)).toBeNull();
  });
});

describe('redo and recalculate setup', () => {
  beforeEach(() => mockReplace.mockClear());
  const stored = () => ({
    ...buildProfile(
      { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
      new Date(2026, 8, 1),
    ),
    cleared: '2026-09-02',
  });

  it('recalculate opens on the results, and saving keeps created and cleared', async () => {
    const db = memoryDb();
    const before = stored();
    await saveProfile(db, before);
    await saveConsent(db, { id: 'c1', version: 0, updated_at: '2026-09-01T00:00:00Z', deleted_at: null, kind: 'data_storage', given_at: '2026-09-01T00:00:00Z', text_version: 'x' });
    await render(withProfile(db, <SetupScreen recalc />));
    expect(await screen.findByLabelText('1,990 kcal')).toBeTruthy();
    await press('Use these targets');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(await loadProfile(db)).toMatchObject({ created: before.created, cleared: '2026-09-02', targets: before.targets });
  });

  it('redo starts at the first question with the stored answers filled in', async () => {
    const db = memoryDb();
    await saveProfile(db, stored());
    await saveConsent(db, { id: 'c1', version: 0, updated_at: '2026-09-01T00:00:00Z', deleted_at: null, kind: 'data_storage', given_at: '2026-09-01T00:00:00Z', text_version: 'x' });
    await render(withProfile(db, <SetupScreen />));
    await screen.findByText('Let’s work out your targets');
    expect(screen.getByLabelText('Age').props.value).toBe('30');
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('82');
    await press('Continue');
    expect(screen.queryByText('Choose male or female for the calorie formula.')).toBeNull();
  });

  it('a redo offers Cancel, which goes back, instead of Skip for now', async () => {
    mockBack.mockClear();
    const db = memoryDb();
    await saveProfile(db, stored());
    await saveConsent(db, { id: 'c1', version: 0, updated_at: '2026-09-01T00:00:00Z', deleted_at: null, kind: 'data_storage', given_at: '2026-09-01T00:00:00Z', text_version: 'x' });
    await render(withProfile(db, <SetupScreen />));
    await screen.findByText('Let’s work out your targets');
    expect(screen.queryByLabelText('Skip for now')).toBeNull();
    await press('Cancel');
    expect(mockBack).toHaveBeenCalled();
  });

  it('Cancel with no history (reload, deep link) goes to targets', async () => {
    mockBack.mockClear();
    mockReplace.mockClear();
    mockCanGoBack = false;
    const db = memoryDb();
    await saveProfile(db, stored());
    await saveConsent(db, { id: 'c1', version: 0, updated_at: '2026-09-01T00:00:00Z', deleted_at: null, kind: 'data_storage', given_at: '2026-09-01T00:00:00Z', text_version: 'x' });
    await render(withProfile(db, <SetupScreen />));
    await screen.findByText('Let’s work out your targets');
    await press('Cancel');
    mockCanGoBack = true;
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/targets');
  });
});

// A stand-in for the mounted Food tab: shows what the Food tab would toast.
let refocus: () => void = () => undefined;
function ToastProbe() {
  const [m, setM] = useState('');
  const [n, setN] = useState(0);
  refocus = () => setN((x) => x + 1); // the focus effect runs again when the callback changes
  usePendingToast(useCallback((x: string) => setM(x), [n])); // eslint-disable-line react-hooks/exhaustive-deps
  return <Text>{m ? `toast: ${m}` : 'no toast'}</Text>;
}

describe('setup results: keep, first weigh-in, toast, progress, why', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    resetPendingToast();
  });
  const answers = { ...emptyDraft(), sex: 'male' as const, age: '30', unit: 'cm' as const, cm: '165', weight: '82', activity: 'sitting' as const, where: 'gym' as const, days: 6 as const, exp: 'some' as const, minutes: 60 as const, goal: 'lose' as const, pace: 'moderate' as const, screen: ['no', 'no', 'no', 'no', 'no', 'no'] as const };
  const edited = { kcal: 2500, protein_g: 150, carbs_g: 260, fat_g: 70 };
  async function redo(opts: { weights?: boolean } = {}) {
    const db = memoryDb();
    await saveProfile(db, { ...buildProfile({ ...answers, screen: [...answers.screen] }, new Date(2026, 8, 1)), targets: edited });
    await saveConsent(db, { id: 'c1', version: 0, updated_at: '2026-09-01T00:00:00Z', deleted_at: null, kind: 'data_storage', given_at: '2026-09-01T00:00:00Z', text_version: 'x' });
    if (opts.weights) await saveWeight(db, { id: null, version: 0, updated_at: '2026-09-02T00:00:00Z', deleted_at: null, date: '2026-09-02', weight_kg: 79 });
    await render(withProfile(db, <><ToastProbe /><SetupScreen recalc /></>));
    await screen.findByLabelText('Use these targets');
    return db;
  }

  it('Use these targets replaces edited targets, goes to Food and toasts "Targets updated"', async () => {
    const db = await redo();
    await press('Use these targets');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    await act(async () => refocus()); // the Food tab coming into focus
    expect(await screen.findByText('toast: Targets updated')).toBeTruthy();
    expect((await loadProfile(db))!.targets).toEqual({ kcal: g.output.kcal, protein_g: g.output.protein, carbs_g: g.output.carbs, fat_g: g.output.fat });
  });

  it('Keep my current targets keeps the four edited targets, saves the other answers and toasts', async () => {
    const db = await redo();
    await press('Keep my current targets');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    await act(async () => refocus()); // the Food tab coming into focus
    expect(await screen.findByText('toast: Setup saved, targets unchanged')).toBeTruthy();
    const p = (await loadProfile(db))!;
    expect(p.targets).toEqual(edited);
    expect(p).toMatchObject({ weight_kg: 82, created: '2026-09-01', goal: 'lose' });
  });

  it('shows Keep only when a profile already exists', async () => {
    await render(withProfile(memoryDb(), <SetupScreen recalc />));
    expect(screen.queryByLabelText('Keep my current targets')).toBeNull();
  });

  it('writes the setup weight as today\'s weigh-in when there is none', async () => {
    const db = await redo();
    await press('Use these targets');
    await waitFor(async () => expect(await loadWeights(db)).toHaveLength(1));
    expect((await loadWeights(db))[0]).toMatchObject({ date: localDate(new Date()), weight_kg: 82, deleted_at: null, id: null });
  });

  it('does not write a weigh-in when one exists', async () => {
    const db = await redo({ weights: true });
    await press('Keep my current targets');
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect((await loadWeights(db)).map((w) => w.date)).toEqual(['2026-09-02']);
  });

  it('writes the setup weigh-in at the version of a synced tombstone for today', async () => {
    const db = await redo();
    const today = localDate(new Date());
    await saveWeight(db, { id: null, version: 3, updated_at: '2026-09-02T00:00:00Z', deleted_at: '2026-09-02T00:00:00Z', date: today, weight_kg: 79 });
    await press('Use these targets');
    await waitFor(async () => expect((await loadWeights(db)).find((w) => w.date === today)?.deleted_at).toBeNull());
    expect((await loadWeights(db)).find((w) => w.date === today)).toMatchObject({ version: 3, weight_kg: 82 });
  });

  it('Why these numbers? opens the lines with the golden values', async () => {
    await redo();
    expect(screen.queryByText(/Mifflin-St Jeor/)).toBeNull();
    await press('Why these numbers?');
    // The redo form shows the stored 165 cm as 5 ft 5 in, which is 165.1 cm, so the screen's BMR is the golden 1,706 plus 0.6.
    expect(screen.getByText(/Resting, 1,707 kcal\./)).toBeTruthy();
    expect(screen.getByText(/Mifflin-St Jeor/)).toBeTruthy();
    expect(screen.getByText(/Calories, 1,990\./)).toBeTruthy();
    expect(screen.getByText(new RegExp(`Protein, ${g.output.protein} g\\.`))).toBeTruthy();
    expect(screen.getAllByText(/Moderate/)).toHaveLength(2);
    expect(screen.getByText(/Strong/)).toBeTruthy();
    expect(screen.getByText(/Rough estimate/)).toBeTruthy();
    expect(screen.getByText(/6 sessions of about 60 min/)).toBeTruthy();
    expect(screen.getByLabelText('Why these numbers?').props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByText(/per kg of a reference weight of \d+ kg/)).toBeTruthy(); // BMI 30.1
  });

  it('the resting line carries the golden BMR', () => {
    const p = buildProfile({ ...answers, screen: [...answers.screen] }, new Date(2026, 8, 1));
    expect(buildResults(p).why[0]!.head).toBe(`Resting, ${fmt(g.output.bmr)} kcal.`);
  });

  it('the protein line names the reference weight when BMI is above 30, and the no-training line reads as the prototype', () => {
    const light = buildProfile({ ...answers, screen: [...answers.screen], weight: '70', days: 0, exp: '', minutes: null }, new Date(2026, 8, 1));
    const lines = buildResults(light).why.map((l) => `${l.head} ${l.text}`);
    expect(lines.find((l) => l.startsWith('Protein'))).toMatch(/per kg of your bodyweight\./);
    expect(lines.find((l) => l.startsWith('Training'))).toContain('No regular training yet.');
  });

  it('progress bar steps 1 to 5 across the questions and results', async () => {
    await render(withProfile(memoryDb(), <SetupScreen />));
    await consent();
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 5, now: 1 });
    await press('Male');
    await fireEvent.changeText(screen.getByLabelText('Age'), '30');
    await press('Use cm');
    await fireEvent.changeText(screen.getByLabelText('Height in cm'), '165');
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '82');
    await press('Continue');
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(2);
  });

  it('the results step is the fifth', async () => {
    await redo();
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 0, max: 5, now: 5 });
  });
});
