/** Golden numbers from prototype `videoFrames` (plate-and-bar.html lines 3181, 3183), worked by hand. */
import { FRAME_DEFAULT_DURATION_MS, frameDuration, framePositions, frameTimesMs } from '../src/formFrames';

const close = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, 9));
};

describe('framePositions (prototype videoFrames `at`)', () => {
  it('cuts 4 frames at 12%, 37.33%, 62.67% and 88% of a 10 s clip', () => {
    close(framePositions(10), [1.2, 3.7333333333, 6.2666666667, 8.8]);
  });
  it('60 s clip in ms', () => {
    close(framePositions(60000), [7200, 22400, 37600, 52800]);
  });
  it('count 2 gives 12% and 88%; count 1 only 12%; count 0 none', () => {
    close(framePositions(10, 2), [1.2, 8.8]);
    close(framePositions(10, 1), [1.2]);
    expect(framePositions(10, 0)).toEqual([]);
  });
  it('count 3 gives 12%, 50%, 88%', () => close(framePositions(100, 3), [12, 50, 88]));
  it('a very short clip keeps the fractions, no rounding or minimum', () => {
    close(framePositions(0.5), [0.06, 0.18666666667, 0.31333333333, 0.44]);
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
  it('default count is 4', () => expect(framePositions(10)).toHaveLength(4));
});

describe('frameTimesMs', () => {
  it('rounds to whole ms', () => {
    expect(frameTimesMs(10000)).toEqual([1200, 3733, 6267, 8800]);
    expect(frameTimesMs(undefined)).toEqual([600, 1867, 3133, 4400]);
    expect(frameTimesMs(1)).toEqual([0, 0, 1, 1]);
  });
});
