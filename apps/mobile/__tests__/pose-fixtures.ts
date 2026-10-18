import type { PoseKeypoint } from '@plate-and-bar/core';
import type { PoseDetector, PoseEstimate } from '../src/pose/types';

/** 17 MoveNet keypoints with hip, knee and ankle placed so core's signal `h` (hip above knee, in shin lengths) is `h`. Side view, 640 x 480. */
export function frameFor(h: number): PoseEstimate {
  const shin = 0.3;
  const kp: PoseKeypoint[] = Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.2, score: 0.9 }));
  for (const [hip, knee, ankle] of [[11, 13, 15], [12, 14, 16]] as const) {
    kp[ankle] = { x: 0.5, y: 0.9, score: 0.9 };
    kp[knee] = { x: 0.5, y: 0.9 - shin, score: 0.9 };
    kp[hip] = { x: 0.5, y: 0.9 - shin - h * shin, score: 0.9 };
  }
  return { keypoints: kp, width: 640, height: 480 };
}

const ramp = (from: number, to: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);

/** One rep at 10 frames a second: standing, down to `low`, a short pause, back up. */
export function repH(low: number): number[] {
  return [1, 1, 1, ...ramp(1, low, 8), low, low, ...ramp(low, 1, 8), 1, 1, 1];
}

/**
 * A model that returns the given values of `h` one frame at a time and then waits forever (a person still on camera), so a test
 * can look at the screen while tracking is still running. `null` is a frame with nobody in it.
 */
export type ScriptedDetector = PoseDetector & { calls: number; disposed: boolean };
export function scriptedDetector(values: readonly (number | null)[]): ScriptedDetector {
  let i = 0;
  const d = {
    calls: 0,
    disposed: false,
    async estimate(): Promise<PoseEstimate | null> {
      d.calls += 1;
      if (i >= values.length) return new Promise(() => {});
      const v = values[i++]!;
      return v === null ? null : frameFor(v);
    },
    dispose() {
      d.disposed = true;
    },
  };
  return d;
}

/** A camera stream whose tracks can be checked for having been stopped. */
export function fakeStream() {
  const track = { stop: jest.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}
