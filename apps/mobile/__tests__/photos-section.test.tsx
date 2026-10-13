import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { fitWithin } from '../src/photos/capture';
import { PhotosSection } from '../src/photos/PhotosSection';

// The Progress photos section (#429) against an in-memory vault, with capture stubbed (no camera in tests).
const mockStore = new Map<string, string>();
const mockVault = { persistent: true, failDates: false, calls: [] as string[] };
jest.mock('../src/photos/vault', () => ({
  POSES: ['front', 'side', 'back'],
  get persistent() {
    return mockVault.persistent;
  },
  putPhoto: async (d: string, p: string, b: string) => void mockStore.set(`${d}|${p}`, b),
  getPhoto: async (d: string, p: string) => mockStore.get(`${d}|${p}`) ?? null,
  deletePhoto: async (d: string, p: string) => void mockStore.delete(`${d}|${p}`),
  photoDates: async () => {
    mockVault.calls.push('dates');
    if (mockVault.failDates) throw new Error('vault');
    return [...new Set([...mockStore.keys()].map((k) => k.split('|')[0]))].sort();
  },
}));
const mockWipe = jest.fn(async () => void mockVault.calls.push('wipe'));
jest.mock('../src/sync/guard', () => ({ completePhotoWipe: () => mockWipe() }));
const mockCapture = jest.fn();
jest.mock('../src/photos/capture', () => {
  const actual = jest.requireActual('../src/photos/capture');
  return { ...actual, capturePhoto: (s: string) => mockCapture(s) };
});

const TODAY = '2026-10-12';
const db = {} as never; // a test double without transactions: the owed-wipe step is skipped
const weights = ['2026-09-17', '2026-09-19', '2026-09-21'].map((date) => ({ date, weight_kg: 82 })).concat({ date: '2026-10-12', weight_kg: 80 });
const tapes = [{ date: '2026-09-20', waist_cm: 90 }];

async function show(opts: { db?: unknown } = {}) {
  const notify = jest.fn();
  await render(<PhotosSection db={(opts.db ?? db) as never} date={TODAY} weights={weights} tapes={tapes} notify={notify} />);
  return notify;
}

beforeEach(() => {
  mockStore.clear();
  mockVault.persistent = true;
  mockVault.failDates = false;
  mockVault.calls = [];
  mockWipe.mockClear();
  mockCapture.mockReset();
});

