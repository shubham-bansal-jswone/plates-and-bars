import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { KitchenTestScreen } from '../src/screens/KitchenTestScreen';
import { loadKitchenTests } from '../src/db/kitchenTests';
import { CameraDenied, capturePhoto } from '../src/photos/capture';
import { deleteKitchenPhoto, putKitchenPhoto } from '../src/photos/vault';
import { memoryDb } from './helpers';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
jest.mock('../src/photos/capture', () => ({ capturePhoto: jest.fn(), CameraDenied: class CameraDenied extends Error {} }));
jest.mock('../src/photos/vault', () => ({ putKitchenPhoto: jest.fn(() => Promise.resolve()), deleteKitchenPhoto: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/sync/guard', () => ({ withPhotosSettled: (_db: unknown, f: () => Promise<unknown>) => f() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const capture = capturePhoto as jest.Mock;
const put = putKitchenPhoto as jest.Mock;

async function open() {
  const db = memoryDb();
  await render(<KitchenTestScreen db={db} onBack={jest.fn()} now={NOW} />);
  await screen.findByRole('header', { name: 'Kitchen tests' });
  await fireEvent.press(screen.getByLabelText('New kitchen test'));
  await screen.findByRole('header', { name: 'Kitchen test' });
  await fireEvent.changeText(screen.getByLabelText('Dish'), 'Dal');
  await fireEvent.changeText(screen.getByLabelText('Amount for ingredient 1'), '150');
  await fireEvent.changeText(screen.getByLabelText('Empty pot (g)'), '500');
  await fireEvent.changeText(screen.getByLabelText('Pot with food (g)'), '1500');
  return db;
}

beforeEach(() => jest.clearAllMocks());

describe('Kitchen test serving photo', () => {
  it('goes to the vault on save and only the flag is stored', async () => {
    capture.mockResolvedValue('JPEG64');
    const db = await open();
    await fireEvent.press(screen.getByLabelText('Take a photo of the serving'));
    await screen.findByText('Photo added');
    await fireEvent.press(screen.getByLabelText('Save test'));
    await waitFor(async () => expect((await loadKitchenTests(db))[0]?.has_photo).toBe(true));
    const t = (await loadKitchenTests(db))[0]!;
    expect(put).toHaveBeenCalledWith(t.id, 'JPEG64');
    expect(JSON.stringify([...db.rows.values()])).not.toContain('JPEG64');
  });

  it('a test saved without a photo never touches the vault', async () => {
    const db = await open();
    await fireEvent.press(screen.getByLabelText('Save test'));
    await waitFor(async () => expect(await loadKitchenTests(db)).toHaveLength(1));
    expect((await loadKitchenTests(db))[0]?.has_photo).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it('a failed vault write still saves the test, without the flag, and says so', async () => {
    capture.mockResolvedValue('JPEG64');
    put.mockRejectedValueOnce(new Error('disk'));
    const db = await open();
    await fireEvent.press(screen.getByLabelText('Choose a photo of the serving'));
    await screen.findByText('Photo added');
    await fireEvent.press(screen.getByLabelText('Save test'));
    await waitFor(async () => expect(await loadKitchenTests(db)).toHaveLength(1));
    expect((await loadKitchenTests(db))[0]?.has_photo).toBe(false);
    expect(await screen.findByText(/could not be/)).toBeTruthy();
  });

  it('camera off says so and adds nothing', async () => {
    capture.mockRejectedValue(new CameraDenied());
    await open();
    await fireEvent.press(screen.getByLabelText('Take a photo of the serving'));
    expect(await screen.findByText(/Camera access is off/)).toBeTruthy();
    expect(screen.queryByText('Photo added')).toBeNull();
  });

  it('deleting a test removes its photo', async () => {
    capture.mockResolvedValue('JPEG64');
    const db = await open();
    await fireEvent.press(screen.getByLabelText('Take a photo of the serving'));
    await fireEvent.press(screen.getByLabelText('Save test'));
    await waitFor(async () => expect((await loadKitchenTests(db))[0]?.has_photo).toBe(true));
    const id = (await loadKitchenTests(db))[0]!.id;
    await fireEvent.press(await screen.findByLabelText('Delete Dal'));
    await waitFor(() => expect(deleteKitchenPhoto).toHaveBeenCalledWith(id));
  });
});
