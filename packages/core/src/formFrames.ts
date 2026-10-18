/**
 * Form check frame positions (#1011). Prototype function: `videoFrames` (plate-and-bar.html line 3173), lines 3181 and 3183:
 * `dur = v.duration && isFinite(v.duration) ? v.duration : 5` and `at = dur * (0.12 + 0.76 * k / Math.max(1, n - 1))`.
 * The prototype works in seconds and does not round; the app cuts in whole milliseconds, so `frameTimesMs` rounds.
 */

/** Clip length used when the video does not say (prototype `: 5`, seconds), in ms. */
export const FRAME_DEFAULT_DURATION_MS = 5000;
/** First frame at 12% of the clip, last at 88% (prototype `0.12 + 0.76 * k / ...`). */
export const FRAME_START = 0.12;
export const FRAME_SPAN = 0.76;
/** Frames cut from one clip (the prototype passes n = 4 from the video handler). */
export const FRAME_COUNT = 4;

/**
 * Mirrors the prototype's `dur`: a falsy (0, NaN, undefined) or non-finite duration becomes the 5 s default. A negative finite
 * duration is truthy in the prototype and is kept as is (the prototype never sees one; pinned by test).
 */
export function frameDuration(duration: number | null | undefined, fallback: number = FRAME_DEFAULT_DURATION_MS): number {
  return duration && Number.isFinite(duration) ? duration : fallback;
}

/**
 * Mirrors the prototype's `at` for k = 0 .. count - 1, unrounded, in the unit of `duration`. `count` 1 gives only the 12%
 * position (`Math.max(1, n - 1)`); 0 or less gives none.
 */
export function framePositions(duration: number | null | undefined, count: number = FRAME_COUNT): number[] {
  const dur = frameDuration(duration);
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(dur * (FRAME_START + (FRAME_SPAN * k) / Math.max(1, count - 1)));
  return out;
}

/** `framePositions` rounded to whole milliseconds, as the app's `frameTimes` cuts them. */
export function frameTimesMs(durationMs: number | null | undefined, count: number = FRAME_COUNT): number[] {
  return framePositions(durationMs, count).map((t) => Math.round(t));
}
