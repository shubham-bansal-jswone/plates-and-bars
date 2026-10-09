import { rng } from './prototype-plan';
import { loadTrend } from './prototype-trend';
import {
  addDays,
  round1,
  weightSeries,
  waistSeries,
  trendChange,
  chartLayout,
  scaleJump,
  weightEntry,
  measurementRow,
  sleepEntry,
  WEIGHT_CHART_POINTS,
  WAIST_CHART_POINTS,
  WEIGHT_CHART_BOX,
  WAIST_CHART_BOX,
  SCALE_JUMP_KG,
  SCALE_JUMP_DAYS,
  WEIGHT_ABOVE_KG,
  WEIGHT_BELOW_KG,
  TAPE_MIN_CM,
  TAPE_MAX_CM,
  SLEEP_MAX_H,
  type ChartLayout,
  type MeasureKey,
  type MeasurementFacts,
  type TrendPoint,
  type WeighIn,
} from '../src';

const proto = loadTrend();
const RUNS = 2000;
const DATE = '2026-10-07';
const KEYS = ['waist', 'neck', 'chest', 'arm', 'thigh', 'hips'] as const;

function setWeights(ws: readonly WeighIn[]): void {
  proto.S.weights.entries = Object.fromEntries(ws.filter((w) => !w.deleted_at).map((w) => [w.date, w.weight_kg]));
}
function setWaists(ms: readonly MeasurementFacts[]): void {
  proto.S.measures.entries = Object.fromEntries(ms.filter((m) => !m.deleted_at).map((m) => [m.date, { waist: m.waist_cm as number, neck: 38 }]));
}

/** The polyline and labels the prototype draws for these points and this layout. */
function chartParts(pts: readonly TrendPoint[], l: ChartLayout, unit: string): string[] {
  const vals = pts.map((p) => p.v);
  return [
    `aria-label="${unit === 'kg' ? 'Weight from' : 'From'} ${vals[0]} to ${vals[vals.length - 1]} ${unit}"`,
    `<polyline class="ln" points="${l.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>`,
    `>${round1(l.max)}</text>`,
    `>${round1(l.min)}</text>`,
  ];
}

/** Random weigh-ins over 50 days around DATE, some deleted, 1–2 decimals. */
function randomWeighIns(r: () => number, n: number): WeighIn[] {
  const ws: WeighIn[] = [];
  for (let k = 0; k < n; k++) {
    const date = addDays(DATE, Math.floor(r() * 50) - 45);
    if (ws.some((w) => w.date === date)) continue;
    ws.push({ date, weight_kg: round1(60 + r() * 30 + (r() < 0.2 ? 0 : r() * 0.04)), ...(r() < 0.1 ? { deleted_at: '2026-10-07T10:00:00Z' } : {}) });
  }
  return ws;
}