describe('progress photos (#429)', () => {
  it('with no photos it says why to take them and offers a check-in', async () => {
    await show();
    expect(await screen.findByText(/No photos yet\. Front, side and back every 2–4 weeks/)).toBeTruthy();
    expect(screen.getByText('Saved only on this device, encrypted. They’re never uploaded or sent anywhere.')).toBeTruthy();
    expect(screen.getByLabelText('New photo check-in')).toBeTruthy();
    expect(screen.queryByText('Compare')).toBeNull();
  });

  it('a chosen photo is saved for today under its pose; the sheet and the button then say so', async () => {
    mockCapture.mockResolvedValue('anGh');
    await show();
    await fireEvent.press(await screen.findByLabelText('New photo check-in'));
    await fireEvent.press(await screen.findByLabelText('Choose front'));
    await waitFor(() => expect(mockStore.get(`${TODAY}|front`)).toBe('anGh'));
    expect(mockCapture).toHaveBeenCalledWith('library');
    expect(await screen.findByLabelText('Choose another front')).toBeTruthy();
    expect(screen.getByLabelText('Front photo')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(await screen.findByLabelText('Add to today’s photos')).toBeTruthy();
  });

  it('camera access turned off is explained, and nothing is saved; a cancel saves nothing either', async () => {
    const { CameraDenied } = jest.requireActual('../src/photos/capture');
    mockCapture.mockRejectedValueOnce(new CameraDenied()).mockResolvedValueOnce(null);
    const notify = await show();
    await fireEvent.press(await screen.findByLabelText('New photo check-in'));
    await fireEvent.press(await screen.findByLabelText('Take side'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Camera access is off. Allow it in Settings, or choose a photo instead.'));
    await fireEvent.press(screen.getByLabelText('Choose side'));
    await waitFor(() => expect(mockCapture).toHaveBeenCalledTimes(2));
    expect(mockStore.size).toBe(0);
  });

  it('compares the first and last check-in side by side with weekly weight and waist, by pose', async () => {
    mockStore.set('2026-09-21|front', 'b2xk');
    mockStore.set('2026-10-12|front', 'bmV3');
    await show();
    expect(await screen.findByText('Compare')).toBeTruthy();
    expect(await screen.findByLabelText('Before, front')).toBeTruthy();
    expect(screen.getByText(/21 Sept, 82 kg, waist 90 cm/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(await screen.findByText('One of these dates has no back photo.')).toBeTruthy();
  });

  it('the slider is adjustable by a screen reader and by the buttons', async () => {
    mockStore.set('2026-09-21|front', 'b2xk');
    mockStore.set('2026-10-12|front', 'bmV3');
    await show();
    await fireEvent.press(await screen.findByLabelText('Slider'));
    const slider = await screen.findByLabelText('Slide between before and after, front');
    expect(slider.props.accessibilityValue).toMatchObject({ now: 50 });
    await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByLabelText('Slide between before and after, front').props.accessibilityValue).toMatchObject({ now: 60 });
    await fireEvent.press(screen.getByLabelText('Show more of after'));
    await fireEvent.press(screen.getByLabelText('Show more of after'));
    expect(screen.getByLabelText('Slide between before and after, front').props.accessibilityValue).toMatchObject({ now: 40 });
  });

  it('delete needs a second tap, then removes every pose of that day', async () => {
    mockStore.set('2026-10-01|front', 'eA==');
    mockStore.set('2026-10-01|side', 'eQ==');
    const notify = await show();
    await fireEvent.press(await screen.findByLabelText('Delete the 1 Oct check-in'));
    expect(mockStore.size).toBe(2);
    await fireEvent.press(await screen.findByLabelText('Tap again to delete the 1 Oct check-in'));
    await waitFor(() => expect(mockStore.size).toBe(0));
    expect(notify).toHaveBeenCalledWith('Check-in deleted');
  });

  it('nudges after 14 days without photos', async () => {
    mockStore.set('2026-09-21|front', 'eA==');
    await show();
    expect(await screen.findByText('Last photos were 21 days ago. Time for a new check-in.')).toBeTruthy();
  });

  it('on web it says photos last only for this tab', async () => {
    mockVault.persistent = false;
    await show();
    expect(await screen.findByText('This browser can’t store photos, so they’ll disappear when you close the page.')).toBeTruthy();
    expect(screen.getByText('Kept only in this browser tab. They’re never uploaded or sent anywhere.')).toBeTruthy();
  });

  it('an owed vault wipe is finished before anything is read', async () => {
    await show({ db: { withExclusiveTransactionAsync: async () => undefined } });
    await screen.findByLabelText('New photo check-in');
    expect(mockVault.calls.slice(0, 2)).toEqual(['wipe', 'dates']);
  });

  it('if the owed wipe fails there is no check-in, only a retry, and nothing is read', async () => {
    mockWipe.mockRejectedValueOnce(new Error('disk'));
    await show({ db: { withExclusiveTransactionAsync: async () => undefined } });
    expect(await screen.findByText('Couldn’t open your photos on this device. Try again.')).toBeTruthy();
    expect(screen.queryByLabelText('New photo check-in')).toBeNull();
    expect(mockWipe).toHaveBeenCalledTimes(1);
    expect(mockVault.calls).not.toContain('dates'); // the vault was not read
    await fireEvent.press(screen.getByLabelText('Try again'));
    expect(await screen.findByLabelText('New photo check-in')).toBeTruthy();
  });
});

describe('photo resize (prototype compressPhoto: 900 px on the long side)', () => {
  it('scales the long side to 900 and leaves small photos alone', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 900 });
    expect(fitWithin(3000, 4000)).toEqual({ height: 900 });
    expect(fitWithin(900, 600)).toBeNull();
    expect(fitWithin(800, 600)).toBeNull();
  });
});
