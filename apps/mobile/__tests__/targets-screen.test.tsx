import { render, screen } from '@testing-library/react-native';
import golden from '../../../docs/spec/golden/targets.json';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';


jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }) }));

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
    await render(withProfile(db, <TargetsScreen />));
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
    await render(withProfile(db, <TargetsScreen />));
    expect(await screen.findByText('Check with your doctor first')).toBeTruthy();
    expect(screen.getByLabelText('My doctor has cleared me')).toBeTruthy();
    expect(screen.getByText(/^Home plan: bodyweight/)).toBeTruthy();
  });
});