describe('weightSeries, trendChange and chartLayout', () => {
  const ws: WeighIn[] = [
    { date: '2026-10-05', weight_kg: 80 },
    { date: '2026-10-01', weight_kg: 81.2 },
    { date: '2026-10-08', weight_kg: 70 },
    { date: '2026-10-06', weight_kg: 60, deleted_at: '2026-10-06T10:00:00Z' },
  ];
  it('takes weigh-ins up to the day, oldest first, leaving out deleted ones', () => {
    expect(weightSeries(ws, DATE)).toEqual([
      { date: '2026-10-01', v: 81.2 },
      { date: '2026-10-05', v: 80 },
    ]);
    expect(trendChange(weightSeries(ws, DATE))).toEqual({ diff: 80 - 81.2, amount: 1.2, down: true, since: '2026-10-01' });
    expect(trendChange(weightSeries(ws, '2026-10-03'))).toBeNull();
    expect(trendChange([])).toBeNull();
  });
  it('keeps the last 30', () => {
    const many = Array.from({ length: 40 }, (_, k) => ({ date: addDays(DATE, -k), weight_kg: 70 + k / 10 }));
    const s = weightSeries(many, DATE);
    expect(s).toHaveLength(WEIGHT_CHART_POINTS);
    expect(s[0]).toEqual({ date: addDays(DATE, -29), v: 72.9 });
  });
  it('widens a range under 1 by 0.5 each way and needs 2 points', () => {
    expect(chartLayout([80], WEIGHT_CHART_BOX)).toBeNull();
    const l = chartLayout([80, 80.4], WEIGHT_CHART_BOX) as ChartLayout;
    expect([l.min, l.max]).toEqual([79.5, 80.9]);
    expect(l.points[0]?.x).toBe(34);
    expect(l.points[0]?.y).toBeCloseTo(16 + (0.9 * 118) / 1.4, 9);
    expect(l.points[1]?.x).toBe(312);
    const w = chartLayout([90, 85], WAIST_CHART_BOX) as ChartLayout;
    expect(w).toEqual({ min: 85, max: 90, points: [{ x: 34, y: 14 }, { x: 312, y: 116 }] });
  });
  it(`matches prototype weightChart() over ${RUNS} random weigh-in sets`, () => {
    const r = rng(233);
    let charts = 0;
    for (let i = 0; i < RUNS; i++) {
      const ws = randomWeighIns(r, Math.floor(r() * 45));
      const upTo = addDays(DATE, Math.floor(r() * 10) - 5);
      setWeights(ws);
      proto.S.date = upTo;
      const html = proto.weightChart();
      const pts = weightSeries(ws, upTo), ch = trendChange(pts), l = chartLayout(pts.map((p) => p.v), WEIGHT_CHART_BOX);
      if (!ch || !l) {
        expect(html).toBe('<p class="hint">Log a few weigh-ins to see your trend line here.</p>');
        continue;
      }
      charts++;
      for (const part of chartParts(pts, l, 'kg')) expect(html).toContain(part);
      expect(html).toContain(`<p class="hint">${ch.down ? 'Down' : 'Up'} ${ch.amount} kg since ${proto.shortDate(ch.since)}.</p>`);
    }
    expect(charts).toBeGreaterThan(RUNS / 2);
  });
  it('PINNED QUIRK (#246): no change reads "Down 0 kg"', () => {
    const ws: WeighIn[] = [{ date: '2026-10-01', weight_kg: 80 }, { date: DATE, weight_kg: 80 }];
    expect(trendChange(weightSeries(ws, DATE))).toMatchObject({ amount: 0, down: true });
    setWeights(ws);
    proto.S.date = DATE;
    expect(proto.weightChart()).toContain('Down 0 kg since');
  });
});

describe('waistSeries', () => {
  it('takes days with a nonzero waist up to the day, the last 20', () => {
    const ms: MeasurementFacts[] = [
      { date: '2026-10-03', waist_cm: 88 },
      { date: '2026-10-01', waist_cm: 90, neck_cm: 38 },
      { date: '2026-10-02', waist_cm: null, neck_cm: 38 },
      { date: '2026-10-04', waist_cm: 0 },
      { date: '2026-10-05', waist_cm: 70, deleted_at: '2026-10-05T10:00:00Z' },
      { date: '2026-10-09', waist_cm: 70 },
    ];
    const s = waistSeries(ms, DATE);
    expect(s).toEqual([
      { date: '2026-10-01', v: 90 },
      { date: '2026-10-03', v: 88 },
    ]);
    expect(trendChange(s)).toEqual({ diff: -2, amount: 2, down: true, since: '2026-10-01' });
    const many = Array.from({ length: 25 }, (_, k) => ({ date: addDays(DATE, -k), waist_cm: 80 + k }));
    expect(waistSeries(many, DATE)).toHaveLength(WAIST_CHART_POINTS);
  });
  it(`matches prototype measuresHtml()'s waist chart and change over ${RUNS} random sets`, () => {
    const r = rng(2330);
    proto.S.settings.profile = null;
    let charts = 0;
    for (let i = 0; i < RUNS; i++) {
      const ms: MeasurementFacts[] = [];
      for (let k = Math.floor(r() * 30); k > 0; k--) {
        const date = addDays(DATE, Math.floor(r() * 40) - 35);
        if (!ms.some((m) => m.date === date)) ms.push({ date, waist_cm: r() < 0.15 ? 0 : round1(70 + r() * 30) });
      }
      setWaists(ms);
      proto.S.date = DATE;
      const html = proto.measuresHtml();
      const pts = waistSeries(ms, DATE), ch = trendChange(pts), l = chartLayout(pts.map((p) => p.v), WAIST_CHART_BOX);
      if (!ch || !l) {
        expect(html).not.toContain('<h3>Waist</h3>');
        continue;
      }
      charts++;
      for (const part of chartParts(pts, l, 'cm')) expect(html).toContain(part);
      expect(html).toContain(`<p class="hint">Waist ${ch.down ? 'down' : 'up'} ${ch.amount} cm since ${proto.shortDate(ch.since)}.</p>`);
    }
    expect(charts).toBeGreaterThan(RUNS / 2);
  });
});

