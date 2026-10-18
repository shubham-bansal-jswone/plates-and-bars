// The Android side of live pose tracking (#947): the native camera view streams MoveNet keypoints (CameraX + LiteRT, in
// modules/plate-pose) and this file turns them into the same `PoseDetector` the web path gives the session, so core's rep counter and the
// screen are shared. Loaded only with the camera view (a separate chunk). Frames never reach JavaScript: only 17 keypoints per frame.
import type { PoseKeypoint } from '@plate-and-bar/core';
import { verifyModel, type PoseFrame } from '../../modules/plate-pose';
import { requestCamera } from '../barcode/permission';
import { POSE_COPY as t } from './copy';
import type { CameraStream, PoseDetector, PoseEstimate } from './types';

/**
 * sha256 of the bundled MoveNet Lightning float16 model (Kaggle google/movenet, tfLite, singlepose-lightning-tflite-float16, version 1;
 * Apache-2.0). Pinned here and in ModelFile.kt; __tests__/pose-native-assets.test.ts keeps both, and the file itself, equal.
 */
export const MODEL_SHA256 = '0fac2226112d0371903ca86e3853cec24ef603a0b2f96f589b180f0ebdd135ab';

/** The bundled model is not the pinned one: tracking refuses to start. */
export class ModelIntegrityError extends Error {
  constructor() {
    super('model_hash_mismatch');
    this.name = 'ModelIntegrityError';
  }
}

/** How long `estimate` waits for the next frame before it reports "nobody found". */
export const FRAME_WAIT_MS = 500;

/** The 51 numbers of a native frame as 17 keypoints. Null when the frame is malformed (wrong length, no size, a non-finite number). */
export function toEstimate(f: PoseFrame): PoseEstimate | null {
  const k = f.keypoints;
  if (!Array.isArray(k) || k.length !== 51 || !(f.width > 0) || !(f.height > 0) || !k.every(Number.isFinite)) return null;
  const keypoints: PoseKeypoint[] = [];
  for (let i = 0; i < 17; i++) keypoints.push({ x: k[i * 3]!, y: k[i * 3 + 1]!, score: k[i * 3 + 2]! });
  return { keypoints, width: f.width, height: f.height };
}

/**
 * Checks the model on the device, then gives a detector the camera view feeds. `estimate` hands out the newest frame not yet used, or
 * waits for the next one (the native side already runs at about 12 frames a second).
 */
export async function createNativePoseDetector(verify: () => Promise<{ sha256: string }> = verifyModel): Promise<PoseDetector> {
  const { sha256 } = await verify();
  if (sha256 !== MODEL_SHA256) throw new ModelIntegrityError();
  let pending: PoseEstimate | null = null;
  let waiting: ((e: PoseEstimate | null) => void) | null = null;
  let gone = false;
  const settle = (e: PoseEstimate | null) => {
    const w = waiting;
    waiting = null;
    w?.(e);
  };
  return {
    async estimate() {
      if (gone) return null;
      if (pending) {
        const e = pending;
        pending = null;
        return e;
      }
      return new Promise<PoseEstimate | null>((resolve) => {
        const timer = setTimeout(() => settle(null), FRAME_WAIT_MS);
        waiting = (e) => {
          clearTimeout(timer);
          resolve(e);
        };
      });
    },
    feed(frame) {
      if (gone) return;
      const e = toEstimate(frame);
      if (!e) return;
      if (waiting) settle(e);
      else pending = e;
    },
    dispose() {
      gone = true;
      pending = null;
      settle(null);
    },
  };
}

/**
 * The camera permission, asked with the rationale when the user taps "Start camera". There is no stream in JavaScript: the native view
 * owns the camera once it mounts, so the handle only has nothing to stop. A refusal is a `NotAllowedError`, like the browser's.
 */
export async function openNativeCamera(ask: typeof requestCamera = requestCamera): Promise<CameraStream> {
  // The dialog says what this feature uses the camera for, not the barcode scanner's reason.
  const p = await ask({ title: t.rationaleTitle, message: t.rationale, buttonPositive: t.allow, buttonNegative: t.notNow });
  if (p === 'granted') return { getTracks: () => [] };
  throw Object.assign(new Error(`camera_${p}`), { name: p === 'unavailable' ? 'NotFoundError' : 'NotAllowedError' });
}
