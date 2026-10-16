import { feelResult, isLearning, priorSessions, showFeel } from '../src/index';
import { loadFeel } from './prototype-feel';

const proto = loadFeel();
const DATE = '2026-10-07';
const W: [string, string][] = [['Front of shoulders', 'Lower the seat a notch.'], ['Mostly triceps', 'Let the handles come back.']];
proto.S.date = DATE;
proto.CARDS['Press'] = { f: 'Chest, front of shoulders', w: W };

const lifts: Record<string, { date: string; n?: number; prev?: object | null } | undefined> = {
  none: undefined,
  once: { date: '2026-10-01', n: 1 },
  twice: { date: '2026-10-01', n: 2 },
  thrice: { date: '2026-10-01', n: 3 },
  today1: { date: DATE, n: 1 },
  today3: { date: DATE, n: 3 },
  today4: { date: DATE, n: 4 },
  oldPrev: { date: '2026-10-01', prev: {} },
  oldNoPrev: { date: '2026-10-01' },
  oldToday: { date: DATE, prev: {} },
};

describe('learn mode (prototype priorSessions, learning)', () => {
  it.each(Object.keys(lifts))('matches the prototype for %s', (k) => {
    proto.S.lifts = lifts[k] ? { Press: lifts[k] } : {};
    expect(priorSessions(lifts[k], DATE)).toBe(proto.priorSessions('Press'));
    expect(isLearning(true, lifts[k], DATE)).toBe(proto.learning('Press'));
  });
  it('is off without a guide card', () => {
    expect(isLearning(false, undefined, DATE)).toBe(false);
    expect(proto.learning('No card')).toBe(false);
  });
  it('ends at the third earlier session', () => {
    expect(isLearning(true, lifts.twice, DATE)).toBe(true);
    expect(isLearning(true, lifts.thrice, DATE)).toBe(false);
    expect(isLearning(true, lifts.today3, DATE)).toBe(true); // today's own session is not an earlier one
    expect(isLearning(true, lifts.today4, DATE)).toBe(false);
  });
});

describe('the feel step (prototype feelHtml)', () => {
  const ex = (feel: string | undefined, done: boolean[]) => ({ name: 'Press', feel, sets: done.map((d) => ({ done: d })) });
  it('shows only in learn mode with a set done', () => {
    proto.S.lifts = {};
    expect(showFeel(true, false)).toBe(false);
    expect(proto.feelHtml(ex(undefined, [false, false]), 0)).toBe('');
    expect(showFeel(false, true)).toBe(false);
    expect(showFeel(true, true)).toBe(true);
    expect(proto.feelHtml(ex(undefined, [true, false]), 0)).toContain('Where did you feel that set most?');
    proto.S.lifts = { Press: lifts.thrice };
    expect(proto.feelHtml(ex(undefined, [true]), 0)).toBe('');
  });
  it.each([
    [undefined, 'ask', 'Where did you feel that set most?'],
    ['target', 'target', 'Felt it in the right place. Good.'],
    ['pain', 'pain', 'Stop this exercise for today.'],
    ['0', 'elsewhere', W[0]![1]],
    ['1', 'elsewhere', W[1]![1]],
  ])('answer %s', (feel, kind, text) => {
    proto.S.lifts = {};
    expect(feelResult(feel, W).kind).toBe(kind);
    expect(proto.feelHtml(ex(feel, [true]), 0)).toContain(text);
  });
  it('an index with no fix shows nothing, as the prototype does', () => {
    proto.S.lifts = {};
    expect(feelResult('7', W)).toEqual({ kind: 'elsewhere', fix: '' });
    expect(proto.feelHtml(ex('7', [true]), 0)).toBe('');
    expect(feelResult('x', W)).toEqual({ kind: 'elsewhere', fix: '' });
    expect(feelResult('0', W)).toEqual({ kind: 'elsewhere', fix: W[0]![1] });
  });
  it('pain offers an alternative, and skipping only while sets are undone', () => {
    proto.S.lifts = {};
    expect(proto.feelHtml(ex('pain', [true, false]), 0)).toContain('Skip remaining sets');
    expect(proto.feelHtml(ex('pain', [true, true]), 0)).not.toContain('Skip remaining sets');
    expect(proto.feelHtml(ex('pain', [true]), 0)).toContain('Find an alternative');
  });
});
