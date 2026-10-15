import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { loadProfile, saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));

// 82 kg man, calcTargets: 1,990 kcal, protein 150, fat 55, carbs 224 (golden male-30-lose-moderate).
const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 9, 8),
  );

async function open() {
  const db = memoryDb();
  await saveProfile(db, profile());
  await render(withProfile(db, <TargetsScreen db={db} />));
  await screen.findByLabelText('Calories (kcal)');
  return db;
}

describe('editable daily targets', () => {
  it('saves a typed value on the profile at once, rounded and never below 0', async () => {
    const db = await open();
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '172.6');
    await waitFor(async () => expect((await loadProfile(db))?.targets.protein_g).toBe(173));
    await fireEvent.changeText(screen.getByLabelText('Fat (g)'), '-4');
    await waitFor(async () => expect((await loadProfile(db))?.targets.fat_g).toBe(0));
    expect((await loadProfile(db))?.targets.kcal).toBe(1990);
  });

  it('keeps two quick edits', async () => {
    const db = await open();
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '2100');
    await fireEvent.changeText(screen.getByLabelText('Carbs (g)'), '240');
    await waitFor(async () => {
      const t = (await loadProfile(db))?.targets;
      expect([t?.kcal, t?.carbs_g]).toEqual([2100, 240]);
    });
  });

  it('says what the macros add up to, and fits the carbs to the calories when 50 kcal or more off', async () => {
    const db = await open();
    expect(screen.getByText('Your macros add up to 1,991 kcal.')).toBeTruthy();
    expect(screen.queryByLabelText('Adjust carbs to match calories')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '2300');
    expect(await screen.findByText('Your macros add up to 1,991 kcal. That doesn’t match your calorie target.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Adjust carbs to match calories'));
    // (2300 - 150 * 4 - 55 * 9) / 4 = 301.25 -> 301
    await waitFor(async () => expect((await loadProfile(db))?.targets.carbs_g).toBe(301));
    expect(screen.getByLabelText('Carbs (g)').props.value).toBe('301');
    expect(screen.queryByLabelText('Adjust carbs to match calories')).toBeNull();
  });
});