describe('weightEntry and scaleJump', () => {
  it('reads the box like the prototype', () => {
    expect(weightEntry('81,6')).toEqual({ kind: 'save', kg: 81.6, raw: 81.6 });
    expect(weightEntry('81.64 kg')).toEqual({ kind: 'save', kg: 81.6, raw: 81.64 });
    expect(weightEntry('  ')).toEqual({ kind: 'clear' });
    expect(weightEntry('20')).toEqual({ kind: 'bad' });
    expect(weightEntry('400')).toEqual({ kind: 'bad' });
    expect(weightEntry('abc')).toEqual({ kind: 'bad' });
    expect([WEIGHT_ABOVE_KG, WEIGHT_BELOW_KG, SCALE_JUMP_KG, SCALE_JUMP_DAYS]).toEqual([20, 400, 0.8, 3]);
  });
  it('notes a rise of 0.8 kg or more over the latest weigh-in in the 3 days before', () => {
    const ws: WeighIn[] = [
      { date: addDays(DATE, -4), weight_kg: 70 },
      { date: addDays(DATE, -3), weight_kg: 79 },
      { date: addDays(DATE, -2), weight_kg: 80 },
      { date: DATE, weight_kg: 75 },
    ];
    expect(scaleJump(ws, DATE, 81)).toEqual({ date: DATE, kg: 1 });
    expect(scaleJump(ws, DATE, 80.7)).toBeNull();
    expect(scaleJump(ws.slice(0, 1), DATE, 90)).toBeNull();
    expect(scaleJump([], DATE, 90)).toBeNull();
  });
  it(`matches the prototype's saveW (saved value, toast and note) over ${RUNS} random entries`, () => {
    const r = rng(2331);
    const texts = ['', '  ', 'abc', '0', '20', '400', '-80', '81,6', '1e2'];
    let jumps = 0;
    for (let i = 0; i < RUNS; i++) {
      const ws: WeighIn[] = [];
      for (let k = Math.floor(r() * 5); k > 0; k--) {
        const date = addDays(DATE, -Math.floor(r() * 6));
        if (!ws.some((w) => w.date === date)) ws.push({ date, weight_kg: round1(78 + r() * 4) });
      }
      const text = r() < 0.15 ? (texts[Math.floor(r() * texts.length)] as string) : (78 + r() * 5).toFixed(Math.floor(r() * 3));
      setWeights(ws);
      proto.S.date = DATE;
      proto.S.ui.scaleJump = null;
      const toast = proto.saveW(text), e = weightEntry(text);
      if (e.kind === 'save') {
        expect(toast).toBe('Weight saved');
        expect(proto.S.weights.entries[DATE]).toBe(e.kg);
        const j = scaleJump(ws, DATE, e.raw);
        expect(proto.S.ui.scaleJump ?? null).toEqual(j);
        if (j) {
          jumps++;
          expect(proto.scaleJumpHtml()).toContain(`<b>The scale went up ${round1(j.kg)} kg</b>`);
        }
      } else {
        expect(toast).toBe(e.kind === 'clear' ? 'Weight cleared' : 'Enter your weight in kg, like 81.6');
        const before = ws.find((w) => w.date === DATE)?.weight_kg;
        expect(proto.S.weights.entries[DATE]).toBe(e.kind === 'clear' ? undefined : before);
        expect(proto.S.ui.scaleJump).toBeNull();
      }
    }
    expect(jumps).toBeGreaterThan(50);
  });
  it('PINNED QUIRK (#246): the rise is not rounded, so 80.8 after 80.0 (0.7999… in floating point) gives no note', () => {
    const ws: WeighIn[] = [{ date: addDays(DATE, -1), weight_kg: 80 }];
    expect(80.8 - 80).toBeLessThan(SCALE_JUMP_KG);
    expect(scaleJump(ws, DATE, 80.8)).toBeNull();
    setWeights(ws);
    proto.S.date = DATE;
    proto.S.ui.scaleJump = null;
    proto.saveW('80.8');
    expect(proto.S.ui.scaleJump).toBeNull();
  });
  it('PINNED QUIRK (#246): the rise uses the value as typed, so 80.76 after 80.0 saves 80.8 with no note', () => {
    const ws: WeighIn[] = [{ date: addDays(DATE, -1), weight_kg: 80 }];
    const e = weightEntry('80.76');
    expect(e).toEqual({ kind: 'save', kg: 80.8, raw: 80.76 });
    expect(scaleJump(ws, DATE, 80.76)).toBeNull();
    setWeights(ws);
    proto.S.date = DATE;
    proto.S.ui.scaleJump = null;
    proto.saveW('80.76');
    expect(proto.S.weights.entries[DATE]).toBe(80.8);
    expect(proto.S.ui.scaleJump).toBeNull();
  });
  it('DEPARTURE (contract, #247): a value that rounds to 20.0 or 400.0 is bad, where the prototype saves it', () => {
    for (const [text, saved] of [['20.04', 20], ['399.96', 400]] as const) {
      expect(weightEntry(text)).toEqual({ kind: 'bad' });
      setWeights([]);
      proto.S.date = DATE;
      expect(proto.saveW(text)).toBe('Weight saved');
      expect(proto.S.weights.entries[DATE]).toBe(saved);
    }
    expect(weightEntry('20.05')).toEqual({ kind: 'save', kg: 20.1, raw: 20.05 });
    expect(weightEntry('399.94')).toEqual({ kind: 'save', kg: 399.9, raw: 399.94 });
  });
});

