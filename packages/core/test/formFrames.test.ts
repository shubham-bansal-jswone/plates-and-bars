/** Worked from the prototype `videoFrames` (plate-and-bar.html lines 3181, 3183); no fixture exists in docs/spec/golden. */
import { FRAME_DEFAULT_DURATION_MS, frameDuration, framePositions, frameTimesMs } from '../src/formFrames';

const close = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, 9));
};

describe('framePositions (prototype videoFrames `at`)', () => {
  it('cuts 4 frames at 12%, 37.33%, 62.67% and 88% of a 10 s clip (ms)', () => {
    close(framePositions(10000), [1200, 3733.33333333333, 6266.66666666667, 8800]);
  });
  it('60 s clip', () => {
    close(framePositions(60000), [7200, 22400, 37600, 52800]);
  });
  it('count 2 gives 12% and 88%; count 1 only 12%; count 0 none', () => {
    close(framePositions(10000, 2), [1200, 8800]);
    close(framePositions(10000, 1), [1200]);
    expect(framePositions(10000, 0)).toEqual([]);
  });
  it('count 3 gives 12%, 50%, 88%', () => close(framePositions(100, 3), [12, 50, 88]));
  it('a very short clip (500 ms) keeps the fractions, no rounding or minimum', () => {
    close(framePositions(500), [60, 186.666666666667, 313.333333333333, 440]);
  });
  it('0, NaN, null, undefined and non-finite durations use the 5000 ms default', () => {
    const d = framePositions(FRAME_DEFAULT_DURATION_MS);
    for (const v of [0, NaN, null, undefined, Infinity, -Infinity]) expect(framePositions(v)).toEqual(d);
    close(d, [600, 1866.66666666667, 3133.33333333333, 4400]);
  });
  it('pins prototype: a negative finite duration is kept (truthy in the prototype)', () => {
    expect(frameDuration(-10)).toBe(-10);
    close(framePositions(-10, 2), [-1.2, -8.8]);
  });
  it('default count is 4', () => expect(framePositions(10000)).toHaveLength(4));
});

describe('frameTimesMs', () => {
  it('rounds to whole ms', () => {
    expect(frameTimesMs(10000)).toEqual([1200, 3733, 6267, 8800]);
    expect(frameTimesMs(undefined)).toEqual([600, 1867, 3133, 4400]);
    expect(frameTimesMs(1)).toEqual([0, 0, 1, 1]);
  });
  it('matches the app frameTimes: a duration that is not finite or is <= 0 is unknown (5000 ms)', () => {
    for (const v of [-10, -1, -5000, 0, NaN, null, undefined, Infinity, -Infinity]) expect(frameTimesMs(v)).toEqual([600, 1867, 3133, 4400]);
  });
});
