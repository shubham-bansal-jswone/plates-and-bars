import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { weeksOnTrackSeries, type PlanProfile, type SessionLog } from '@plate-and-bar/core';
import { Card, Heading, Hint } from '../components/ui';
import { radius, space, type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { WEEKS_COUNT, WEEKS_EMPTY, WEEKS_TITLE } from './copy';

export const WEEKS_SHOWN = 12;

/** Progress tab: the last 12 completed weeks as ticks, filled when the week met the session goal (the rule of `habits()`), no streak. */
export function WeeksOnTrack({ sessions, date, profile }: { /** From `useCheckin`, the log `habits()` counts, so the strip and "N weeks in a row" agree. Null until read. */ sessions: SessionLog | null; date: string; profile: PlanProfile | null }) {
  const c = useTheme();
  const weeks = useMemo(() => (sessions ? weeksOnTrackSeries(sessions, profile, date, WEEKS_SHOWN) : null), [sessions, profile, date]);
  if (!weeks) return null;
  // No session in any of the 12 weeks: a row of empty ticks would read as a verdict, so say when it will fill instead.
  const any = weeks.some((w) => w.sessions > 0);
  const sentence = WEEKS_COUNT(weeks.filter((w) => w.onTrack).length, weeks.length);
  return (
    <Card style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{WEEKS_TITLE}</Heading>
      {any ? (
        <>
          <View accessible accessibilityRole="image" accessibilityLabel={sentence} style={styles.row}>
            {weeks.map((w) => (
              // Filled is on track, outlined only is not: shape and fill carry it, not colour alone.
              <View
                key={w.weekStart}
                testID={w.onTrack ? 'week-on' : 'week-off'}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[styles.tick, { borderColor: c.ink, backgroundColor: w.onTrack ? c.ink : 'transparent' }]}
              />
            ))}
          </View>
          {/* The image label says the same: hidden here so a screen reader reads it once. */}
          <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Hint>{sentence}</Hint></View>
        </>
      ) : (
        <Hint>{WEEKS_EMPTY}</Hint>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm, marginTop: space.lg },
  row: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  tick: { flex: 1, maxWidth: 24, height: 28, borderRadius: radius.sm / 2, borderWidth: 2 },
});
