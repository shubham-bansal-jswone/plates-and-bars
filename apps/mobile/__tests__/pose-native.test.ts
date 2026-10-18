import { FRAME_WAIT_MS, MODEL_SHA256, ModelIntegrityError, createNativePoseDetector, openNativeCamera, toEstimate } from '../src/pose/pose-native';
import type { PoseFrame } from '../modules/plate-pose';

// The module adapter for Android (#947) with the native side mocked: the sha256 check, the frame hand-over to core's shape, and the permission.
jest.mock('../modules/plate-pose', () => ({ verifyModel: jest.fn() }));

const frame = (over: Partial<PoseFrame> = {}): PoseFrame => ({
  t: 1000,
  width: 240,
  height: 320,
  keypoints: Array.from({ length: 51 }, (_, i) => (i % 3 === 2 ? 0.9 : i / 100)),
  ...over,
});
const ok = async () => ({ sha256: MODEL_SHA256 });

describe('the model hash check', () => {
  it('pins the sha256 of MoveNet Lightning float16 from the spike on #947', () => {
    expect(MODEL_SHA256).toMatch(/^0fac2226.*dd135ab$/);
    expect(MODEL_SHA256).toHaveLength(64);
  });

  it('starts when the native side reports the pinned hash', async () => {
    await expect(createNativePoseDetector(ok)).resolves.toBeTruthy();
  });

  it.each([
    ['another model', 'a'.repeat(64)],
    ['the pinned hash in capitals', MODEL_SHA256.toUpperCase()],
    ['an empty hash', ''],
  ])('refuses %s with ModelIntegrityError', async (_n, sha256) => {
    await expect(createNativePoseDetector(async () => ({ sha256 }))).rejects.toBeInstanceOf(ModelIntegrityError);
  });

  it('passes a native failure on (the session shows "could not load")', async () => {
    await expect(createNativePoseDetector(() => Promise.reject(new Error('model_hash_mismatch')))).rejects.toThrow('model_hash_mismatch');
  });
});

describe('toEstimate', () => {
  it('turns 51 numbers into 17 keypoints with x, y, score and keeps the frame size', () => {
    const e = toEstimate(frame())!;
    expect(e.keypoints).toHaveLength(17);
    expect(e.keypoints[0]).toEqual({ x: 0, y: 0.01, score: 0.9 });
    expect(e.keypoints[16]).toEqual({ x: 0.48, y: 0.49, score: 0.9 });
    expect(e).toMatchObject({ width: 240, height: 320 });
  });

  it.each([
    ['a short list', { keypoints: [0.1, 0.2, 0.3] }],
    ['a long list', { keypoints: Array(54).fill(0.5) }],
    ['no frame width', { width: 0 }],
    ['no frame height', { height: 0 }],
    ['a NaN', { keypoints: [...Array(50).fill(0.5), NaN] }],
    ['a string', { keypoints: [...Array(50).fill(0.5), '0.5'] as unknown as number[] }],
  ])('drops a frame with %s', (_n, over) => {
    expect(toEstimate(frame(over))).toBeNull();
  });
});

describe('the detector the camera view feeds', () => {
  afterEach(() => jest.useRealTimers());

  it('hands out a frame that arrived before it was asked for, once', async () => {
    jest.useFakeTimers();
    const d = await createNativePoseDetector(ok);
    d.feed!(frame());
    expect(await d.estimate(null)).toMatchObject({ width: 240, height: 320 });
    const second = d.estimate(null);
    await jest.advanceTimersByTimeAsync(FRAME_WAIT_MS);
    expect(await second).toBeNull();
  });

  it('keeps only the newest frame when two arrive before it is asked', async () => {
    const d = await createNativePoseDetector(ok);
    d.feed!(frame({ width: 100 }));
    d.feed!(frame({ width: 200 }));
    expect((await d.estimate(null))!.width).toBe(200);
  });

  it('waits for the next frame and resolves with it', async () => {
    const d = await createNativePoseDetector(ok);
    const p = d.estimate(null);
    d.feed!(frame({ width: 123 }));
    expect((await p)!.width).toBe(123);
  });

  it('says "nobody found" when no frame comes for 500 ms', async () => {
    jest.useFakeTimers();
    const d = await createNativePoseDetector(ok);
    const p = d.estimate(null);
    await jest.advanceTimersByTimeAsync(FRAME_WAIT_MS - 1);
    let done = false;
    void p.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await p).toBeNull();
  });

  it('ignores a malformed frame', async () => {
    jest.useFakeTimers();
    const d = await createNativePoseDetector(ok);
    d.feed!(frame({ keypoints: [1, 2, 3] }));
    const p = d.estimate(null);
    await jest.advanceTimersByTimeAsync(FRAME_WAIT_MS);
    expect(await p).toBeNull();
  });

  it('after dispose, a waiting call ends and nothing more is handed out', async () => {
    const d = await createNativePoseDetector(ok);
    const p = d.estimate(null);
    d.dispose();
    expect(await p).toBeNull();
    d.feed!(frame());
    expect(await d.estimate(null)).toBeNull();
  });
});

describe('the camera permission', () => {
  it('gives a handle with no tracks when granted (the native view owns the camera)', async () => {
    const s = await openNativeCamera(async () => 'granted');
    expect(s.getTracks()).toEqual([]);
  });

  it.each([
    ['denied', 'NotAllowedError'],
    ['blocked', 'NotAllowedError'],
    ['unavailable', 'NotFoundError'],
  ] as const)('a %s answer fails as %s, like the browser camera', async (answer, name) => {
    await expect(openNativeCamera(async () => answer)).rejects.toMatchObject({ name });
  });
});

describe('the web build', () => {
  // react-native-web has no PermissionsAndroid, and the pose chunk imports this file on every platform (the adapter is chosen when the
  // user taps Start camera): reading the permission constant while loading broke the sheet on the web ("Start camera" never showed).
  it('can load the adapter and the session where react-native has no PermissionsAndroid', () => {
    jest.isolateModules(() => {
      const rn = jest.requireActual<Record<string, unknown>>('react-native');
      jest.doMock('react-native', () => new Proxy(rn, { get: (t, k) => (k === 'PermissionsAndroid' ? undefined : t[k as string]) }));
      expect(() => require('../src/pose/pose-native')).not.toThrow();
      expect(() => require('../src/pose/pose-session')).not.toThrow();
    });
    jest.dontMock('react-native');
  });
});
