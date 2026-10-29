import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { downsampleWeekly, rangeSeries, round1, trendChange, type ChartBox, type SeriesRange, type TrendPoint } from '@plate-and-bar/core';
import { Hint } from '../components/ui';
import { RANGE_NO_DATA, TREND_NONE, TREND_SUMMARY } from './copy';
import { ChartTable } from './ChartTable';
import { RANGES, RangeControl } from './RangeControl';
import { TrendChart } from './TrendChart';

const DEFAULT_RANGE: SeriesRange = '12w';

interface Props {
  /** Every point on or before `end`, oldest first, in the stored unit (kg, cm). */
  series: readonly TrendPoint[];
  /** The date being viewed: ranges count back from it. */
  end: string;
  /** Stored unit to shown unit, applied to each point and to the size of the change (so the change is taken exactly, then converted once). */
  convert: (stored: number) => number;
  unit: string;
  /** "Weight", "Waist". */
  noun: string;
  box: ChartBox;
  /** The line under the chart; the amount is already in the shown unit. */
  changeLine: (c: { direction: 'up' | 'down' | 'none'; amount: number; since: string }) => string;
  /** Shown when even All has fewer than 2 points. */
  none?: string;
}

/**
 * A trend with a 4 weeks / 12 weeks / All control, its summary sentence, the chart, the change line and a table alternative.
 * The choice lives in memory only. A range with fewer than 2 points is disabled and says so; if the chosen one is such a range
 * the next wider one is drawn instead, so the chart never goes blank while older points exist.
 */
export function RangedTrend({ series, end, convert, unit, noun, box, changeLine, none = TREND_NONE }: Props) {
  const [choice, setChoice] = useState<SeriesRange>(DEFAULT_RANGE);
  const ranged = useMemo(() => Object.fromEntries(RANGES.map((r) => [r, rangeSeries(series, end, r)])) as Record<SeriesRange, TrendPoint[]>, [series, end]);
  const disabled = new Set(RANGES.filter((r) => ranged[r].length < 2));
  if (disabled.has('all')) return <Hint>{none}</Hint>;
  const range = RANGES.slice(RANGES.indexOf(choice)).find((r) => !disabled.has(r)) ?? 'all';
  const plotted = downsampleWeekly(ranged[range], 'last');
  const shown = plotted.map((p) => ({ ...p, v: convert(p.v) }));
  const t = trendChange(plotted);
  const amount = t ? round1(convert(Math.abs(t.diff))) : 0;
  const first = shown[0], last = shown[shown.length - 1];
  const summary = first && last ? TREND_SUMMARY(noun, first.v, last.v, unit) : '';
  return (
    <View style={{ gap: 8 }}>
      <RangeControl value={range} disabled={disabled} onChange={setChoice} noun={noun} />
      {RANGES.filter((r) => disabled.has(r)).map((r) => <Hint key={r}>{RANGE_NO_DATA(r)}</Hint>)}
      <Hint>{summary}</Hint>
      <TrendChart points={shown} box={box} label={summary} unit={unit} />
      {t ? <Hint>{changeLine({ direction: amount === 0 ? 'none' : t.diff < 0 ? 'down' : 'up', amount, since: t.since })}</Hint> : null}
      <ChartTable rows={shown.map((p) => ({ date: p.date, value: `${round1(p.v)} ${unit}` }))} noun={noun} valueHeader={unit} />
    </View>
  );
}

