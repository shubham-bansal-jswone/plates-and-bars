import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import eatout from '../../../content/eatout.json';
import foods from '../../../content/foods.json';
import raw from '../../../content/raw-ingredients.json';
import { AboutScreen } from '../src/about/AboutScreen';
import { getFoodSources, sourceKey } from '../src/about/sources';

type S = { code: string; name: string };

describe('about and sources', () => {
  it('lists USDA FoodData Central with its recorded licence and link', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText('USDA FoodData Central (SR Legacy)')).toBeTruthy();
    expect(screen.getByText('Licence: Public domain (CC0 1.0)')).toBeTruthy();
    expect(screen.getByText('https://fdc.nal.usda.gov/')).toBeTruthy();
  });

  it('lists every distinct source recorded in foods, eatout and raw-ingredients, each with a licence', async () => {
    const listed = getFoodSources().map(sourceKey);
    const fromFiles = [
      ...(foods as unknown as { foods: { source: S }[] }).foods.map((f) => f.source),
      ...(eatout as unknown as { cuisines: { dishes: { source: S }[] }[] }).cuisines.flatMap((c) => c.dishes.map((d) => d.source)),
      ...(raw as unknown as { ingredients: { source: S }[] }).ingredients.map((i) => i.source),
    ];
    for (const s of fromFiles) expect(listed).toContain(sourceKey(s));
    expect(new Set(listed).size).toBe(listed.length);
    for (const s of getFoodSources()) expect(s.licence).not.toBe('');
  });

  it('every content file contributes: eatout and raw-ingredients each have a source in the list', () => {
    const eo = (eatout as unknown as { cuisines: { dishes: { source: S }[] }[] }).cuisines[0]!.dishes[0]!.source;
    const rw = (raw as unknown as { ingredients: { source: S }[] }).ingredients.find((i) => i.source.code === 'own_estimate')!.source;
    expect(getFoodSources().map(sourceKey)).toEqual(expect.arrayContaining([sourceKey(eo), sourceKey(rw)]));
  });

  it('shows both own_estimate names', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText(/own estimate for a typical restaurant portion/)).toBeTruthy();
    expect(screen.getByText(/generic mix or approximation/)).toBeTruthy();
  });

  it('opens the USDA link', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<AboutScreen onBack={() => {}} />);
    await fireEvent.press(screen.getByRole('link', { name: 'Open https://fdc.nal.usda.gov/' }));
    expect(open).toHaveBeenCalledWith('https://fdc.nal.usda.gov/');
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
