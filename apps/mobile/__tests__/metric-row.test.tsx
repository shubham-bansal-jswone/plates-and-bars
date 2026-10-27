import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MetricRow } from '../src/components/ui';
import { CheckinCard } from '../src/progress/CheckinCard';
import { BURN_HOW } from '../src/progress/copy';
import { ProfileProvider } from '../src/state/ProfileProvider';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import * as useThemeModule from '../src/theme/useTheme';
import { dark } from '../src/theme/tokens';
import { memoryDb } from './helpers';

beforeEach(() => jest.spyOn(useThemeModule, 'useTheme').mockReturnValue(dark));
afterEach(() => jest.restoreAllMocks());

const colour = (label: string) => {
  const cell = screen.getByLabelText(label);
  const text = (cell.children[0] as unknown as { props: { style?: unknown } });
  return (StyleSheet.flatten(text.props.style as never) as { color?: string }).color;
};

describe('MetricRow lime rule', () => {
  it('only a cell marked lime with a real, non-zero value is lime', async () => {
    await render(
      <MetricRow cells={[
        { value: '3', label: 'plain' },
        { value: '4', label: 'key', lime: true },
        { value: '0', label: 'zero', lime: true },
        { value: '–', label: 'none', lime: true },
      ]} />,
    );
    expect(colour('plain: 3')).not.toBe(dark.brand);
    expect(colour('key: 4')).toBe(dark.brand);
    expect(colour('zero: 0')).not.toBe(dark.brand);
    expect(colour('none: –')).not.toBe(dark.brand);
  });
});

describe('Weekly check-in: one lime number and the burn disclosure', () => {
  const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '175', weight: '80', activity: 'sitting', where: 'gym', days: 4, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
  const ci = {
    settingsFailed: false,
    checkin: { sessions: 2, plannedN: 4, logged: 3, avgK: 2000, avgP: 120, pDays: 2, w1: 80, weeklyChange: null, slopePerWeek: 0, cardioMin: 30, steps: null, sleep: null, sleepShort: false, improved: [], stalled: [], formula: null, burn: { ready: false, needDays: 2, needW: 1, logged: 0, burn: 0 }, suggestion: null },
    habit: { thisWeek: 2, goal: 3, logged: 3, weeks: 1, message: 'streak' },
  } as never;
  async function mount() {
    const db = memoryDb();
    await saveProfile(db, profile);
    await render(<ProfileProvider db={db}><CheckinCard date="2026-10-08" c={ci} /></ProfileProvider>);
    await screen.findByText('Weekly check-in');
  }

  it('the counters sit under Weekly check-in and exactly one number is lime', async () => {
    await mount();
    expect(screen.getByText('The 7 days up to 8 Oct')).toBeTruthy();
    expect(screen.queryByText('This week')).toBeNull();
    const lime = ['sessions: 2 / 4', 'days logged: 3 / 7', 'avg kcal (target 2,000): 2,000', 'sessions this week (aim 3+): 2'].filter((l) => {
      try { return colour(l) === dark.brand; } catch { return false; }
    });
    expect(lime).toEqual(['sessions: 2 / 4']);
  });

  it('How this works keeps its name, opens and closes, and carries the state', async () => {
    await mount();
    expect(screen.queryByText(BURN_HOW)).toBeNull();
    const d = () => screen.getByRole('button', { name: 'How this works' });
    expect(d().props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(d());
    expect(screen.getByText(BURN_HOW)).toBeTruthy();
    expect(d().props.accessibilityState).toMatchObject({ expanded: true });
    await fireEvent.press(d());
    expect(screen.queryByText(BURN_HOW)).toBeNull();
  });
});
