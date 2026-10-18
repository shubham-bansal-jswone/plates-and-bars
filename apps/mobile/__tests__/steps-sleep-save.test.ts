import { stepsSleepSave } from '../src/progress/stepsSleep';

describe('stepsSleepSave keeps the source of steps left as they were (#300)', () => {
  it('typed steps are manual', () => {
    expect(stepsSleepSave('5000', '', null)).toMatchObject({ kind: 'ok', steps: 5000, steps_source: 'manual', stepsChanged: true });
  });
  it('a phone count left alone stays device and is not rewritten', () => {
    expect(stepsSleepSave('4000', '7', { steps: 4000, steps_source: 'device' })).toMatchObject({ steps: 4000, steps_source: 'device', stepsChanged: false, sleep: 7 });
  });
  it('a phone count edited becomes manual', () => {
    expect(stepsSleepSave('4100', '', { steps: 4000, steps_source: 'device' })).toMatchObject({ steps: 4100, steps_source: 'manual', stepsChanged: true });
  });
  it('unchanged steps with no stored source read as manual', () => {
    expect(stepsSleepSave('300', '', { steps: 300 })).toMatchObject({ steps_source: 'manual', stepsChanged: false });
  });
  it('an empty box with no stored steps changes nothing; with stored steps it clears them and the source', () => {
    expect(stepsSleepSave('', '6', { steps: null })).toMatchObject({ steps: null, steps_source: null, stepsChanged: false });
    expect(stepsSleepSave('', '', { steps: 4000, steps_source: 'device' })).toMatchObject({ steps: null, steps_source: null, stepsChanged: true });
  });
  it('a bad entry is refused', () => {
    expect(stepsSleepSave('abc', '', null).kind).toBe('bad');
  });
});
