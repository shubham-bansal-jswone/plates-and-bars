import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { chartLayout, round1, type ChartBox, type TrendPoint } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { dateWithYear, shortDate } from '../format';
import { useFontFamily } from '../theme/fonts';
import { CHART_MAX_WIDTH, type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { CHART_TARGET } from './copy';

/** Smallest axis and value text, px as drawn. */
const LABEL_PX = 12;

interface Props {
  points: readonly TrendPoint[];
  box: ChartBox;
  /** Spoken description, e.g. "Weight from 82 to 80.5 kg". */
  label: string;
  /** Unit shown after the last point's value, e.g. "kg". */
  unit?: string;
  /** A reference value in the same unit as the points: drawn as a line at half opacity and named under the chart. */
  target?: number;
}

/**
 * Line chart on core's `chartLayout` (the prototype's SVG, drawn with react-native-svg), at most `CHART_MAX_WIDTH` wide. Adds the first and
 * last dates under the line (the last with its value, kept out of the plot so it never covers the line), and an optional target line. Nothing with fewer than 2 points.
 */
export function TrendChart({ points, box, label, unit, target }: Props) {
  const c = useTheme();
  const fontFamily = useFontFamily()('400');
  const [width, setWidth] = useState<number>(box.W);
  const values = points.map((p) => p.v);
  const own = chartLayout(values, box);
  // A target is laid out as one extra value so the y axis always spans it; x comes from the points alone, so a target never moves them.
  const layout = target === undefined ? own : chartLayout([...values, target], box);
  const first = points[0], last = points[points.length - 1];
  if (!own || !layout || !first || !last) return null;
  const { W, H, px, py } = box;
  const drawn = own.points.map((p, i) => ({ x: p.x, y: layout.points[i]?.y ?? p.y }));
  const line = drawn.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  // The axis labels stay LABEL_PX as drawn: the SVG is scaled to its measured width, so the size is given in viewBox units.
  const fs = LABEL_PX / Math.max(width / W, 0.1);
  const targetY = target === undefined ? null : (layout.points[layout.points.length - 1]?.y ?? null);
  const date = first.date.slice(0, 4) === last.date.slice(0, 4) ? shortDate : dateWithYear;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width || box.W);
  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View accessible accessibilityRole="image" accessibilityLabel={label}>
        <Svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ aspectRatio: W / H }}>
          <Line x1={px} x2={W} y1={py} y2={py} stroke={c.line} strokeWidth={1} />
          <Line x1={px} x2={W} y1={H - py} y2={H - py} stroke={c.line} strokeWidth={1} />
          {targetY === null ? null : <Line x1={px} x2={W} y1={targetY} y2={targetY} stroke={c.ink} strokeWidth={1} strokeOpacity={0.5} strokeDasharray="4 3" />}
          <SvgText x={0} y={py + 4} fill={c.muted} fontSize={fs} fontFamily={fontFamily}>{String(round1(layout.max))}</SvgText>
          <SvgText x={0} y={H - py + 4} fill={c.muted} fontSize={fs} fontFamily={fontFamily}>{String(round1(layout.min))}</SvgText>
          <Polyline points={line} fill="none" stroke={c.brand} strokeWidth={2} strokeLinejoin="round" />
          {drawn.map((p, i) => (
            <Circle key={points[i]?.date} cx={p.x} cy={p.y} r={3} fill={c.brand} />
          ))}
        </Svg>
        <View style={styles.dates} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[typeScale.small, { color: c.muted }]}>{date(first.date)}</Text>
          <Text style={[typeScale.small, { color: c.muted }]}>
            {date(last.date)}
            <Text style={[typeScale.small, { color: c.ink, fontWeight: '700' }]}>{` · ${unit ? `${round1(last.v)} ${unit}` : round1(last.v)}`}</Text>
          </Text>
        </View>
      </View>
      {target !== undefined && unit ? <Text style={[typeScale.small, { color: c.muted }]}>{CHART_TARGET(String(round1(target)), unit)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', maxWidth: CHART_MAX_WIDTH, gap: 4 },
  // First and last date at the two ends, under the plot.
  dates: { flexDirection: 'row', justifyContent: 'space-between' },
});
