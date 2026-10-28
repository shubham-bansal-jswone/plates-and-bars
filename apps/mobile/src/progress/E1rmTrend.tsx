import { View } from 'react-native';
import { E1RM_MAX_REPS, WEIGHT_CHART_BOX, type E1rmPoint, type ExType } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { e1rmSummary } from './e1rm';
import { TrendChart } from './TrendChart';

export const E1RM_NOTE = `An estimate from your done work sets of ${E1RM_MAX_REPS} reps or fewer: weight x (1 + reps / 30).`;

/** Estimated 1-rep max per session as a line, with its spoken summary shown as text too. Nothing under 2 points. */
export function E1rmTrend({ points, type, span, note = true }: { points: readonly E1rmPoint[]; type: ExType; /** Where the points come from, e.g. "Last 20 sessions". */ span?: string; /** Show the formula note (a screen shows it once, not per chart). */ note?: boolean }) {
  const c = useTheme();
  const summary = e1rmSummary(points, type);
  if (!summary) return null;
  return (
    <View testID="e1rm-trend" style={{ gap: 4 }}>
      <TrendChart points={points.map((p) => ({ date: p.date, v: p.e1rm }))} box={WEIGHT_CHART_BOX} label={summary} />
      <Text importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[typeScale.small, { color: c.body }]}>{summary}</Text>
      {span ? <Text style={[typeScale.caption, { color: c.muted }]}>{span}</Text> : null}
      {note ? <Text style={[typeScale.caption, { color: c.muted }]}>{E1RM_NOTE}</Text> : null}
    </View>
  );
}
