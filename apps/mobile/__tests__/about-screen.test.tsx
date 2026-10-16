import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import eatout from '../../../content/eatout.json';
import foods from '../../../content/foods.json';
import raw from '../../../content/raw-ingredients.json';
import { AboutScreen } from '../src/about/AboutScreen';
import { getFoodSources, mergeSources, sourceKey } from '../src/about/sources';

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

  it('says withdrawing consent means deleting the account', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText(/Withdrawing your consent means deleting your account/)).toBeTruthy();
  });

  it('shows both own_estimate names', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText(/own estimate for a typical restaurant portion/)).toBeTruthy();
    expect(screen.getByText(/generic mix or approximation/)).toBeTruthy();
  });

  it('opens the USDA link', async () => {
    // RN 0.88 types Linking.openURL as Promise<void>.
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<AboutScreen onBack={() => {}} />);
    await fireEvent.press(screen.getByRole('link', { name: 'Open https://fdc.nal.usda.gov/' }));
    expect(open).toHaveBeenCalledWith('https://fdc.nal.usda.gov/');
  });

  it('lists the bundled fonts and says there are no exercise photos', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getAllByText('Licence: SIL Open Font License 1.1')).toHaveLength(2);
    expect(screen.getByText(/shows no exercise photos/)).toBeTruthy();
  });

  it('credits the body map shapes under the MIT licence with the full notice', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.getByText('Body map shapes: react-body-highlighter')).toBeTruthy();
    expect(screen.getByText('Licence: MIT License, Copyright (c) 2020 GV79')).toBeTruthy();
    expect(screen.getByText(/Permission is hereby granted, free of charge/)).toBeTruthy();
    expect(screen.getByText(/THE SOFTWARE IS PROVIDED “AS IS”/)).toBeTruthy();
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

describe('mergeSources reference', () => {
  const row = (reference: string | null, name = 'USDA') => ({ code: 'usda_fdc', name, licence: 'CC0', url: null, reference });
  it('drops the reference when merged rows disagree', () => {
    expect(mergeSources([row('FDC 1'), row('FDC 2')])).toEqual([expect.objectContaining({ reference: null })]);
  });
  it('drops it when only some rows carry one, whichever comes first', () => {
    expect(mergeSources([row(null), row('FDC 2')])[0]!.reference).toBeNull();
    expect(mergeSources([row('FDC 2'), row(null)])[0]!.reference).toBeNull();
  });
  it('keeps a reference every row agrees on, and a single row\'s own', () => {
    expect(mergeSources([row('FDC 1'), row('FDC 1', 'USDA; values match corn')])[0]!.reference).toBe('FDC 1');
    expect(mergeSources([row('FDC 1')])[0]!.reference).toBe('FDC 1');
  });
});

describe('about sources with the real content', () => {
  it('the merged USDA entry carries no single food\'s reference (13 foods, 13 different references)', () => {
    const fdc = (foods as unknown as { foods: { source: S & { reference?: string | null } }[] }).foods.filter((f) => f.source.code === 'usda_fdc');
    expect(new Set(fdc.map((f) => f.source.reference)).size).toBeGreaterThan(1);
    expect(getFoodSources().find((s) => s.code === 'usda_fdc')!.reference).toBeNull();
  });
  it('merging only the foods rows (each with its own reference) leaves no reference, where keeping one row\'s would show a single food\'s', () => {
    const rows = (foods as unknown as { foods: { source: S & { url: string | null; licence: string; reference?: string | null } }[] }).foods.map((f) => f.source);
    const lastFdc = [...rows].reverse().find((s) => s.code === 'usda_fdc')!;
    expect(lastFdc.reference).toEqual(expect.stringMatching(/^FDC /));
    expect(mergeSources(rows).find((s) => s.code === 'usda_fdc')!.reference).toBeNull();
  });
  it('About shows no FDC reference line', async () => {
    await render(<AboutScreen onBack={() => {}} />);
    expect(screen.queryByText(/^Reference: FDC/)).toBeNull();
  });
});
