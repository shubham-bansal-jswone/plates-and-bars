import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { fitWithin } from '../src/photos/capture';
import { PhotosSection } from '../src/photos/PhotosSection';

// The Progress photos section (#429) against an in-memory vault, with capture stubbed (no camera in tests).
const mockStore = new Map<string, string>();
const mockVault = { persistent: true, failDates: false, failDelete: false, calls: [] as string[], wiped: new Set<() => void>() };
jest.mock('../src/photos/vault', () => ({
  POSES: ['front', 'side', 'back'],
  get persistent() {
    return mockVault.persistent;
  },
  putPhoto: async (d: string, p: string, b: string) => {
    mockVault.calls.push('put');
    mockStore.set(`${d}|${p}`, b);
  },
  getPhoto: async (d: string, p: string) => mockStore.get(`${d}|${p}`) ?? null,
  deletePhoto: async (d: string, p: string) => {
    if (mockVault.failDelete) throw new Error('disk');
    mockStore.delete(`${d}|${p}`);
  },
  onPhotosWiped: (f: () => void) => {
    mockVault.wiped.add(f);
    return () => mockVault.wiped.delete(f);
  },
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
const db = { withExclusiveTransactionAsync: async () => undefined }; // the owed-wipe step itself is mocked above
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
  mockVault.failDelete = false;
  mockVault.wiped.clear();
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

describe('progress photos, review on #431', () => {
  it('a wipe elsewhere (account switch, discard, delete everything) drops the photos on screen at once', async () => {
    mockStore.set('2026-10-01|front', 'eA==');
    await show();
    expect(await screen.findByLabelText('Check-in 1 Oct')).toBeTruthy();
    mockStore.clear();
    await act(async () => mockVault.wiped.forEach((f) => f()));
    await waitFor(() => expect(screen.queryByLabelText('Check-in 1 Oct')).toBeNull());
    expect(await screen.findByText(/No photos yet/)).toBeTruthy();
  });

  it('a save first finishes an owed wipe; if that fails nothing is saved and the user is told', async () => {
    mockCapture.mockResolvedValue('anGh');
    const notify = await show();
    await fireEvent.press(await screen.findByLabelText('New photo check-in'));
    mockVault.calls = [];
    await fireEvent.press(await screen.findByLabelText('Choose front'));
    await waitFor(() => expect(mockVault.calls).toContain('put'));
    expect(mockVault.calls.indexOf('wipe')).toBeLessThan(mockVault.calls.indexOf('put'));
    mockStore.clear();
    mockWipe.mockRejectedValueOnce(new Error('disk'));
    await fireEvent.press(await screen.findByLabelText('Choose another front'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Couldn’t save that photo. Try another one.'));
    expect(mockStore.size).toBe(0);
  });

  it('a delete that fails says so', async () => {
    mockStore.set('2026-10-01|front', 'eA==');
    const notify = await show();
    mockVault.failDelete = true;
    await fireEvent.press(await screen.findByLabelText('Delete the 1 Oct check-in'));
    await fireEvent.press(await screen.findByLabelText('Tap again to delete the 1 Oct check-in'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Couldn’t delete that check-in. Try again.'));
  });

  it('the grid shows the 12 newest check-ins, newest first', async () => {
    for (let d = 1; d <= 13; d++) mockStore.set(`2026-09-${String(d).padStart(2, '0')}|front`, 'eA==');
    await show();
    await screen.findByLabelText('Check-in 13 Sept');
    const order = screen.getAllByLabelText(/^Check-in /).map((e) => e.props.accessibilityLabel);
    expect(order).toHaveLength(12);
    expect(order[0]).toBe('Check-in 13 Sept');
    expect(order[11]).toBe('Check-in 2 Sept');
  });

  it('a thumbnail is the front photo, else the side, else the back', async () => {
    mockStore.set('2026-10-01|side', 'c2lkZQ==');
    mockStore.set('2026-10-01|back', 'YmFjaw==');
    mockStore.set('2026-10-02|back', 'b25seWJhY2s=');
    mockStore.set('2026-10-02|front', 'ZnJvbnQ=');
    await show();
    expect((await screen.findByLabelText('Check-in 1 Oct')).props.source.uri).toContain('c2lkZQ==');
    expect(screen.getByLabelText('Check-in 2 Oct').props.source.uri).toContain('ZnJvbnQ=');
  });

  it('the nudge starts at exactly 14 days', async () => {
    mockStore.set('2026-09-28|front', 'eA==');
    await show();
    expect(await screen.findByText('Last photos were 14 days ago. Time for a new check-in.')).toBeTruthy();
    mockStore.clear();
    mockStore.set('2026-09-29|front', 'eA==');
    await show();
    await screen.findByLabelText('Check-in 29 Sept');
    expect(screen.queryByText(/Last photos were 13 days ago/)).toBeNull();
  });

  it('a database that cannot run the owed wipe shows nothing (fails closed)', async () => {
    await show({ db: {} });
    expect(await screen.findByText('Couldn’t open your photos on this device. Try again.')).toBeTruthy();
    expect(mockVault.calls).not.toContain('dates');
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
