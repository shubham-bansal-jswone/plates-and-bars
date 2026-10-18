import type { PoseKeypoint } from '@plate-and-bar/core';

/** What one camera frame gave: MoveNet's 17 keypoints (x, y as 0..1 of the frame) and the frame's pixel size. Never kept. */
export interface PoseEstimate {
  readonly keypoints: readonly PoseKeypoint[];
  readonly width: number;
  readonly height: number;
}

/** The model. `estimate` returns null when no person is found. The web one is `pose-detector.ts`; tests pass a fake. */
export interface PoseDetector {
  estimate(video: HTMLVideoElement): Promise<PoseEstimate | null>;
  dispose(): void;
}
