import { StyleSheet, View } from 'react-native';
import { weekSummary, type ProgressDay } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Card, Heading, Hint } from '../components/ui';
import { dayName, fmt, shortDate } from '../format';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { MetricRow } from './Metrics';
import { WEEK_AVG_KCAL, WEEK_AVG_PROTEIN, WEEK_LOADING, WEEK_NOT_LOGGED, WEEK_SESSIONS, WEEK_TARGET_HINT, WEEK_TITLE, WEEK_TRAINED } from './copy';

interface Props {
  date: string;
  /** Days read for the check-in, null while loading. */
  days: readonly ProgressDay[] | null;
  kcalTarget: number;
}

/** Progress tab, last block: "Seven days to <date>" (prototype `renderProgress`): a calorie bar per day with its day letter under it, then averages and sessions. */
export function WeekCard({ date, days, kcalTarget }: Props) {
  const c = useTheme();
  const w = days ? weekSummary(days, date, kcalTarget) : null;
  return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{WEEK_TITLE(shortDate(date))}</Heading>
      {!w ? (
        <Hint>{WEEK_LOADING}</Hint>
      ) : (
        <>
          <Card style={styles.chart}>
            {w.days.map((d) => (
              <View
                key={d.date}
                style={styles.col}
                accessible
                accessibilityRole="image"
                // Matches the prototype's bar label (#503, #588): the day, ", trained" when it was, then the kcal and
                // protein, or "not logged" on a blank day. A test asserts this string.
                accessibilityLabel={`${dayName(d.date)}${d.trained ? `, ${WEEK_TRAINED}` : ''}, ${d.logged ? `${fmt(d.kcal)} kcal, ${fmt(d.protein_g)} g protein` : WEEK_NOT_LOGGED}`}
              >
                <View style={[styles.bar, { backgroundColor: c.track }]}>
                  <View style={[styles.fill, { height: `${d.fillPct}%`, backgroundColor: d.over ? c.caution : c.bar }]} />
                  <View style={[styles.tgt, { bottom: `${d.targetPct}%`, backgroundColor: c.ink }]} />
                </View>
                <Text style={[typeScale.small, { color: d.trained ? c.brand : c.muted }]}>{dayName(d.date).slice(0, 1)}</Text>
                <View style={[styles.dot, { backgroundColor: d.trained ? c.brand : 'transparent' }]} />
              </View>
            ))}
          </Card>
          <MetricRow
            items={[
              { big: w.avgKcal === null ? '–' : fmt(w.avgKcal), label: WEEK_AVG_KCAL },
              { big: w.avgProtein_g === null ? '–' : `${fmt(w.avgProtein_g)} g`, label: WEEK_AVG_PROTEIN },
              { big: String(w.sessions), label: WEEK_SESSIONS },
            ]}
          />
          <Hint>{WEEK_TARGET_HINT}</Hint>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 16 },
  chart: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'center', gap: 4 },
  bar: { width: '100%', maxWidth: 28, height: 96, borderRadius: 8, overflow: 'hidden', justifyContent: 'flex-end' },
  // The fill is the data mark, so it stays near-solid: dropping it further against `track` falls under the 3:1 bars need.
  fill: { width: '100%', opacity: 0.85 },
  // The target mark is a quieter line than the fill, so it keeps half opacity. A test asserts it.
  tgt: { position: 'absolute', left: 0, right: 0, height: 2, opacity: 0.5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
