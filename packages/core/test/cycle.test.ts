import { addCycleStart, addDays, cycInfo, emptyCycle, removeLastCycleStart, sameDayLastCycle, waterRetentionPhase, type CycleData } from '../src/index';
import { prototypeSource, sliceBlock, sliceLine } from './helpers';

/** The prototype's own `cycInfo`, sliced out of the HTML, over a given stored value. */
function protoCycInfo(data: CycleData): (date: string) => unknown {
  const src = prototypeSource();
  const code = [
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const daysBetween = '),
    'const cycData = () => DATA;',
    sliceBlock(src, 'function cycInfo(date){', '}'),
    'return cycInfo;',
  ].join('\n');
  return new Function('DATA', code)(data) as (date: string) => unknown;
}

const on = (starts: string[], len = 28): CycleData => ({ on: true, starts, len });

const CASES: Record<string, CycleData> = {
  'one start, stored length': on(['2026-03-01']),
  'one start, stored length 31': on(['2026-03-01'], 31),
  'regular 28-day gaps': on(['2026-01-01', '2026-01-29', '2026-02-26', '2026-03-26']),
  'uses only the last three gaps': on(['2026-01-01', '2026-01-21', '2026-02-18', '2026-03-18', '2026-04-20']),
  'gaps outside 18 to 45 are ignored': on(['2026-01-01', '2026-01-10', '2026-03-20', '2026-04-17']),
  'only unusable gaps use the stored length': on(['2026-01-01', '2026-01-05'], 30),
  'unsorted starts': on(['2026-03-26', '2026-01-01', '2026-02-26', '2026-01-29']),
  'duplicate starts': on(['2026-02-01', '2026-02-01', '2026-03-01']),
  'turned off': { on: false, starts: ['2026-03-01'], len: 28 },
  'no starts': on([]),
};

describe('cycInfo vs the prototype', () => {
  for (const [name, data] of Object.entries(CASES)) {
    it(`${name}: every day across 150 days from the first start matches`, () => {
      const proto = protoCycInfo(data);
      const from = data.starts.slice().sort()[0] ?? '2026-01-01';
      for (let i = -3; i < 150; i++) {
        const date = addDays(from, i);
        expect({ date, info: cycInfo(data, date) }).toEqual({ date, info: proto(date) });
      }
    });
  }

  it('covers every phase and the late flag in the sweep (the differential is not vacuous)', () => {
    const seen = new Set<string>();
    let late = false;
    for (let i = 0; i < 80; i++) {
      const c = cycInfo(CASES['one start, stored length']!, addDays('2026-03-01', i));
      if (c) { seen.add(c.phase); late ||= c.late; }
    }
    expect([...seen].sort()).toEqual(['around ovulation', 'follicular', 'luteal (before your period)', 'period']);
    expect(late).toBe(true);
  });
});

describe('cycInfo worked numbers', () => {
  const d = on(['2026-01-01', '2026-01-29', '2026-02-26'], 28);
  it('day 1 is the start date, period to day 5', () => {
    expect(cycInfo(d, '2026-02-26')).toEqual({ day: 1, len: 28, phase: 'period', last: '2026-02-26', late: false });
    expect(cycInfo(d, '2026-03-02')?.phase).toBe('period');
    expect(cycInfo(d, '2026-03-03')?.phase).toBe('follicular');
  });
  it('len 28: follicular to day 11, ovulation days 12 to 16, luteal from day 17', () => {
    expect(cycInfo(d, '2026-03-08')?.phase).toBe('follicular'); // day 11
    expect(cycInfo(d, '2026-03-09')?.phase).toBe('around ovulation'); // day 12
    expect(cycInfo(d, '2026-03-13')?.phase).toBe('around ovulation'); // day 16
    expect(cycInfo(d, '2026-03-14')?.phase).toBe('luteal (before your period)'); // day 17
  });
  it('late after len + 7 days', () => {
    expect(cycInfo(d, '2026-04-01')?.late).toBe(false); // day 35, not more than 35
    expect(cycInfo(d, '2026-04-02')?.late).toBe(true); // day 36
  });
  it('null before the first start, or when off or empty', () => {
    expect(cycInfo(d, '2025-12-31')).toBeNull();
    expect(cycInfo({ ...d, on: false }, '2026-03-01')).toBeNull();
    expect(cycInfo(emptyCycle(), '2026-03-01')).toBeNull();
  });
  it('ignores starts after the date', () => {
    expect(cycInfo(d, '2026-01-10')).toMatchObject({ last: '2026-01-01', day: 10 });
  });
});

describe('cycle helpers', () => {
  it('waterRetentionPhase is true for period and luteal only', () => {
    const d = on(['2026-03-01']);
    const by = (n: number) => cycInfo(d, addDays('2026-03-01', n - 1))!;
    expect([1, 5, 6, 11, 12, 16, 17, 28].map((n) => waterRetentionPhase(by(n)))).toEqual([true, true, false, false, false, false, true, true]);
  });
  it('sameDayLastCycle: the same cycle day one cycle earlier', () => {
    const c = cycInfo(on(['2026-02-01', '2026-03-01']), '2026-03-10')!; // day 10, len 28
    expect(sameDayLastCycle(c)).toBe('2026-02-10');
  });
  it('addCycleStart keeps the list sorted, adds once, and does not mutate', () => {
    const d = on(['2026-03-01']);
    const a = addCycleStart(d, '2026-01-01');
    expect(a.starts).toEqual(['2026-01-01', '2026-03-01']);
    expect(addCycleStart(a, '2026-01-01').starts).toEqual(a.starts);
    expect(d.starts).toEqual(['2026-03-01']);
  });
  it('removeLastCycleStart drops the latest start, and empty stays empty', () => {
    expect(removeLastCycleStart(on(['2026-03-01', '2026-01-01'])).starts).toEqual(['2026-01-01']);
    expect(removeLastCycleStart(on([])).starts).toEqual([]);
  });
  it('emptyCycle is off with the default length of 28', () => {
    expect(emptyCycle()).toEqual({ on: false, starts: [], len: 28 });
  });
});
