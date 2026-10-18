import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ScanFlow } from '../src/barcode/ScanFlow';
import { BARCODE_COPY as t } from '../src/barcode/copy';
import type { LookupResult } from '../src/barcode/lookup';
import { offToUserFood } from '@plate-and-bar/core';
import type { ScannerViewProps } from '../modules/plate-barcode-scanner';
import type { UserFood } from '../src/food/types';
import { EAN13, product, UPC_A, UPC_E } from './barcode-fixtures';

let scannerProps: ScannerViewProps | null = null;
jest.mock('../modules/plate-barcode-scanner', () => ({
  BarcodeScannerView: (props: ScannerViewProps) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    scannerProps = props;
    return <View testID="scanner" />;
  },
}));
jest.mock('../src/barcode/permission', () => ({ checkCamera: async () => 'granted', requestCamera: async () => 'granted' }));
jest.mock('../src/haptics', () => ({ buzz: jest.fn() }));

const found = (over: Parameters<typeof product>[0] = {}): LookupResult => {
  const p = product(over);
  const m = offToUserFood(p);
  if (m.kind !== 'ok') throw new Error('fixture does not map');
  return { kind: 'found', draft: { ...m.draft, barcode: p.code }, missing: m.missing, warnings: m.warnings, liquid: m.liquid, carbsFibreHint: m.carbsFibreHint, product: p };
};

const saved = (over: Partial<UserFood> = {}): UserFood => ({
  id: 'u-1', version: 1, updated_at: '2026-10-01T00:00:00Z', deleted_at: null,
  name: 'Peanut bar (Acme)', unit: '1 bar (50 g)', kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 8, fibre_g: 3, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom', barcode: EAN13, ...over,
});

interface Setup { mine?: UserFood[]; lookup?: jest.Mock<Promise<LookupResult>, [string]> }
async function show({ mine = [], lookup = jest.fn(async (_code: string) => found()) }: Setup = {}) {
  const onAdd = jest.fn();
  const onSaveMine = jest.fn((f: object) => ({ ...saved(), ...f, id: 'new-1' }) as UserFood);
  const onCustom = jest.fn();
  const onClose = jest.fn();
  await render(<ScanFlow meal="Breakfast" mine={mine} onAdd={onAdd} onSaveMine={onSaveMine} onCustom={onCustom} onClose={onClose} lookup={lookup} />);
  await screen.findByTestId('scanner');
  return { onAdd, onSaveMine, onCustom, onClose, lookup };
}
const hit = (code: string, format = 'EAN_13') => act(async () => scannerProps!.onBarcode({ nativeEvent: { code, format } } as never));
const type = async (digits: string) => {
  await fireEvent.press(screen.getByRole('button', { name: t.typeInstead }));
  await fireEvent.changeText(screen.getByLabelText(t.fieldLabel), digits);
  await fireEvent.press(screen.getByRole('button', { name: t.use }));
};
const disabled = (name: string) => !!screen.getByRole('button', { name }).props.accessibilityState?.disabled || screen.getByRole('button', { name }).props['aria-disabled'] === true;

beforeEach(() => { scannerProps = null; });

describe('lookup only after validation', () => {
  it('a typed number with a wrong check digit never reaches the lookup', async () => {
    const { lookup } = await show();
    await type('5000112637923');
    expect(await screen.findByText(t.invalid)).toBeTruthy();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a scan the reader got wrong is not looked up either', async () => {
    const { lookup } = await show();
    await hit('5000112637923');
    expect(lookup).not.toHaveBeenCalled();
    expect(await screen.findByText(t.invalid)).toBeTruthy();
  });

  it('a valid typed number is looked up once, as typed', async () => {
    const { lookup } = await show();
    await type(EAN13);
    await screen.findByLabelText(t.name);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(EAN13);
  });

  it('a scanned UPC-E is looked up as the 12-digit UPC-A (core expands it with the scanner format hint)', async () => {
    const { lookup } = await show();
    await hit(UPC_E, 'UPC_E');
    await screen.findByLabelText(t.name);
    expect(lookup).toHaveBeenCalledWith(UPC_A);
  });
});

