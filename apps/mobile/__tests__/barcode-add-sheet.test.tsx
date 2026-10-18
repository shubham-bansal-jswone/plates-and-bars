import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { BARCODE_COPY as t } from '../src/barcode/copy';
import type { ScannerViewProps } from '../modules/plate-barcode-scanner';
import { memoryDb, withProfile } from './helpers';
import { EAN13, json, product, UPC_A } from './barcode-fixtures';

// Scan barcode on the Food list tab, end to end through the real flow, the real client over a stubbed fetch, and the record store.
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
jest.mock('../src/sync/auth', () => ({ ...jest.requireActual('../src/sync/auth'), API_URL: 'http://api.test/api/v1' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const fetchMock = jest.fn<Promise<Response>, [Request]>();
const realFetch = globalThis.fetch;
const realFlag = process.env.EXPO_PUBLIC_BARCODE_SCAN;
beforeEach(() => {
  scannerProps = null;
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  process.env.EXPO_PUBLIC_BARCODE_SCAN = '1';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realFlag === undefined) delete process.env.EXPO_PUBLIC_BARCODE_SCAN;
  else process.env.EXPO_PUBLIC_BARCODE_SCAN = realFlag;
});

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
type Db = ReturnType<typeof memoryDb>;
async function setup() {
  const db = memoryDb();
  await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1)));
  await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Food' });
  return db;
}
const docs = (db: Db, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v));
const open = async () => {
  await fireEvent.press(screen.getByLabelText('+ Add to breakfast'));
  await screen.findByLabelText('Search foods');
};
const hit = (code: string, format = 'EAN_13') => act(async () => scannerProps!.onBarcode({ nativeEvent: { code, format } } as never));

/** One scan from the Add sheet to the saved food; the lookup answers `p`. */
async function scanAndAdd(code: string, format = 'EAN_13') {
  await open();
  await fireEvent.press(screen.getByLabelText(t.scanButtonA11y));
  await screen.findByTestId('scanner');
  await hit(code, format);
}

