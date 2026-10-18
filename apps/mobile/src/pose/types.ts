import type { PoseKeypoint } from '@plate-and-bar/core';
import type { PoseFrame } from '../../modules/plate-pose';

/** What one camera frame gave: MoveNet's 17 keypoints (x, y as 0..1 of the frame) and the frame's pixel size. Never kept. */
export interface PoseEstimate {
  readonly keypoints: readonly PoseKeypoint[];
  readonly width: number;
  readonly height: number;
}

/** What holds the camera: a browser MediaStream, or on Android a handle with nothing to stop (the native view owns the camera). */
export interface CameraStream {
  getTracks(): readonly { stop(): void }[];
}

/**
 * The model. `estimate` returns null when no person is found. The web one is `pose-detector.ts` (it reads the video element); the
 * Android one is `pose-native.ts` (the native camera view pushes keypoints through `feed`, and `estimate` takes no video). Tests pass a fake.
 */
export interface PoseDetector {
  estimate(video: HTMLVideoElement | null): Promise<PoseEstimate | null>;
  /** Android only: a frame result from the native camera view. */
  feed?(frame: PoseFrame): void;
  dispose(): void;
}
