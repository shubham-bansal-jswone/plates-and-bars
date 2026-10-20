import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { LABEL_COPY as t } from '../src/labelscan/copy';
import { releasePhoto, takeLabelPhoto } from '../src/labelscan/capture';
import { memoryDb, withProfile } from './helpers';
import { FULL, ok } from './label-fixtures';

// Scan a nutrition label on the Food list tab, through the real flow and the record store. The camera and the text reader are mocked.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// Counts only the label scanner's native module; every other native module loads as usual.
const mockLoads = jest.fn();
const mockNativeRecognize = jest.fn();
jest.mock('expo', () => {
  const actual = jest.requireActual('expo');
  return { ...actual, requireNativeModule: (name: string) => (name === 'PlateLabelScanner' ? (mockLoads(name), { recognize: mockNativeRecognize }) : actual.requireNativeModule(name)) };
});
jest.mock('../src/labelscan/capture', () => ({ takeLabelPhoto: jest.fn(), releasePhoto: jest.fn(), CameraDenied: class CameraDenied extends Error {} }));
// Any write of a file would go through this class.
const mockWritten = jest.fn();
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' }, document: { uri: 'file:///doc/' } },
  File: class { exists = false; write = mockWritten; create = mockWritten; copy = mockWritten; move = mockWritten; },
  Directory: class { exists = false; create = mockWritten; },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const URI = 'file:///cache/ImagePicker/label-photo.jpg';
const fetchMock = jest.fn();
const realFetch = globalThis.fetch;
const realFlag = process.env.EXPO_PUBLIC_LABEL_SCAN;
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  mockWritten.mockReset();
  mockLoads.mockReset();
  mockNativeRecognize.mockReset().mockResolvedValue(ok(FULL));
  (takeLabelPhoto as jest.Mock).mockReset().mockResolvedValue({ uri: URI, width: 1000, height: 1500 });
  (releasePhoto as jest.Mock).mockReset();
  process.env.EXPO_PUBLIC_LABEL_SCAN = '1';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realFlag === undefined) delete process.env.EXPO_PUBLIC_LABEL_SCAN;
  else process.env.EXPO_PUBLIC_LABEL_SCAN = realFlag;
});

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
async function setup() {
  const db = memoryDb();
  await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1)));
  await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Food' });
  return db;
}
const docs = (db: ReturnType<typeof memoryDb>, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v));
const open = async () => {
  await fireEvent.press(screen.getByLabelText('+ Add to breakfast'));
  await screen.findByLabelText('Search foods');
};

describe('Scan a nutrition label on the Add sheet (behind EXPO_PUBLIC_LABEL_SCAN)', () => {
  it('flag off: no entry point, the same tabs, and the native module is never loaded', async () => {
    delete process.env.EXPO_PUBLIC_LABEL_SCAN;
    await setup();
    await open();
    expect(screen.queryByLabelText(t.entryA11y)).toBeNull();
    expect(screen.getAllByRole('tab').map((x) => x.props.accessibilityLabel)).toEqual(['Food list', 'Eating out', 'Custom']);
    expect(mockLoads).not.toHaveBeenCalled();
    expect(mockNativeRecognize).not.toHaveBeenCalled();
  });

  it('flag set to anything but 1 is off', async () => {
    process.env.EXPO_PUBLIC_LABEL_SCAN = 'true';
    await setup();
    await open();
    expect(screen.queryByLabelText(t.entryA11y)).toBeNull();
  });

  it('flag on: an entry beside the search field that opens the capture screen', async () => {
    await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.entryA11y));
    expect(await screen.findByRole('button', { name: t.take })).toBeTruthy();
  });

  it('Type it in closes the flow and opens the Custom tab', async () => {
    await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.entryA11y));
    await fireEvent.press(await screen.findByRole('button', { name: t.typeIt }));
    expect(await screen.findByLabelText('Serving size')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Custom' }).props.accessibilityState?.selected).toBe(true);
  });

  it('photo, crop, read, review, Add: logs the food and saves a user food; no file is mockWritten and nothing is sent', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.entryA11y));
    await fireEvent.press(await screen.findByRole('button', { name: t.take }));
    await fireEvent.press(await screen.findByRole('button', { name: t.read }));
    await screen.findByRole('header', { name: t.reviewTitle });
    await fireEvent.changeText(screen.getByLabelText(t.name), 'Crunchy granola');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to breakfast' }));
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
    const foods = docs(db, 'user_foods');
    expect(foods).toHaveLength(1);
    expect(foods[0]).toMatchObject({ name: 'Crunchy granola', unit: '100 g', kcal: 400, protein_g: 20, carbs_g: 50, fat_g: 10, fibre_g: 8, added_sugar_g: 5, origin: 'custom', deleted_at: null });
    expect(docs(db, 'food_logs')[0]).toMatchObject({ food_id: foods[0].id, name: 'Crunchy granola', meal: 'Breakfast', kcal: 400 });

    // The image is not persisted: no file write, no request, and no record holds its address. It was released.
    expect(mockWritten).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify([...db.rows])).not.toContain('label-photo');
    expect(releasePhoto).toHaveBeenCalledWith(URI);
    expect(mockLoads).toHaveBeenCalledTimes(1);
    expect(mockNativeRecognize).toHaveBeenCalledWith(URI, null); // the real module calls the engine; no crop means the whole photo
  });
});