describe('Scan barcode on the Add sheet (behind EXPO_PUBLIC_BARCODE_SCAN)', () => {
  it('is off by default: no button, and the tabs are the same', async () => {
    delete process.env.EXPO_PUBLIC_BARCODE_SCAN;
    await setup();
    await open();
    expect(screen.queryByLabelText(t.scanButtonA11y)).toBeNull();
    expect(screen.getAllByRole('tab').map((x) => x.props.accessibilityLabel)).toEqual(['Food list', 'Eating out', 'Custom']);
  });

  it('on: a button beside the search field, no fifth tab, and it opens the scanner', async () => {
    await setup();
    await open();
    expect(screen.getAllByRole('tab')).toHaveLength(3); // plus Describe when AI is on: four, as before
    await fireEvent.press(screen.getByLabelText(t.scanButtonA11y));
    expect(await screen.findByTestId('scanner')).toBeTruthy();
  });

  it('scan, lookup, review, Add: logs the food and saves a synced user food with the barcode; the repeat scan makes no request', async () => {
    fetchMock.mockResolvedValue(json(200, product()));
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.scanButtonA11y));
    await screen.findByTestId('scanner');
    await hit(EAN13);
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to breakfast' }));
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0].url).toBe(`http://api.test/api/v1/foods/barcode/${EAN13}`);
    const foods = docs(db, 'user_foods');
    expect(foods).toHaveLength(1);
    expect(foods[0]).toMatchObject({ name: 'Peanut bar (Acme)', unit: '1 bar (50 g)', kcal: 200, protein_g: 10, origin: 'custom', barcode: EAN13, deleted_at: null });
    expect(docs(db, 'food_logs')[0]).toMatchObject({ food_id: foods[0].id, name: 'Peanut bar (Acme)', meal: 'Breakfast', kcal: 200 });

    // again: the saved food is found on the device. No second request.
    await waitFor(() => expect(screen.queryByLabelText('Search foods')).toBeNull());
    await open();
    expect(screen.getByRole('link', { name: t.attributionA11y })).toBeTruthy(); // the saved row carries the Open Food Facts credit
    await fireEvent.press(screen.getByLabelText(t.scanButtonA11y));
    await screen.findByTestId('scanner');
    await hit(EAN13);
    expect(await screen.findByText(t.savedNote)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Add to breakfast' }));
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(2));
    expect(docs(db, 'user_foods')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renaming a scanned food on a repeat scan updates the same saved food (same id, same barcode), not a second one', async () => {
    fetchMock.mockResolvedValue(json(200, product()));
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.scanButtonA11y));
    await screen.findByTestId('scanner');
    await hit(EAN13);
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to breakfast' }));
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
    const id = docs(db, 'user_foods')[0].id;
    await waitFor(() => expect(screen.queryByLabelText('Search foods')).toBeNull());
    await open();
    await fireEvent.press(screen.getByLabelText(t.scanButtonA11y));
    await screen.findByTestId('scanner');
    await hit(EAN13);
    await fireEvent.changeText(await screen.findByLabelText(t.name), 'My protein bar');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to breakfast' }));
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(2));
    const foods = docs(db, 'user_foods');
    expect(foods).toHaveLength(1);
    expect(foods[0]).toMatchObject({ id, name: 'My protein bar', barcode: EAN13, deleted_at: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Close on the scanner returns to the Food list with the sheet still open', async () => {
    await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.scanButtonA11y));
    await screen.findByTestId('scanner');
    await fireEvent.press(screen.getByRole('button', { name: t.close }));
    await waitFor(() => expect(screen.queryByTestId('scanner')).toBeNull());
    expect(screen.getByLabelText('Search foods')).toBeTruthy();
  });

  it('the code from Enter by hand is not carried to a later Custom food after the tab changes', async () => {
    fetchMock.mockResolvedValue(json(404, { code: 'not_found', message: 'x' }));
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.scanButtonA11y));
    await screen.findByTestId('scanner');
    await hit(EAN13);
    await fireEvent.press(await screen.findByRole('button', { name: t.byHand }));
    expect(await screen.findByText(`${t.customCode} ${EAN13}`)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Food list'));
    await fireEvent.press(screen.getByLabelText('Custom'));
    expect(screen.queryByText(`${t.customCode} ${EAN13}`)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Food'), 'Thali');
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '500');
    await fireEvent.press(screen.getByLabelText('Add to breakfast'));
    await waitFor(() => expect(docs(db, 'user_foods')).toHaveLength(1));
    expect(docs(db, 'user_foods')[0].barcode).toBeUndefined();
  });

  it('404: Enter by hand opens Custom with the code, which is saved with the food', async () => {
    fetchMock.mockResolvedValue(json(404, { code: 'not_found', message: 'x' }));
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.scanButtonA11y));
    await screen.findByTestId('scanner');
    await hit(EAN13);
    expect(await screen.findByText(t.notFound)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t.byHand }));
    expect(await screen.findByText(`${t.customCode} ${EAN13}`)).toBeTruthy();
    expect(screen.queryByTestId('scanner')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Food'), 'Neighbour shop bar');
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '250');
    await fireEvent.press(screen.getByLabelText('Add to breakfast'));
    await waitFor(() => expect(docs(db, 'user_foods')).toHaveLength(1));
    expect(docs(db, 'user_foods')[0]).toMatchObject({ name: 'Neighbour shop bar', barcode: EAN13 });
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
  });

  it('offline: says so and Enter by hand is offered; nothing is logged', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.scanButtonA11y));
    await screen.findByTestId('scanner');
    await hit(EAN13);
    expect(await screen.findByText(t.offline)).toBeTruthy();
    expect(screen.getByRole('button', { name: t.byHand })).toBeTruthy();
    expect(docs(db, 'food_logs')).toHaveLength(0);
  });

  describe('saving never loses a different food (reviewer probes on #1004)', () => {
    const add = async (n: number) => {
      await fireEvent.press(await screen.findByRole('button', { name: 'Add to breakfast' }));
      await waitFor(() => expect(docs(db(), 'food_logs')).toHaveLength(n));
      await waitFor(() => expect(screen.queryByLabelText('Search foods')).toBeNull());
    };
    let current: Db;
    const db = () => current;

    it('two products with the same OFF name are two saved foods, and the first keeps its numbers and id', async () => {
      fetchMock.mockImplementation(async (req) => json(200, product({ code: req.url.split('/').pop() as string })));
      current = await setup();
      await scanAndAdd(EAN13);
      await add(1);
      const first = docs(current, 'user_foods')[0];
      await scanAndAdd(UPC_A, 'UPC_A');
      await fireEvent.changeText(await screen.findByLabelText(t.calories), '333');
      await add(2);
      const foods = docs(current, 'user_foods');
      expect(foods).toHaveLength(2);
      expect(foods.every((f) => !f.deleted_at)).toBe(true);
      expect(foods.find((f) => f.barcode === EAN13)).toMatchObject({ id: first.id, kcal: 200 });
      expect(foods.find((f) => f.barcode === UPC_A)).toMatchObject({ kcal: 333 });
      expect(new Set(foods.map((f) => f.id)).size).toBe(2);
    });

    it('a rescan as the 13-digit form finds the 12-digit save with no request, and a rename keeps one food', async () => {
      fetchMock.mockImplementation(async () => json(200, product({ code: UPC_A })));
      current = await setup();
      await scanAndAdd(UPC_A, 'UPC_A');
      await add(1);
      await scanAndAdd(`0${UPC_A}`);
      expect(await screen.findByText(t.savedNote)).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await fireEvent.changeText(screen.getByLabelText(t.name), 'Renamed bar');
      await add(2);
      const foods = docs(current, 'user_foods').filter((f) => !f.deleted_at);
      expect(foods).toHaveLength(1);
      expect(foods[0]).toMatchObject({ name: 'Renamed bar', barcode: UPC_A });
    });

    it('renaming a scanned food to the name of an unrelated custom food keeps both', async () => {
      fetchMock.mockImplementation(async () => json(200, product()));
      current = await setup();
      await open();
      await fireEvent.press(screen.getByLabelText('Custom'));
      await fireEvent.changeText(screen.getByLabelText('Food'), 'Home thali');
      await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '500');
      await fireEvent.press(screen.getByLabelText('Add to breakfast'));
      await waitFor(() => expect(docs(current, 'food_logs')).toHaveLength(1));
      await waitFor(() => expect(screen.queryByLabelText('Search foods')).toBeNull());
      await scanAndAdd(EAN13);
      await fireEvent.changeText(await screen.findByLabelText(t.name), 'Home thali');
      await add(2);
      const foods = docs(current, 'user_foods').filter((f) => !f.deleted_at);
      expect(foods.map((f) => f.barcode ?? null).sort()).toEqual([EAN13, null]);
      expect(new Set(foods.map((f) => f.id)).size).toBe(2);
    });

    it('a plain Custom save named like a scanned food does not replace it: both rows survive with distinct ids', async () => {
      fetchMock.mockImplementation(async () => json(200, product()));
      current = await setup();
      await scanAndAdd(EAN13);
      await add(1);
      await open();
      await fireEvent.press(screen.getByLabelText('Custom'));
      await fireEvent.changeText(screen.getByLabelText('Food'), 'Peanut bar (Acme)');
      await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '123');
      await fireEvent.press(screen.getByLabelText('Add to breakfast'));
      await waitFor(() => expect(docs(current, 'food_logs')).toHaveLength(2));
      const foods = docs(current, 'user_foods').filter((f) => !f.deleted_at);
      expect(foods).toHaveLength(2);
      expect(new Set(foods.map((f) => f.id)).size).toBe(2);
      expect(foods.find((f) => f.barcode === EAN13)).toMatchObject({ kcal: 200 });
      expect(foods.find((f) => !f.barcode)).toMatchObject({ kcal: 123 });
    });

    it('a product whose calories and macros are all genuinely 0 can be added, and a typed 0 kcal stays 0', async () => {
      const zero = { 'energy-kcal_100g': 0, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 };
      fetchMock.mockImplementation(async () => json(200, product({ name: 'Diet soda', brands: null, nutriments: zero, serving_size: null, serving_quantity: null })));
      current = await setup();
      await scanAndAdd(EAN13);
      await fireEvent.press(await screen.findByRole('button', { name: 'Add to breakfast' }));
      await waitFor(() => expect(docs(current, 'food_logs')).toHaveLength(1));
      expect(docs(current, 'food_logs')[0]).toMatchObject({ name: 'Diet soda', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
      expect(docs(current, 'user_foods')[0]).toMatchObject({ kcal: 0, barcode: EAN13 });
    });
  });
});
