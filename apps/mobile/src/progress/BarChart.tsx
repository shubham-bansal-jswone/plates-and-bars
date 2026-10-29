import { Fragment, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { barLayout, round1, type ChartBox } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { dateWithYear, shortDate } from '../format';
import { useFontFamily } from '../theme/fonts';
import { CHART_MAX_WIDTH, type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ChartTable, type ChartRow } from './ChartTable';
import {
  BAR_BELOW,
  BAR_DELTA,
  BAR_NOT_LOGGED,
  BAR_PARTIAL,
  BAR_SUMMARY_BELOW,
  BAR_SUMMARY_NOT_LOGGED,
  BAR_SUMMARY_PARTIAL,
  BAR_TARGET_ROW,
  CHART_TARGET,
} from './copy';

/** Smallest axis text, px as drawn. */
const LABEL_PX = 12;
/** Inset of the below-target ring and of the hollow bar's stroke, box units. */
const RING = 2.5;

export interface Bar {
  /** The week's start date, YYYY-MM-DD. */
  label: string;
  /** Null is a gap: nothing is drawn, and it reads "Not logged", never 0. */
  value: number | null;
  /** Too few days logged to trust the average: drawn hollow and labelled. */
  partial?: boolean;
}

interface Props {
  bars: readonly Bar[];
  box: ChartBox;
  /** Spoken summary, e.g. "Average calories by week, 2,050 kcal". Gaps, partial weeks and weeks below target are added to it. */
  label: string;
  unit: string;
  /** Names the table for a screen reader ("Calories values by date"). */
  noun: string;
  /** Header of the table's value column. */
  valueHeader: string;
  /** A reference line in the unit of the values. Not drawn when 0 or less or over twice the tallest bar (the table and caption still give it). */
  target?: { value: number; caption?: string };
}

/** A bar is below target when it is logged, not partial (too few days to compare) and under the target. */
const isBelow = (b: Bar, target: number | undefined): boolean => target !== undefined && !b.partial && b.value !== null && b.value < target;

/**
 * Weekly bar chart on core's `barLayout`, at most `CHART_MAX_WIDTH` wide. Bars are `c.bar`. A null value is a gap. A partial week is hollow
 * (outline only). A week below the target keeps its fill and gets an inner ring in the page colour, and the table says "Below target", so
 * neither colour nor shape alone carries it. Under the chart: the first and last week, the target's caption, and a "Show as table" alternative.
 */
export function BarChart({ bars, box, label, unit, noun, valueHeader, target }: Props) {
  const c = useTheme();
  const fontFamily = useFontFamily()('400');
  const [width, setWidth] = useState<number>(box.W);
  const layout = barLayout(bars.map((b) => b.value), target?.value, box);
  const first = bars[0], last = bars[bars.length - 1];
  if (!layout || !first || !last) return null;
  const { W, H, px, py } = box;
  const fs = LABEL_PX / Math.max(width / W, 0.1);
  const date = first.label.slice(0, 4) === last.label.slice(0, 4) ? shortDate : dateWithYear;
  const t = target?.value;
  const note = (text: (weeks: string) => string, pick: (b: Bar) => boolean): string[] => {
    const w = bars.filter(pick).map((b) => shortDate(b.label)).join(', ');
    return w ? [text(w)] : [];
  };
  const notes = [
    ...note(BAR_SUMMARY_NOT_LOGGED, (b) => b.value === null),
    ...note(BAR_SUMMARY_PARTIAL, (b) => b.value !== null && !!b.partial),
    ...note(BAR_SUMMARY_BELOW, (b) => isBelow(b, t)),
  ];
  const spoken = [label, ...notes].join('. ');
  const rows: ChartRow[] = bars.map((b) => {
    if (b.value === null) return { date: b.label, value: BAR_NOT_LOGGED };
    const gap = t === undefined ? null : b.value - t;
    const parts = t === undefined || gap === null ? [] : [
      BAR_TARGET_ROW(String(round1(t)), unit),
      BAR_DELTA(String(round1(Math.abs(gap))), unit, round1(gap) === 0 ? 'on' : gap < 0 ? 'under' : 'over'),
      ...(isBelow(b, t) ? [BAR_BELOW] : []),
    ];
    return { date: b.label, value: `${round1(b.value)} ${unit}${b.partial ? `, ${BAR_PARTIAL}` : ''}`, note: parts.join(', ') || undefined };
  });
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width || box.W);
  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View accessible accessibilityRole="image" accessibilityLabel={spoken}>
        <Svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ aspectRatio: W / H }}>
          <Line x1={px} x2={W} y1={py} y2={py} stroke={c.line} strokeWidth={1} />
          <Line x1={px} x2={W} y1={H - py} y2={H - py} stroke={c.line} strokeWidth={1} />
          <SvgText x={0} y={py + 4} fill={c.muted} fontSize={fs} fontFamily={fontFamily}>{String(round1(layout.max))}</SvgText>
          <SvgText x={0} y={H - py + 4} fill={c.muted} fontSize={fs} fontFamily={fontFamily}>0</SvgText>
          {layout.bars.map((r, i) => {
            const b = bars[i];
            if (!r || !b) return null;
            if (b.partial) return <Rect key={b.label} testID={`bar-${b.label}`} x={r.x + 1} y={r.y + 1} width={Math.max(r.width - 2, 0)} height={Math.max(r.height - 1, 0)} fill="none" stroke={c.bar} strokeWidth={2} />;
            const ring = isBelow(b, t) && r.width > RING * 4 && r.height > RING * 4;
            return (
              <Fragment key={b.label}>
                <Rect testID={`bar-${b.label}`} x={r.x} y={r.y} width={r.width} height={r.height} fill={c.bar} />
                {ring ? <Rect testID={`ring-${b.label}`} x={r.x + RING} y={r.y + RING} width={r.width - RING * 2} height={r.height - RING * 2} fill="none" stroke={c.bg} strokeWidth={1.5} /> : null}
              </Fragment>
            );
          })}
          {layout.targetY === null ? null : <Line x1={px} x2={W} y1={layout.targetY} y2={layout.targetY} stroke={c.ink} strokeWidth={1} strokeOpacity={0.5} strokeDasharray="4 3" />}
        </Svg>
        <View style={styles.dates} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[typeScale.small, { color: c.muted }]}>{date(first.label)}</Text>
          <Text style={[typeScale.small, { color: c.muted }]}>{date(last.label)}</Text>
        </View>
      </View>
      {target ? <Text style={[typeScale.small, { color: c.muted }]}>{target.caption ?? CHART_TARGET(String(round1(target.value)), unit)}</Text> : null}
      <ChartTable rows={rows} noun={noun} valueHeader={valueHeader} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', maxWidth: CHART_MAX_WIDTH, gap: 4 },
  // First and last week at the two ends, under the plot.
  dates: { flexDirection: 'row', justifyContent: 'space-between' },
});
