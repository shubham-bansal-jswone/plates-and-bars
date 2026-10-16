import { AccessibilityInfo, Platform } from 'react-native';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { useKitchenTests, type TestFields } from '../src/kitchen/useKitchenTests';
import { KitchenTestScreen } from '../src/screens/KitchenTestScreen';
import { loadKitchenTests, saveKitchenTest } from '../src/db/kitchenTests';
import { PHOTO_HINT, PHOTO_HINT_WEB, SAVE_FAILED } from '../src/kitchen/copy';
import { CameraDenied, capturePhoto } from '../src/photos/capture';
import { deleteKitchenPhoto, putKitchenPhoto } from '../src/photos/vault';
import { memoryDb } from './helpers';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
jest.mock('../src/photos/capture', () => ({ capturePhoto: jest.fn(), CameraDenied: class CameraDenied extends Error {} }));
let mockPersistent = true;
jest.mock('../src/photos/vault', () => ({
  get persistent() {
    return mockPersistent;
  },
  putKitchenPhoto: jest.fn(() => Promise.resolve()),
  deleteKitchenPhoto: jest.fn(() => Promise.resolve()),
}));
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

beforeEach(() => {
  jest.clearAllMocks();
  mockPersistent = true;
});

// Undoes the spies and the Platform.OS replacement of every test, also when one of its assertions failed first.
afterEach(() => {
  jest.restoreAllMocks();
});

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

  it('says the photo stays on this device where the vault is persistent', async () => {
    await open();
    expect(screen.getByText(PHOTO_HINT)).toBeTruthy();
  });

  it('on web, says the photo is for this tab only and does not set has_photo', async () => {
    mockPersistent = false;
    capture.mockResolvedValue('JPEG64');
    const db = await open();
    expect(screen.getByText(PHOTO_HINT_WEB)).toBeTruthy();
    expect(screen.queryByText(PHOTO_HINT)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Take a photo of the serving'));
    await screen.findByText('Photo added');
    await fireEvent.press(screen.getByLabelText('Save test'));
    await waitFor(async () => expect(await loadKitchenTests(db)).toHaveLength(1));
    expect((await loadKitchenTests(db))[0]?.has_photo).toBe(false);
  });

  it('deletes the photo whatever the local flag says', async () => {
    const db = await open();
    await fireEvent.press(screen.getByLabelText('Save test'));
    await waitFor(async () => expect((await loadKitchenTests(db))[0]?.has_photo).toBe(false));
    const id = (await loadKitchenTests(db))[0]!.id;
    await fireEvent.press(await screen.findByLabelText('Delete Dal'));
    await waitFor(() => expect(deleteKitchenPhoto).toHaveBeenCalledWith(id));
  });

  it('announces "Photo added" to screen readers', async () => {
    capture.mockResolvedValue('JPEG64');
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await open();
    await fireEvent.press(screen.getByLabelText('Take a photo of the serving'));
    await screen.findByText('Photo added');
    expect(spy).toHaveBeenCalledWith('Photo added');
    spy.mockRestore();
  });

  it('removes the new photo when the record save fails afterwards', async () => {
    capture.mockResolvedValue('JPEG64');
    const db = await open();
    const real = db.runAsync.bind(db);
    jest.spyOn(db, 'runAsync').mockImplementation(async (sql: string, ...a: (string | number)[]) => {
      if (/INSERT OR REPLACE INTO kitchen_tests/.test(sql)) throw new Error('disk full');
      return real(sql, ...a);
    });
    await fireEvent.press(screen.getByLabelText('Take a photo of the serving'));
    await screen.findByText('Photo added');
    await fireEvent.press(screen.getByLabelText('Save test'));
    await waitFor(() => expect(deleteKitchenPhoto).toHaveBeenCalled());
    expect(put).toHaveBeenCalledTimes(1);
    expect(await loadKitchenTests(db)).toHaveLength(0);
  });

  it('on web the label is a live region and the native announcement is not used', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    capture.mockResolvedValue('JPEG64');
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await open();
    expect(screen.getByTestId('photo-status').props.accessibilityLiveRegion).toBe('polite');
    await fireEvent.press(screen.getByLabelText('Take a photo of the serving'));
    expect(await screen.findByText('Photo added')).toBeTruthy();
    expect(screen.getByTestId('photo-status')).toContainElement(screen.getByText('Photo added'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('on native there is no live region (the announcement is used), so it is not read twice', async () => {
    await open();
    expect(screen.getByTestId('photo-status').props.accessibilityLiveRegion).toBeUndefined();
  });
});

describe('Kitchen test photo cleanup (hook)', () => {
  const fields = (id: string): TestFields => ({ id, name: 'Dal', date: '2026-10-08', note: '', rows: [{ ingredient: 'Toor dal (dry)', amount: '150', unit: 'g' }], pot: '500', potFull: '1500', cooked: '', serving: '250', sname: 'katori', photo: 'JPEG64' });
  const failingSaves = (db: ReturnType<typeof memoryDb>) => {
    const real = db.runAsync.bind(db);
    return jest.spyOn(db, 'runAsync').mockImplementation(async (sql: string, ...a: (string | number)[]) => {
      if (/INSERT OR REPLACE INTO kitchen_tests/.test(sql)) throw new Error('disk full');
      return real(sql, ...a);
    });
  };
  const stored = (id: string, has_photo: boolean) => ({ id, version: 1, updated_at: '2026-10-08T00:00:00Z', deleted_at: null, name: 'Dal', date: '2026-10-08', note: '', ingredients: [], pot_g: null, pot_full_g: null, cooked_g: null, serving_g: null, serving_name: 'katori' as const, has_photo });
  const mount = async (db: ReturnType<typeof memoryDb>) => {
    const notify = jest.fn();
    const hook = await renderHook(() => useKitchenTests({ db, now: NOW, notify }));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    return { hook, notify };
  };

  it('keeps the file when the test already had a photo and the save fails', async () => {
    const db = memoryDb();
    await saveKitchenTest(db, stored('k1', true));
    const { hook } = await mount(db);
    failingSaves(db);
    hook.result.current.save(fields('k1'), 'Dal', null);
    await hook.result.current.idle();
    expect(put).toHaveBeenCalledTimes(1);
    expect(deleteKitchenPhoto).not.toHaveBeenCalled();
  });

  it('does not delete anything when the photo was never written and the save fails', async () => {
    const db = memoryDb();
    put.mockRejectedValueOnce(new Error('disk'));
    const { hook } = await mount(db);
    failingSaves(db);
    hook.result.current.save(fields('k4'), 'Dal', null);
    await hook.result.current.idle();
    expect(deleteKitchenPhoto).not.toHaveBeenCalled();
  });

  it('a failing cleanup does not hide the save failure: it is reported once, as the save failing', async () => {
    const db = memoryDb();
    (deleteKitchenPhoto as jest.Mock).mockRejectedValueOnce(new Error('vault'));
    const { hook, notify } = await mount(db);
    const failing = failingSaves(db);
    hook.result.current.save(fields('k2'), 'Dal', null);
    await hook.result.current.idle();
    expect(deleteKitchenPhoto).toHaveBeenCalledWith('k2');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(SAVE_FAILED);
    // The failed cleanup left the save queue working: the next save goes through, with no further failure shown.
    failing.mockRestore();
    await act(async () => {
      hook.result.current.save(fields('k5'), 'Dal', null);
      await hook.result.current.idle();
    });
    expect((await loadKitchenTests(db)).map((t) => t.id)).toEqual(['k5']);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a failing photo delete does not make a delete look failed', async () => {
    const db = memoryDb();
    await saveKitchenTest(db, stored('k3', false));
    (deleteKitchenPhoto as jest.Mock).mockRejectedValueOnce(new Error('vault'));
    const { hook, notify } = await mount(db);
    hook.result.current.remove('k3');
    await hook.result.current.idle();
    expect(deleteKitchenPhoto).toHaveBeenCalledWith('k3');
    expect(notify).not.toHaveBeenCalled();
    expect((await loadKitchenTests(db))[0]?.deleted_at).not.toBeNull();
  });
});
