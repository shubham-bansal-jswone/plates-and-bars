import { advanceSteps, isReboot, type StepBaseline } from '../src/index';

// No prototype or golden file covers the step sensor; these cases are worked by hand.
const base = (over: Partial<StepBaseline> = {}): StepBaseline => ({ date: '2026-03-10', steps: 1000, counter: 50000, elapsedMs: 3_600_000, ...over });
const read = (counter: number, elapsedMs = 7_200_000) => ({ counter, elapsedMs });

describe('isReboot', () => {
  it('is false while uptime and counter only grow', () => expect(isReboot(base(), read(50100))).toBe(false));
  it('is true when uptime went backwards, even if the counter is higher', () => expect(isReboot(base(), read(90000, 1000))).toBe(true));
  it('is true when the counter went down', () => expect(isReboot(base(), read(300))).toBe(true));
  it('is false for an equal reading', () => expect(isReboot(base(), { counter: 50000, elapsedMs: 3_600_000 })).toBe(false));
});

describe('advanceSteps', () => {
  it('starts today at 0 on the first reading and writes nothing', () => {
    expect(advanceSteps(null, read(70000), '2026-03-10')).toEqual({ baseline: { date: '2026-03-10', steps: 0, counter: 70000, elapsedMs: 7_200_000 }, credits: [] });
  });

  it('adds the same-day delta and credits the new total', () => {
    expect(advanceSteps(base(), read(50850), '2026-03-10')).toEqual({ baseline: { date: '2026-03-10', steps: 1850, counter: 50850, elapsedMs: 7_200_000 }, credits: [{ date: '2026-03-10', steps: 1850 }] });
  });

  it('credits nothing when no steps were taken, but moves the baseline', () => {
    const r = advanceSteps(base(), read(50000), '2026-03-10');
    expect(r.credits).toEqual([]);
    expect(r.baseline).toEqual({ date: '2026-03-10', steps: 1000, counter: 50000, elapsedMs: 7_200_000 });
  });

  it('floors a fractional counter and ignores a non-finite one', () => {
    expect(advanceSteps(base(), read(50010.9), '2026-03-10').credits).toEqual([{ date: '2026-03-10', steps: 1010 }]);
    expect(advanceSteps(base(), read(Number.NaN), '2026-03-10').credits).toEqual([]);
  });

  it('after a reboot counts the new counter value as the delta', () => {
    const r = advanceSteps(base(), read(420, 600_000), '2026-03-10');
    expect(r.credits).toEqual([{ date: '2026-03-10', steps: 1420 }]);
    expect(r.baseline).toMatchObject({ counter: 420, elapsedMs: 600_000, steps: 1420 });
  });

  it('after an unseen-looking reboot (uptime back, counter higher) still treats it as a reboot', () => {
    expect(advanceSteps(base(), read(60000, 1000), '2026-03-10').credits).toEqual([{ date: '2026-03-10', steps: 61000 }]);
  });

  it('across one midnight: credits the gap to the previous day, today restarts at 0', () => {
    const r = advanceSteps(base(), read(50700), '2026-03-11');
    expect(r.credits).toEqual([{ date: '2026-03-10', steps: 1700 }]);
    expect(r.baseline).toEqual({ date: '2026-03-11', steps: 0, counter: 50700, elapsedMs: 7_200_000 });
  });

  it('across month and year ends counts one midnight', () => {
    expect(advanceSteps(base({ date: '2026-12-31' }), read(50100), '2027-01-01').credits).toEqual([{ date: '2026-12-31', steps: 1100 }]);
    expect(advanceSteps(base({ date: '2028-02-28' }), read(50100), '2028-02-29').credits).toEqual([{ date: '2028-02-28', steps: 1100 }]);
  });

  it('across more than one midnight: drops the gap', () => {
    const r = advanceSteps(base(), read(60000), '2026-03-12');
    expect(r.credits).toEqual([]);
    expect(r.baseline).toMatchObject({ date: '2026-03-12', steps: 0, counter: 60000 });
  });

  it('across midnight and a reboot: drops the gap', () => {
    expect(advanceSteps(base(), read(900, 500_000), '2026-03-11')).toEqual({ baseline: { date: '2026-03-11', steps: 0, counter: 900, elapsedMs: 500_000 }, credits: [] });
  });

  it('across midnight with no steps: credits nothing', () => {
    expect(advanceSteps(base(), read(50000), '2026-03-11').credits).toEqual([]);
  });

  it('when the clock went back before the counted day: restarts today at 0', () => {
    expect(advanceSteps(base(), read(50500), '2026-03-09')).toEqual({ baseline: { date: '2026-03-09', steps: 0, counter: 50500, elapsedMs: 7_200_000 }, credits: [] });
  });

  it('never lowers a day: totals only grow across readings', () => {
    let b = advanceSteps(null, read(100, 1000), '2026-03-10').baseline;
    let last = 0;
    for (const [c, e] of [[160, 2000], [160, 3000], [400, 4000], [50, 500], [90, 900]] as const) {
      const r = advanceSteps(b, read(c, e), '2026-03-10');
      expect(r.baseline.steps).toBeGreaterThanOrEqual(last);
      last = r.baseline.steps;
      b = r.baseline;
    }
    expect(last).toBe(60 + 240 + 50 + 40);
  });
});
