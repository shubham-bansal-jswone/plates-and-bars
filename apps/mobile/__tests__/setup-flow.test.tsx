import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import golden from '../../../docs/spec/golden/targets.json';
import { SetupScreen } from '../src/screens/SetupScreen';
import { loadConsent, loadProfile, saveConsent } from '../src/db/records';
import { SCREEN_Q } from '../src/setup/copy';
import { memoryDb, withProfile } from './helpers';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const g = golden.find((c) => c.input.id === 'male-30-lose-moderate')!;
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));

async function consent() {
  await screen.findByText('Before you start');
  await press('Continue');
  expect(screen.getByText('Tick the box to continue.')).toBeTruthy();
  await fireEvent(screen.getByLabelText('I understand and agree to my data being stored as described'), 'valueChange', true);
  await press('Continue');
}

describe('setup flow', () => {
  beforeEach(() => mockReplace.mockClear());

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
    for (const q of SCREEN_Q) await fireEvent.press(within(screen.getByLabelText(q)).getByLabelText('No'));
    await press('See my targets');

    expect(screen.getByLabelText("1,990 kcal")).toBeTruthy();
    expect(screen.getByLabelText(`${g.output.protein} g protein`)).toBeTruthy();
    expect(screen.getByLabelText(`${g.output.carbs} g carbs`)).toBeTruthy();
    expect(screen.getByLabelText(`${g.output.fat} g fat`)).toBeTruthy();
    expect(await loadProfile(db)).toBeNull();

    await press('Use these targets');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/targets'));
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
    expect(p!.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await loadConsent(db)).toMatchObject({ kind: 'data_storage', text_version: '2026-10-07', version: 0 });
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
    await press('At home, no equipment. Bodyweight, plus a backpack for rows');
    expect(screen.queryByLabelText('60 min')).toBeNull();
    await press('Continue');
    await press('Maintain. Keep weight steady and get stronger');
    for (const q of SCREEN_Q) await fireEvent.press(within(screen.getByLabelText(q)).getByLabelText('No'));
    await press('See my targets');
    expect(screen.getByText(/^For 60 and over/)).toBeTruthy();
    expect(screen.getByText(/^Home plan: bodyweight/)).toBeTruthy();
    await press('Use these targets');
    await waitFor(async () => expect(await loadProfile(db)).not.toBeNull());
    expect(await loadProfile(db)).toMatchObject({ days: 0, exp: null, minutes: null, special: 'breastfeeding', where: 'bodyweight' });
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
    await press('At a gym. Machines, cables, barbells and dumbbells');
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
