import { AppState, Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PoseSession, type PoseSessionProps } from '../src/pose/pose-session';
import { MODEL_SHA256, createNativePoseDetector } from '../src/pose/pose-native';
import { frameFor, repH } from './pose-fixtures';
import type { CameraPermission } from '../src/barcode/permission';
import type { PoseViewProps } from '../modules/plate-pose';
import { DEPTH_CUES } from '@plate-and-bar/core';

// "Track this set" on Android (#947): the same session as the web, with the native camera view and the native model check mocked. The fake
// view records its props, so a test can send frames and errors the way the native side would.
let view: PoseViewProps | null = null;
let mounts = 0;
let unmounts = 0;
let mockSha = '';
jest.mock('../modules/plate-pose', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    verifyModel: () => Promise.resolve({ sha256: mockSha, bytes: 4_758_512 }),
    PoseCameraView: (props: PoseViewProps) => {
      view = props;
      R.useEffect(() => {
        mounts += 1;
        return () => void (unmounts += 1);
      }, []);
      return <View testID="pose-camera" />;
    },
  };
});
let mockPermission: CameraPermission = 'granted';
let mockAnswer: Promise<CameraPermission> | null = null; // a test sets this to hold the permission dialog open
jest.mock('../src/barcode/permission', () => ({ requestCamera: () => mockAnswer ?? Promise.resolve(mockPermission), checkCamera: () => Promise.resolve(mockPermission) }));

const OS = Platform.OS;
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const clock = () => {
  let t = 0;
  return () => (t += 50);
};
/** One native frame for a squat signal `h`, as the module sends it: 51 numbers, frame size, timestamp. */
const send = (h: number, t = 0) =>
  act(async () => {
    const f = frameFor(h);
    view!.onPose({ nativeEvent: { t, width: 480, height: 640, keypoints: f.keypoints.flatMap((k) => [k.x, k.y, k.score]) } } as never);
    await new Promise((r) => setTimeout(r, 4)); // the loop takes the frame and steps core
  });

async function mount(over: Partial<PoseSessionProps> = {}) {
  const onApply = jest.fn();
  const onClose = jest.fn();
  await render(<PoseSession exercise="Goblet Squat" setNumber={3} onApply={onApply} onClose={onClose} now={clock()} frameMs={0} countdownSeconds={0} {...over} />);
  return { onApply, onClose };
}

beforeEach(() => {
  Platform.OS = 'android';
  view = null;
  mounts = 0;
  unmounts = 0;
  mockSha = MODEL_SHA256;
  mockPermission = 'granted';
  mockAnswer = null;
});
afterEach(() => void (Platform.OS = OS));

describe('PoseSession on Android: permission and start', () => {
  it('shows the same safety text and privacy line, and mounts no camera before the user starts', async () => {
    await mount();
    expect(screen.getByText(/Prop your phone 2-3 metres away/)).toBeTruthy();
    expect(screen.getByText('The camera view stays on this phone. Nothing is recorded or sent.')).toBeTruthy();
    expect(screen.queryByTestId('pose-camera')).toBeNull();
    expect(mounts).toBe(0);
  });

  it('asks for the camera on "Start camera"; when granted the native view mounts with a label and the start text does not promise a download', async () => {
    await mount({ countdownSeconds: 1 });
    await press('Start camera');
    expect(await screen.findByTestId('pose-camera')).toBeTruthy();
    expect(screen.getByLabelText('Camera view')).toBeTruthy();
    expect(screen.queryByText(/downloads about 5 MB/)).toBeNull();
    expect(mounts).toBe(1);
  });

  it.each([
    ['denied', /Allow it for Plate & Bar in your phone settings/],
    ['blocked', /Allow it for Plate & Bar in your phone settings/],
    ['unavailable', /No camera was found/],
  ] as const)('a %s permission answer says so, never mounts the camera, and the user can try again or close', async (answer, text) => {
    mockPermission = answer;
    const { onClose } = await mount();
    await press('Start camera');
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByTestId('pose-camera')).toBeNull();
    expect(screen.queryByText(/browser settings/)).toBeNull();
    await press('Try again');
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeTruthy();
    await press('Close');
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses a model whose hash is not the pinned one, takes the camera away and says it could not load', async () => {
    mockSha = 'b'.repeat(64);
    await mount();
    await press('Start camera');
    expect(await screen.findByText('The tracking model could not load. Your set works the same without it.')).toBeTruthy();
    expect(screen.queryByText(/connection/)).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('pose-camera')).toBeNull());
  });
});