describe('measurementRow', () => {
  it('keeps 10–250 cm, rounded to 0.1', () => {
    expect(measurementRow({ waist_cm: '88,46', neck_cm: '', chest_cm: '9.99', arm_cm: '250', thigh_cm: '250.01', hips_cm: '10' })).toEqual({ waist_cm: 88.5, arm_cm: 250, hips_cm: 10 });
    expect(measurementRow({})).toEqual({});
    expect([TAPE_MIN_CM, TAPE_MAX_CM]).toEqual([10, 250]);
  });
  it(`matches prototype saveMeasures() over ${RUNS} random boxes`, () => {
    const r = rng(2332);
    for (let i = 0; i < RUNS; i++) {
      const boxes: Record<string, string> = {};
      for (const k of KEYS) if (r() < 0.6) boxes[k] = r() < 0.2 ? ['', 'x', '5', '300'][Math.floor(r() * 4)] as string : (5 + r() * 250).toFixed(Math.floor(r() * 3));
      proto.S.date = DATE;
      proto.S.measures.entries = {};
      const toast = proto.saveMeasures(boxes);
      const row = measurementRow(Object.fromEntries(Object.entries(boxes).map(([k, v]) => [`${k}_cm`, v])) as Partial<Record<MeasureKey, string>>);
      if (!Object.keys(row).length) {
        expect(toast).toBe('Enter at least one measurement in cm.');
        expect(proto.S.measures.entries[DATE]).toBeUndefined();
      } else {
        expect(toast).toBe('Measurements saved');
        expect(proto.S.measures.entries[DATE]).toEqual(Object.fromEntries(Object.entries(row).map(([k, v]) => [k.slice(0, -3), v])));
      }
    }
  });
});

describe('sleepEntry (contract DayNote.sleep, 0–24 h)', () => {
  it('saves 0–24 unrounded, clears on blank, rejects the rest', () => {
    expect(sleepEntry('7,5')).toEqual({ kind: 'save', h: 7.5 });
    expect(sleepEntry('7.25')).toEqual({ kind: 'save', h: 7.25 });
    expect(sleepEntry('24')).toEqual({ kind: 'save', h: 24 });
    expect(sleepEntry('0')).toEqual({ kind: 'save', h: 0 });
    expect(sleepEntry('abc')).toEqual({ kind: 'save', h: 0 });
    expect(sleepEntry(' ')).toEqual({ kind: 'clear' });
    expect(sleepEntry('24.1')).toEqual({ kind: 'bad' });
    expect(sleepEntry('-1')).toEqual({ kind: 'bad' });
    expect(SLEEP_MAX_H).toBe(24);
  });
});

describe('round1', () => {
  it('rounds to 0.1 as prototype r1', () => {
    expect([round1(81.64), round1(81.65), round1(-1.25), round1(0)]).toEqual([81.6, 81.7, -1.2, 0]);
  });
});