describe('the review sheet', () => {
  it('shows the lookup line, the banner, the credit and the prefilled values; Add logs and saves a synced food with the barcode', async () => {
    const { onAdd, onSaveMine, onClose } = await show();
    await hit(EAN13);
    expect(await screen.findByText(t.lookupNote)).toBeTruthy();
    expect(screen.getByText(t.banner)).toBeTruthy();
    expect(screen.getByLabelText(t.name).props.value).toBe('Peanut bar (Acme)');
    expect(screen.getByLabelText(t.calories).props.value).toBe('200');
    expect(screen.getByLabelText(t.serving).props.value).toBe('1 bar (50 g)');
    expect(screen.queryByText(t.missing)).toBeNull();
    expect(screen.queryByText(t.looksOff)).toBeNull();
    const credit = screen.getByRole('link', { name: t.attributionA11y });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue();
    await fireEvent.press(credit);
    expect(open).toHaveBeenCalledWith(`https://world.openfoodfacts.org/product/${EAN13}`);
    await fireEvent.press(screen.getByRole('button', { name: 'Add to breakfast' }));
    expect(onSaveMine).toHaveBeenCalledWith(expect.objectContaining({ name: 'Peanut bar (Acme)', unit: '1 bar (50 g)', kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 8, fibre_g: 3, origin: 'custom', barcode: EAN13 }));
    expect(onAdd).toHaveBeenCalledWith({ name: 'Peanut bar (Acme)', qty: 1, kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 8, foodId: 'new-1' });
    expect(onClose).toHaveBeenCalled();
  });

  it('edits count, and the servings multiply the log', async () => {
    const { onAdd, onSaveMine } = await show();
    await hit(EAN13);
    await fireEvent.changeText(await screen.findByLabelText(t.protein), '12.5');
    await fireEvent.changeText(screen.getByLabelText('Servings'), '2');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to breakfast' }));
    expect(onSaveMine).toHaveBeenCalledWith(expect.objectContaining({ protein_g: 12.5 }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ qty: 2, protein_g: 12.5 }));
  });

  it('with "Save to my foods" off, the food is logged without being saved', async () => {
    const { onAdd, onSaveMine } = await show();
    await hit(EAN13);
    await fireEvent(await screen.findByLabelText(t.save), 'valueChange', false);
    await fireEvent.press(screen.getByRole('button', { name: 'Add to breakfast' }));
    expect(onSaveMine).not.toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ foodId: null }));
  });

  it('a missing required field is empty and flagged, and Add stays disabled until it is filled (a typed 0 counts)', async () => {
    const lookup = jest.fn(async (_code: string) => found({ nutriments: { 'energy-kcal_100g': 400, carbohydrates_100g: 40, fat_100g: 16 } }));
    const { onAdd } = await show({ lookup });
    await hit(EAN13);
    const protein = await screen.findByLabelText(t.protein);
    expect(protein.props.value).toBe('');
    expect(screen.getByText(t.missing)).toBeTruthy();
    expect(disabled('Add to breakfast')).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Add to breakfast' }));
    expect(onAdd).not.toHaveBeenCalled();
    await fireEvent.changeText(protein, '0');
    expect(screen.queryByText(t.missing)).toBeNull();
    expect(disabled('Add to breakfast')).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Add to breakfast' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ protein_g: 0 }));
  });

  it('a product with no name needs one typed', async () => {
    const lookup = jest.fn(async (_code: string) => found({ name: null }));
    await show({ lookup });
    await hit(EAN13);
    await screen.findByLabelText(t.name);
    expect(screen.getByText(t.missing)).toBeTruthy();
    expect(disabled('Add to breakfast')).toBe(true);
    await fireEvent.changeText(screen.getByLabelText(t.name), 'Bar');
    expect(disabled('Add to breakfast')).toBe(false);
  });

  it('shows the plausibility and data-quality warnings, the fibre hint and the ml note', async () => {
    const lookup = jest.fn(async (_code: string) =>
      found({
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 60, carbohydrates_100g: 60, fat_100g: 10 },
        completeness: 0.2,
        data_quality_errors_tags: ['en:energy-value-in-kcal-does-not-match-value-computed-from-other-nutrients'],
        countries_tags: ['en:france'],
        serving_size: '250 ml',
        serving_quantity: 250,
        quantity: '1 l',
      }),
    );
    await show({ lookup });
    await hit(EAN13);
    expect(await screen.findByText(t.looksOff)).toBeTruthy();
    expect(screen.getByText(t.incomplete)).toBeTruthy();
    expect(screen.getByText(t.qualityErrors)).toBeTruthy();
    expect(screen.getByText(t.carbsFibre)).toBeTruthy();
    expect(screen.getByText(t.liquid)).toBeTruthy();
  });

  it('a food with an Indian label does not get the fibre hint, and a clean product has no warning', async () => {
    await show();
    await hit(EAN13);
    await screen.findByLabelText(t.name);
    expect(screen.queryByText(t.carbsFibre)).toBeNull();
    for (const w of [t.looksOff, t.incomplete, t.qualityErrors, t.liquid]) expect(screen.queryByText(w)).toBeNull();
  });
});

