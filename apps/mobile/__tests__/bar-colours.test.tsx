import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { WaterCard } from '../src/food/WaterCard';
import { WeekCard } from '../src/progress/WeekCard';
import * as useThemeModule from '../src/theme/useTheme';
import { dark, light } from '../src/theme/tokens';

afterEach(() => jest.restoreAllMocks());

const bg = (el: { props: { style?: unknown } } | undefined) => (StyleSheet.flatten(el?.props.style as never) as { backgroundColor?: string } | undefined)?.backgroundColor;

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
});
