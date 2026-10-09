import { View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { chartLayout, round1, type ChartBox, type TrendPoint } from '@plate-and-bar/core';
import { useTheme } from '../theme/useTheme';

interface Props {
  points: readonly TrendPoint[];
  box: ChartBox;
  /** Spoken description, e.g. "Weight from 82 to 80.5 kg". */
  label: string;
}

/** Line chart on core's `chartLayout` (the prototype's SVG, drawn with react-native-svg). Nothing with fewer than 2 points. */
export function TrendChart({ points, box, label }: Props) {
  const c = useTheme();
  const layout = chartLayout(points.map((p) => p.v), box);
  if (!layout) return null;
  const { W, H, px, py } = box;
  const line = layout.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ aspectRatio: W / H }}>
        <Line x1={px} x2={W} y1={py} y2={py} stroke={c.line} strokeWidth={1} />
        <Line x1={px} x2={W} y1={H - py} y2={H - py} stroke={c.line} strokeWidth={1} />
        <SvgText x={0} y={py + 4} fill={c.muted} fontSize={11}>{String(round1(layout.max))}</SvgText>
        <SvgText x={0} y={H - py + 4} fill={c.muted} fontSize={11}>{String(round1(layout.min))}</SvgText>
        <Polyline points={line} fill="none" stroke={c.brand} strokeWidth={2} strokeLinejoin="round" />
        {layout.points.map((p, i) => (
          <Circle key={points[i]?.date} cx={p.x} cy={p.y} r={3} fill={c.brand} />
        ))}
      </Svg>
    </View>
  );
}
