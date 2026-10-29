/**
 * Form check frame positions (#1011). Prototype function: `videoFrames` (prototype-final tag):
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
 * Mirrors the prototype's `dur`, in ms: a falsy (0, NaN, null, undefined) or non-finite duration becomes the 5000 ms default.
 * Prototype quirk: a negative finite duration is truthy there and is kept as is (it never sees one; pinned by test).
 */
export function frameDuration(durationMs: number | null | undefined): number {
  return durationMs && Number.isFinite(durationMs) ? durationMs : FRAME_DEFAULT_DURATION_MS;
}

/**
 * Mirrors the prototype's `at` for k = 0 .. count - 1, unrounded, with `durationMs` in ms (the prototype uses seconds; the
 * formula is the same). Unknown duration falls back to 5000 ms (see `frameDuration`, including the negative-duration quirk).
 * `count` 1 gives only the 12% position (`Math.max(1, n - 1)`); 0 or less gives none.
 */
export function framePositions(durationMs: number | null | undefined, count: number = FRAME_COUNT): number[] {
  const dur = frameDuration(durationMs);
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(dur * (FRAME_START + (FRAME_SPAN * k) / Math.max(1, count - 1)));
  return out;
}

/**
 * `framePositions` rounded to whole milliseconds. Matches the app's `frameTimes`, not the prototype quirk: a duration that is
 * not finite or is <= 0 is unknown and uses 5000 ms.
 */
export function frameTimesMs(durationMs: number | null | undefined, count: number = FRAME_COUNT): number[] {
  const dur = durationMs != null && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : FRAME_DEFAULT_DURATION_MS;
  return framePositions(dur, count).map((t) => Math.round(t));
}
