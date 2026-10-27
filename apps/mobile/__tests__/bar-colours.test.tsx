import { render, screen } from '@testing-library/react-native';
import { processColor, StyleSheet } from 'react-native';
import { WaterCard } from '../src/food/WaterCard';
import { Meter } from '../src/targets/sections';
import { RestBar } from '../src/workout/parts';
import { WeekCard } from '../src/progress/WeekCard';
import * as useThemeModule from '../src/theme/useTheme';
import { dark, light } from '../src/theme/tokens';

afterEach(() => jest.restoreAllMocks());

const bg = (el: { props: { style?: unknown } } | undefined) => (StyleSheet.flatten(el?.props.style as never) as { backgroundColor?: string } | undefined)?.backgroundColor;

// In light mode `bar` equals `brand` (#2457E6), so only the dark cases catch a revert to `c.brand`.
// #504: goal bars fill with `bar`, not `brand`, because dark `brand` is 2.4:1 on `track` (DESIGN.md 11.1 asks 3:1).
describe.each([['light', light], ['dark', dark]] as const)('goal bars in %s', (_m, p) => {
  beforeEach(() => jest.spyOn(useThemeModule, 'useTheme').mockReturnValue(p));

  it('draws the water fill in the bar colour', async () => {
    await render(<WaterCard ml={1000} count={1} target={{ ml: 2000, trained: false }} sizes={{ glass_ml: 250, bottle_ml: 500 }} profile={null} onAdd={() => {}} onUndo={() => {}} />);
    const fill = screen.getByRole('progressbar').children[0] as unknown as { props: { style?: unknown } };
    expect(bg(fill)).toBe(p.bar);
  });

  it('draws the Seven-days fill in the bar colour', async () => {
    const day = { date: '2026-10-01', logs: [{ name: 'Rice', qty: 1, kcal: 1500, protein_g: 80, carbs_g: 100, fat_g: 40 }], trained: false };
    await render(<WeekCard date="2026-10-01" days={[day]} kcalTarget={2000} />);
    const bar = screen.getByLabelText(/kcal, .* g protein/);
    const fill = (bar as unknown as { children: { props: { style?: unknown } }[] }).children[0];
    expect(bg(fill)).toBe(p.bar);
  });

  it('draws the set-volume fill in the bar colour', async () => {
    await render(<Meter title="Done in the last 7 days" rows={[{ muscle: 'chest', sets: 10, shown: 10, low: false, barPct: 80 }]} />);
    const fill = (screen.getByLabelText('Done in the last 7 days, Chest: 10 sets') as unknown as { children: { children: { props: { style?: unknown } }[] }[] }).children[1]!.children[0];
    expect(bg(fill)).toBe(p.bar);
  });

  it('draws the rest-timer ring in the brand colour', async () => {
    await render(<RestBar rest={{ id: 1, end: Date.now() + 60000, total: 90, label: 'Bench' }} onAdd={() => {}} onSkip={() => {}} />);
    expect(screen.getByTestId('ring-progress').props.stroke.payload).toBe(processColor(p.brand));
  });
});
