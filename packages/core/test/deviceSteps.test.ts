import { advanceSteps, isReboot, MIDNIGHT_WINDOW_MS, type StepBaseline } from '../src/index';

// No prototype or golden file covers the step sensor; these cases are worked by hand.
const base = (over: Partial<StepBaseline> = {}): StepBaseline => ({ date: '2026-03-10', steps: 1000, counter: 50000, elapsedMs: 3_600_000, ...over });
const MIN = 60_000;
const NOON = 12 * 60 * MIN;
const read = (counter: number, elapsedMs = 7_200_000) => ({ counter, elapsedMs });

describe('isReboot', () => {
  it('is false while uptime and counter only grow', () => expect(isReboot(base(), read(50100))).toBe(false));
  it('is true when uptime went backwards, even if the counter is higher', () => expect(isReboot(base(), read(90000, 1000))).toBe(true));
  it('is true when the counter went down', () => expect(isReboot(base(), read(300))).toBe(true));
  it('is false for an equal reading', () => expect(isReboot(base(), { counter: 50000, elapsedMs: 3_600_000 })).toBe(false));
});

describe('advanceSteps', () => {
  it('23:58 then 00:03 the next day: the gap is credited to the day before', () => {
    // 4 min before midnight the baseline was taken (steps so far 1000); 5 min later the reading is 3 min into the new day
    const r = advanceSteps(base(), read(50400), '2026-03-11', 3 * MIN);
    expect(r.credits).toEqual([{ date: '2026-03-10', steps: 1400 }]);
    expect(r.baseline!).toMatchObject({ date: '2026-03-11', steps: 0, counter: 50400 });
  });

  it('22:00 then 18:00 the next day: dropped, never credited to the day before', () => {
    // 500 steps before midnight and 7500 after it: 03-10 must not get 9000, and neither day gets the 8000
    const r = advanceSteps(base(), read(58000), '2026-03-11', 18 * 60 * MIN);
    expect(r.credits).toEqual([]);
    expect(r.baseline!).toMatchObject({ date: '2026-03-11', steps: 0, counter: 58000 });
  });

  it('the window is 5 minutes after midnight, inclusive', () => {
    expect(MIDNIGHT_WINDOW_MS).toBe(5 * MIN);
    expect(advanceSteps(base(), read(50400), '2026-03-11', 5 * MIN).credits).toHaveLength(1);
    expect(advanceSteps(base(), read(50400), '2026-03-11', 5 * MIN + 1).credits).toEqual([]);
  });

  it('an unusable time since midnight drops the gap', () => {
    for (const ms of [Number.NaN, -1, Number.POSITIVE_INFINITY]) expect(advanceSteps(base(), read(50400), '2026-03-11', ms).credits).toEqual([]);
  });

  it('DST spring-forward day (23 h): a reading 3 min after local midnight still credits the day before; one at 03:30 does not', () => {
    // ms since local midnight is real elapsed time, so a 23 h day needs no special case
    expect(advanceSteps(base({ date: '2026-03-28' }), read(50400), '2026-03-29', 3 * MIN).credits).toEqual([{ date: '2026-03-28', steps: 1400 }]);
    expect(advanceSteps(base({ date: '2026-03-28' }), read(50400), '2026-03-29', 2.5 * 60 * MIN).credits).toEqual([]);
  });

  it('DST fall-back day (25 h): the day before is still credited only in the window, and the day after the long day likewise', () => {
    expect(advanceSteps(base({ date: '2026-10-24' }), read(50400), '2026-10-25', 3 * MIN).credits).toEqual([{ date: '2026-10-24', steps: 1400 }]);
    // 24 h after the start of the 25 h day it is still 23:00 on 10-25 locally: the date has not changed, so it is a same-day delta
    expect(advanceSteps(base({ date: '2026-10-25' }), read(50400), '2026-10-25', 24 * 60 * MIN).credits).toEqual([{ date: '2026-10-25', steps: 1400 }]);
    expect(advanceSteps(base({ date: '2026-10-25' }), read(50400), '2026-10-26', 3 * MIN).credits).toEqual([{ date: '2026-10-25', steps: 1400 }]);
  });

  it('time zone moved east (local date +1 a few hours after the baseline): dropped, those steps are not the day before', () => {
    const r = advanceSteps(base(), read(53000), '2026-03-11', 4 * 60 * MIN);
    expect(r.credits).toEqual([]);
    expect(r.baseline!).toMatchObject({ date: '2026-03-11', steps: 0 });
  });

  it('time zone moved west (local date -1): dropped and today restarts from the new date', () => {
    const r = advanceSteps(base(), read(53000), '2026-03-09', 3 * MIN);
    expect(r.credits).toEqual([]);
    expect(r.baseline!).toMatchObject({ date: '2026-03-09', steps: 0 });
  });

  it('a reading that is not finite or is negative changes nothing, whatever the baseline', () => {
    const b = base();
    for (const bad of [read(Number.NaN), read(Number.POSITIVE_INFINITY), read(-5), read(100, Number.NaN), read(100, -1)]) {
      expect(advanceSteps(b, bad, '2026-03-10', NOON)).toEqual({ baseline: b, credits: [] });
      expect(advanceSteps(null, bad, '2026-03-10', NOON)).toEqual({ baseline: null, credits: [] });
    }
  });

  it('starts today at 0 on the first reading and writes nothing', () => {
    expect(advanceSteps(null, read(70000), '2026-03-10', NOON)).toEqual({ baseline: { date: '2026-03-10', steps: 0, counter: 70000, elapsedMs: 7_200_000 }, credits: [] });
  });

  it('adds the same-day delta and credits the new total', () => {
    expect(advanceSteps(base(), read(50850), '2026-03-10', NOON)).toEqual({ baseline: { date: '2026-03-10', steps: 1850, counter: 50850, elapsedMs: 7_200_000 }, credits: [{ date: '2026-03-10', steps: 1850 }] });
  });

  it('credits nothing when no steps were taken, but moves the baseline', () => {
    const r = advanceSteps(base(), read(50000), '2026-03-10', NOON);
    expect(r.credits).toEqual([]);
    expect(r.baseline).toEqual({ date: '2026-03-10', steps: 1000, counter: 50000, elapsedMs: 7_200_000 });
  });

  it('floors a fractional counter and ignores a non-finite one', () => {
    expect(advanceSteps(base(), read(50010.9), '2026-03-10', NOON).credits).toEqual([{ date: '2026-03-10', steps: 1010 }]);
  });

  it('after a reboot counts the new counter value as the delta', () => {
    const r = advanceSteps(base(), read(420, 600_000), '2026-03-10', NOON);
    expect(r.credits).toEqual([{ date: '2026-03-10', steps: 1420 }]);
    expect(r.baseline!).toMatchObject({ counter: 420, elapsedMs: 600_000, steps: 1420 });
  });

  it('after an unseen-looking reboot (uptime back, counter higher) still treats it as a reboot', () => {
    expect(advanceSteps(base(), read(60000, 1000), '2026-03-10', NOON).credits).toEqual([{ date: '2026-03-10', steps: 61000 }]);
  });

  it('across one midnight: credits the gap to the previous day, today restarts at 0', () => {
    const r = advanceSteps(base(), read(50700), '2026-03-11', 3 * MIN);
    expect(r.credits).toEqual([{ date: '2026-03-10', steps: 1700 }]);
    expect(r.baseline).toEqual({ date: '2026-03-11', steps: 0, counter: 50700, elapsedMs: 7_200_000 });
  });

  it('across month and year ends counts one midnight', () => {
    expect(advanceSteps(base({ date: '2026-12-31' }), read(50100), '2027-01-01', 3 * MIN).credits).toEqual([{ date: '2026-12-31', steps: 1100 }]);
    expect(advanceSteps(base({ date: '2028-02-28' }), read(50100), '2028-02-29', 3 * MIN).credits).toEqual([{ date: '2028-02-28', steps: 1100 }]);
  });

  it('across more than one midnight: drops the gap', () => {
    const r = advanceSteps(base(), read(60000), '2026-03-12', NOON);
    expect(r.credits).toEqual([]);
    expect(r.baseline!).toMatchObject({ date: '2026-03-12', steps: 0, counter: 60000 });
  });

  it('across midnight and a reboot: drops the gap', () => {
    expect(advanceSteps(base(), read(900, 500_000), '2026-03-11', 3 * MIN)).toEqual({ baseline: { date: '2026-03-11', steps: 0, counter: 900, elapsedMs: 500_000 }, credits: [] });
  });

  it('across midnight with no steps: credits nothing', () => {
    expect(advanceSteps(base(), read(50000), '2026-03-11', 3 * MIN).credits).toEqual([]);
  });

  it('clock or time zone moved west (local date goes back): restarts today at 0', () => {
    expect(advanceSteps(base(), read(50500), '2026-03-09', NOON)).toEqual({ baseline: { date: '2026-03-09', steps: 0, counter: 50500, elapsedMs: 7_200_000 }, credits: [] });
  });

  it('never lowers a day: totals only grow across readings', () => {
    let b = advanceSteps(null, read(100, 1000), '2026-03-10', NOON).baseline!;
    let last = 0;
    for (const [c, e] of [[160, 2000], [160, 3000], [400, 4000], [50, 500], [90, 900]] as const) {
      const r = advanceSteps(b, read(c, e), '2026-03-10', NOON);
      expect(r.baseline!.steps).toBeGreaterThanOrEqual(last);
      last = r.baseline!.steps;
      b = r.baseline!;
    }
    expect(last).toBe(60 + 240 + 50 + 40);
  });
});