describe('PoseSession on Android: frames from the native view', () => {
  async function track() {
    const m = await mount();
    await press('Start camera');
    await screen.findByTestId('pose-camera');
    await screen.findByText('No reps yet');
    return m;
  }

  it('counts two reps from the streamed keypoints, shows depth and tempo, then confirms before applying', async () => {
    const { onApply } = await track();
    for (const h of [...repH(-0.2), ...repH(-0.2)]) await send(h);
    expect(await screen.findByText('Rep 2')).toBeTruthy();
    expect(screen.getByText(/Depth: about parallel/)).toBeTruthy();
    expect(screen.getByText(/Down \d\.\d s.*, up \d\.\d s/)).toBeTruthy();
    expect(screen.getByText('Rep 2').parent!.props.accessibilityLiveRegion).toBe('polite');
    await press('Finish set');
    expect(screen.getByText('Counted 2 reps. 2 reached about parallel.')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    await press('Use 2 reps for set 3');
    expect(onApply).toHaveBeenCalledWith(2);
  });

  it('a rep above parallel shows the exercise card cue from core', async () => {
    await track();
    for (const h of repH(0.2)) await send(h);
    await screen.findByText('Rep 1');
    await press('Finish set');
    expect(screen.getByText(`From the exercise card: ${DEPTH_CUES['Goblet Squat'].text}`)).toBeTruthy();
  });

  it('ignores a frame that is not 51 numbers and does not count it', async () => {
    await track();
    await act(async () => view!.onPose({ nativeEvent: { t: 0, width: 480, height: 640, keypoints: [1, 2, 3] } } as never));
    expect(screen.getByText('No reps yet')).toBeTruthy();
  });

  it('ending the set unmounts the camera view (CameraX and the model are released)', async () => {
    await track();
    expect(unmounts).toBe(0);
    await press('Finish set');
    expect(screen.queryByTestId('pose-camera')).toBeNull();
    expect(unmounts).toBe(1);
  });

  it('a camera error from the view ends tracking with the camera message, and the user can retry', async () => {
    await track();
    await act(async () => view!.onError!({ nativeEvent: { message: 'camera_failed' } } as never));
    expect(screen.getByText(/camera could not start/)).toBeTruthy();
    expect(screen.queryByTestId('pose-camera')).toBeNull();
    await press('Try again');
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeTruthy();
  });

  it.each([
    ['no_camera', /No camera was found/],
    ['model_failed', /tracking model could not load/],
    ['model_hash_mismatch', /tracking model could not load/],
  ])('a %s error from the view says the matching thing', async (message, text) => {
    await track();
    await act(async () => view!.onError!({ nativeEvent: { message } } as never));
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('one failed frame is ignored, a run of ten means the model is broken', async () => {
    await track();
    const fail = () => act(async () => view!.onError!({ nativeEvent: { message: 'inference_failed' } } as never));
    for (let i = 0; i < 9; i++) await fail();
    expect(screen.getByText('No reps yet')).toBeTruthy();
    await send(1); // a good frame resets the run
    for (let i = 0; i < 9; i++) await fail();
    expect(screen.getByText('No reps yet')).toBeTruthy();
    await fail();
    expect(screen.getByText(/tracking model could not load/)).toBeTruthy();
  });

  it('the app going to the background ends the set with what was counted', async () => {
    let listener: ((s: string) => void) | undefined;
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, l: (s: string) => void) => {
      listener = l;
      return { remove };
    }) as never);
    try {
      await track();
      for (const h of repH(-0.2)) await send(h);
      await screen.findByText('Rep 1');
      await act(async () => listener!('background'));
      expect(screen.getByText('Counted 1 rep. 1 reached about parallel.')).toBeTruthy();
      expect(screen.queryByTestId('pose-camera')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('the permission dialog pauses the app: a background event while it is open does not cancel the start, and the camera runs after the grant', async () => {
    let listener: ((s: string) => void) | undefined;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, l: (s: string) => void) => {
      listener = l;
      return { remove: jest.fn() };
    }) as never);
    try {
      let grant!: (p: CameraPermission) => void;
      mockAnswer = new Promise((r) => (grant = r));
      await mount();
      await press('Start camera');
      await act(async () => listener!('background')); // what Android reports when the dialog opens
      await act(async () => listener!('active'));
      await act(async () => grant('granted'));
      expect(await screen.findByTestId('pose-camera')).toBeTruthy();
      expect(await screen.findByText('No reps yet')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Start camera' })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('once the camera is running, background still ends a start that is loading the model', async () => {
    let listener: ((s: string) => void) | undefined;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, l: (s: string) => void) => {
      listener = l;
      return { remove: jest.fn() };
    }) as never);
    try {
      await mount({ load: () => new Promise(() => {}) });
      await press('Start camera');
      await screen.findByTestId('pose-camera');
      await act(async () => listener!('background'));
      expect(screen.getByRole('button', { name: 'Start camera' })).toBeTruthy();
      expect(screen.queryByTestId('pose-camera')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('leaving the screen mid-set releases the camera view and stops listening to the app state', async () => {
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove } as never);
    try {
      const onApply = jest.fn();
      const r = await render(<PoseSession exercise="Goblet Squat" setNumber={1} onApply={onApply} onClose={jest.fn()} now={clock()} frameMs={0} countdownSeconds={0} />);
      await press('Start camera');
      await screen.findByTestId('pose-camera');
      await act(async () => r.unmount());
      expect(unmounts).toBe(1);
      expect(remove).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('PoseSession on Android: the defaults', () => {
  it('load() with the real adapter and the pinned hash feeds core (the same path the app uses)', async () => {
    const detector = await createNativePoseDetector();
    detector.feed!({ t: 1, width: 480, height: 640, keypoints: frameFor(1).keypoints.flatMap((k) => [k.x, k.y, k.score]) });
    expect(await detector.estimate(null)).toMatchObject({ width: 480, height: 640 });
  });
});