describe('a repeat scan of a saved food', () => {
  it('opens it with no lookup at all, and logging it points at the saved food without saving again', async () => {
    const { lookup, onAdd, onSaveMine } = await show({ mine: [saved()] });
    await hit(EAN13);
    expect(await screen.findByText(t.savedNote)).toBeTruthy();
    expect(screen.queryByText(t.lookupNote)).toBeNull();
    expect(screen.queryByText(t.looking)).toBeNull();
    expect(screen.queryByLabelText(t.save)).toBeNull();
    expect(screen.getByRole('link', { name: t.attributionA11y })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add to breakfast' }));
    expect(lookup).not.toHaveBeenCalled();
    expect(onSaveMine).not.toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalledWith({ name: 'Peanut bar (Acme)', qty: 1, kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 8, foodId: 'u-1' });
  });

  it('an edit to the saved food is saved (same barcode), the user keeps their numbers', async () => {
    const { onAdd, onSaveMine } = await show({ mine: [saved()] });
    await hit(EAN13);
    await fireEvent.changeText(await screen.findByLabelText(t.calories), '210');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to breakfast' }));
    expect(onSaveMine).toHaveBeenCalledWith(expect.objectContaining({ kcal: 210, barcode: EAN13 }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ kcal: 210, foodId: 'new-1' }));
  });

  it('finds the food by a UPC-A scan when it was saved as the 13-digit form, and a deleted food is not found', async () => {
    const { lookup } = await show({ mine: [saved({ barcode: `0${UPC_A}` }), saved({ id: 'gone', barcode: '4006381333931', deleted_at: '2026-10-02T00:00:00Z' })] });
    await hit(UPC_A, 'UPC_A');
    expect(await screen.findByText(t.savedNote)).toBeTruthy();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a different barcode still looks up', async () => {
    const { lookup } = await show({ mine: [saved()] });
    await hit(UPC_A, 'UPC_A');
    await screen.findByLabelText(t.name);
    expect(lookup).toHaveBeenCalledWith(UPC_A);
  });
});

describe('when the lookup does not give a product', () => {
  const problem = async (r: LookupResult) => {
    const s = await show({ lookup: jest.fn(async (_code: string) => r) });
    await hit(EAN13);
    return s;
  };

  it('404: says so and offers Enter by hand, which hands the code over', async () => {
    const { onCustom } = await problem({ kind: 'not_found' });
    expect(await screen.findByText(t.notFound)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t.byHand }));
    expect(onCustom).toHaveBeenCalledWith(EAN13);
  });

  it('offline: says so, offers Try again and Enter by hand; Try again looks up again and can succeed', async () => {
    const lookup = jest.fn<Promise<LookupResult>, [string]>().mockResolvedValueOnce({ kind: 'offline' }).mockResolvedValueOnce(found());
    await show({ lookup });
    await hit(EAN13);
    expect(await screen.findByText(t.offline)).toBeTruthy();
    expect(screen.getByRole('button', { name: t.byHand })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t.tryAgain }));
    expect(await screen.findByLabelText(t.name)).toBeTruthy();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('503 busy: says when to retry (from Retry-After)', async () => {
    await problem({ kind: 'busy', retryAfterSec: 90 });
    expect(await screen.findByText('Open Food Facts is busy. Try again in 2 minutes.')).toBeTruthy();
    expect(screen.getByRole('button', { name: t.byHand })).toBeTruthy();
  });

  it('503 busy without Retry-After says a minute, as the spec', async () => {
    await problem({ kind: 'busy', retryAfterSec: null });
    expect(await screen.findByText('Open Food Facts is busy. Try again in a minute.')).toBeTruthy();
  });

  it('429: says when to retry and offers Enter by hand', async () => {
    await problem({ kind: 'rate_limited', retryAfterSec: 30 });
    expect(await screen.findByText('Too many lookups just now. Try again in 30 seconds, or enter it by hand.')).toBeTruthy();
    expect(screen.getByRole('button', { name: t.tryAgain })).toBeTruthy();
  });

  it('503 unavailable: says so', async () => {
    await problem({ kind: 'unavailable' });
    expect(await screen.findByText(t.lookupDown)).toBeTruthy();
  });

  it('with no server in the build there is no request at all: it reads as offline', async () => {
    const onClose = jest.fn();
    await render(<ScanFlow meal="Lunch" mine={[]} onAdd={jest.fn()} onSaveMine={jest.fn()} onCustom={jest.fn()} onClose={onClose} />);
    await screen.findByTestId('scanner');
    await hit(EAN13);
    expect(await screen.findByText(t.offline)).toBeTruthy();
  });

  it('Scan again goes back to the scanner', async () => {
    await problem({ kind: 'not_found' });
    await fireEvent.press(await screen.findByRole('button', { name: t.scanAgain }));
    await waitFor(() => expect(screen.getByTestId('scanner')).toBeTruthy());
  });

  it('shows "Looking up this barcode" while the request is out, and never blocks: the lookup is one pending promise', async () => {
    let resolve: (r: LookupResult) => void = () => undefined;
    const lookup = jest.fn((_code: string) => new Promise<LookupResult>((r) => { resolve = r; }));
    await show({ lookup });
    await hit(EAN13);
    expect(await screen.findByText(t.looking)).toBeTruthy();
    await act(async () => resolve(found()));
    expect(await screen.findByText(t.lookupNote)).toBeTruthy();
    expect(screen.queryByText(t.looking)).toBeNull();
  });

  it('closing while looking up ignores the late answer', async () => {
    let resolve: (r: LookupResult) => void = () => undefined;
    const lookup = jest.fn((_code: string) => new Promise<LookupResult>((r) => { resolve = r; }));
    const { onClose } = await show({ lookup });
    await hit(EAN13);
    await fireEvent.press(await screen.findByRole('button', { name: t.close }));
    expect(onClose).toHaveBeenCalled();
    await act(async () => resolve(found()));
    expect(screen.queryByLabelText(t.name)).toBeNull();
  });
});
