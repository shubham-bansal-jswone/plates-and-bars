// The MoveNet model on TensorFlow.js (Apache-2.0). This file is only ever loaded through `import()` when the user starts
// the camera in "Track this set", so none of TensorFlow.js is in the main web bundle (the file name `pose-` also keeps the
// service worker from precaching its chunk, public/sw.js).
//
// Backends: WebGL, then WASM with one thread. The default multi-threaded WASM start-up loads a blob: script, which our
// Content-Security-Policy blocks and must not allow. The model weights and the .wasm files are on our own origin
// (public/pose/): the library's default model address is a third-party host and is never used (`modelUrl` is always set).
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-converter';
import '@tensorflow/tfjs-backend-webgl';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { SupportedModels, createDetector, movenet } from '@tensorflow-models/pose-detection';
import type { PoseKeypoint } from '@plate-and-bar/core';
import type { PoseDetector } from './types';

export const MODEL_URL = '/pose/movenet-lightning/model.json';
export const WASM_PATH = '/pose/wasm/';

tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);

async function initBackend(): Promise<void> {
  try {
    if (await tf.setBackend('webgl')) {
      await tf.ready();
      return;
    }
  } catch {
    // no WebGL on this device: fall through to WASM
  }
  setWasmPaths(WASM_PATH);
  await tf.setBackend('wasm');
  await tf.ready();
}

export async function createPoseDetector(): Promise<PoseDetector> {
  await initBackend();
  // Smoothing is core's job (stepRepCounter), so the library's own keypoint smoothing is off.
  const detector = await createDetector(SupportedModels.MoveNet, { modelType: movenet.modelType.SINGLEPOSE_LIGHTNING, modelUrl: MODEL_URL, enableSmoothing: false });
  return {
    async estimate(video) {
      if (!video) return null;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return null;
      const poses = await detector.estimatePoses(video, { flipHorizontal: false });
      const kp = poses[0]?.keypoints;
      if (!kp || kp.length < 17) return null;
      const keypoints: PoseKeypoint[] = kp.map((k) => ({ x: k.x / width, y: k.y / height, score: k.score ?? 0 }));
      return { keypoints, width, height };
    },
    dispose() {
      detector.dispose();
    },
  };
}
