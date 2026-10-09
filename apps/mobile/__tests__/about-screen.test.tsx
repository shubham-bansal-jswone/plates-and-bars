import { fireEvent, render, screen } from '@testing-library/react-native';
import foods from '../../../content/foods.json';
import { AboutScreen } from '../src/about/AboutScreen';
import { FOOD_SOURCES } from '../src/about/sources';

describe('about and sources', () => {
  it('lists USDA FoodData Central with its recorded licence and link', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText('USDA FoodData Central (SR Legacy)')).toBeTruthy();
    expect(screen.getByText('Licence: Public domain (CC0 1.0)')).toBeTruthy();
    expect(screen.getByText('https://fdc.nal.usda.gov/')).toBeTruthy();
  });

  it('lists every source code used by a food row, once each, with a licence', async () => {
    const used = new Set((foods as unknown as { foods: { source: { code: string } }[] }).foods.map((f) => f.source.code));
    const listed = FOOD_SOURCES.map((s) => s.code);
    for (const code of used) expect(listed).toContain(code);
    expect(new Set(listed).size).toBe(listed.length);
    for (const s of FOOD_SOURCES) expect(s.licence).not.toBe('');
  });

  it('lists the bundled fonts and says there are no exercise photos', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getAllByText('Licence: SIL Open Font License 1.1')).toHaveLength(2);
    expect(screen.getByText(/shows no exercise photos/)).toBeTruthy();
  });

  it('never names the excluded Indian tables', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/IFCT|INDB/i);
  });

  it('goes back', async () => {
    const onBack = jest.fn();
    await render(<AboutScreen onBack={onBack} />);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalled();
  });
});
