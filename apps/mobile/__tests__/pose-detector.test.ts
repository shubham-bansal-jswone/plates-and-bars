import * as tfCore from '@tensorflow/tfjs-core';
import * as tfWasm from '@tensorflow/tfjs-backend-wasm';
import * as poseLib from '@tensorflow-models/pose-detection';
import { MODEL_URL, WASM_PATH, createPoseDetector } from '../src/pose/pose-detector';

// The TensorFlow.js wiring (#947): the weights are ours and always passed by modelUrl, WebGL first, then single-thread WASM.
// TensorFlow.js itself is replaced; the browser spec (tests/e2e/specs/pose.spec.mjs) runs the real library under the real CSP.
// Each factory makes its own mock functions: jest hoists these above the imports, so no outer const exists yet.
jest.mock('@tensorflow/tfjs-core', () => {
  const set = jest.fn();
  return { __set: set, env: () => ({ set }), setBackend: jest.fn(), ready: jest.fn() };
});
jest.mock('@tensorflow/tfjs-converter', () => ({}));
jest.mock('@tensorflow/tfjs-backend-webgl', () => ({}));
jest.mock('@tensorflow/tfjs-backend-wasm', () => ({ setWasmPaths: jest.fn() }));
jest.mock('@tensorflow-models/pose-detection', () => ({
  SupportedModels: { MoveNet: 'MoveNet' },
  movenet: { modelType: { SINGLEPOSE_LIGHTNING: 'SinglePose.Lightning' } },
  createDetector: jest.fn(),
}));


const mockSetBackend = tfCore.setBackend as unknown as jest.Mock;
const mockReady = tfCore.ready as unknown as jest.Mock;
const mockSetWasmPaths = tfWasm.setWasmPaths as unknown as jest.Mock;
const mockCreateDetector = poseLib.createDetector as unknown as jest.Mock;
const mockEstimatePoses = jest.fn();
const mockDispose = jest.fn();
// what the module did while loading, before any test resets the mocks
const loadTimeEnv = (tfCore as unknown as { __set: jest.Mock }).__set.mock.calls.slice();

const video = (w = 640, h = 480) => ({ videoWidth: w, videoHeight: h }) as unknown as HTMLVideoElement;
const kp17 = (x: number, y: number) => Array.from({ length: 17 }, () => ({ x, y, score: 0.8 }));

beforeEach(() => {
  mockSetBackend.mockReset().mockResolvedValue(true);
  mockReady.mockReset().mockResolvedValue(undefined);
  mockSetWasmPaths.mockReset();
  mockEstimatePoses.mockReset();
  mockDispose.mockReset();
  mockCreateDetector.mockReset().mockResolvedValue({ estimatePoses: mockEstimatePoses, dispose: mockDispose });
});

describe('pose detector', () => {
  it('turns the multi-threaded WASM off before anything starts (its workers need a blob: script the CSP refuses)', () => {
    expect(loadTimeEnv).toContainEqual(['WASM_HAS_MULTITHREAD_SUPPORT', false]);
  });

  it('always loads the weights from our own origin by modelUrl, never the library default', async () => {
    await createPoseDetector();
    expect(MODEL_URL).toBe('/pose/movenet-lightning/model.json');
    expect(mockCreateDetector).toHaveBeenCalledWith('MoveNet', { modelType: 'SinglePose.Lightning', modelUrl: MODEL_URL, enableSmoothing: false });
    expect(MODEL_URL.startsWith('/') && !MODEL_URL.startsWith('//')).toBe(true);
  });

  it('uses WebGL when it starts, without touching the WASM paths', async () => {
    await createPoseDetector();
    expect(mockSetBackend).toHaveBeenCalledTimes(1);
    expect(mockSetBackend).toHaveBeenCalledWith('webgl');
    expect(mockSetWasmPaths).not.toHaveBeenCalled();
  });

  it.each([
    ['refuses (returns false)', () => mockSetBackend.mockResolvedValueOnce(false)],
    ['throws', () => mockSetBackend.mockRejectedValueOnce(new Error('no webgl'))],
  ])('falls back to WASM from our origin when WebGL %s', async (_n, arrange) => {
    arrange();
    await createPoseDetector();
    expect(mockSetBackend.mock.calls.map((c) => c[0])).toEqual(['webgl', 'wasm']);
    expect(mockSetWasmPaths).toHaveBeenCalledWith(WASM_PATH);
    expect(WASM_PATH).toBe('/pose/wasm/');
  });

  it('turns pixel keypoints into 0..1 of the frame, with the frame size, for core', async () => {
    mockEstimatePoses.mockResolvedValue([{ keypoints: kp17(320, 240) }]);
    const d = await createPoseDetector();
    const out = await d.estimate(video(640, 480));
    expect(out).toMatchObject({ width: 640, height: 480 });
    expect(out!.keypoints).toHaveLength(17);
    expect(out!.keypoints[0]).toEqual({ x: 0.5, y: 0.5, score: 0.8 });
    expect(mockEstimatePoses).toHaveBeenCalledWith(expect.anything(), { flipHorizontal: false });
  });

  it('returns null when nobody is found, the video has no size yet, or the output is short', async () => {
    const d = await createPoseDetector();
    mockEstimatePoses.mockResolvedValueOnce([]);
    expect(await d.estimate(video())).toBeNull();
    expect(await d.estimate(video(0, 0))).toBeNull();
    expect(mockEstimatePoses).toHaveBeenCalledTimes(1);
    mockEstimatePoses.mockResolvedValueOnce([{ keypoints: kp17(1, 1).slice(0, 5) }]);
    expect(await d.estimate(video())).toBeNull();
  });

  it('frees the model on dispose', async () => {
    (await createPoseDetector()).dispose();
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });
});
