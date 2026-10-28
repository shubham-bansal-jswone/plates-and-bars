import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LiftRecord } from '@plate-and-bar/core';
import { Text } from '../../components/Text';
import { Button, Card, Heading, Hint, MetricRow, Press } from '../../components/ui';
import { fmt, shortDate, weekdayLong } from '../../format';
import { space, tabular, type as typeScale } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { focusNode, useFocusOnMount } from '../../labelscan/focus';
import { exerciseTrend, setText, type HistorySession } from './logic';

export const HISTORY_EMPTY = 'No workouts logged yet. Your sessions will appear here.';
const FIRST = 5;

const volumeText = (kg: number): string => `${fmt(kg)} kg`;
const summary = (s: HistorySession): string => `${shortDate(s.date)}, ${s.name}, ${s.setsDone} ${s.setsDone === 1 ? 'set' : 'sets'}${s.volume > 0 ? `, ${volumeText(s.volume)}` : ''}`;

/** "Recent workouts": one row per logged day, newest first. Tap opens that day. `focusDate`: the day just closed; focus returns to its row. */
export function RecentWorkouts({ sessions, onOpen, focusDate = null }: { sessions: readonly HistorySession[]; onOpen: (date: string) => void; focusDate?: string | null }) {
  const c = useTheme();
  const rows = useRef<Record<string, ComponentRef<typeof View> | null>>({});
  useEffect(() => {
    if (focusDate) focusNode(rows.current[focusDate]);
  }, [focusDate]);
  const [all, setAll] = useState(false);
  const shown = all ? sessions : sessions.slice(0, FIRST);
  return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>Recent workouts</Heading>
      {sessions.length === 0 ? (
        <Hint>{HISTORY_EMPTY}</Hint>
      ) : (
        <>
          {shown.map((s) => (
            <Press key={s.date} ref={(n) => void (rows.current[s.date] = n)} accessibilityRole="button" accessibilityLabel={summary(s)} onPress={() => onOpen(s.date)}>
              <Card style={styles.row}>
                <View style={styles.grow}>
                  <Text style={[typeScale.bodyStrong, { color: c.ink }]}>{s.name}</Text>
                  <Text style={[typeScale.small, { color: c.muted }]}>{`${shortDate(s.date)}, ${s.setsDone} ${s.setsDone === 1 ? 'set' : 'sets'}`}</Text>
                </View>
                {s.volume > 0 ? (
                  <Text style={[typeScale.metricSm, tabular, { color: c.ink }]}>
                    {fmt(s.volume)}
                    <Text style={[typeScale.small, { color: c.muted }]}> kg</Text>
                  </Text>
                ) : null}
              </Card>
            </Press>
          ))}
          {sessions.length > FIRST ? <Button kind="ghost" label={all ? 'Show fewer' : `Show all ${sessions.length}`} onPress={() => setAll(!all)} /> : null}
        </>
      )}
    </View>
  );
}

/** One day: its exercises with the sets that were ticked, and each exercise's trend over the recent sessions. */
export function WorkoutDay({ session, sessions, lifts, onBack }: { session: HistorySession; sessions: readonly HistorySession[]; lifts: Readonly<Record<string, LiftRecord>>; onBack: () => void }) {
  const c = useTheme();
  const focus = useFocusOnMount();
  return (
    <View style={styles.section}>
      <Button kind="link" label="Back to progress" onPress={onBack} />
      <View ref={focus} accessible>
        <Heading level={2} style={[typeScale.title, { color: c.ink }]}>{session.name}</Heading>
      </View>
      <Hint>{`${weekdayLong(session.date)}, ${shortDate(session.date)}`}</Hint>
      <Card>
        <MetricRow cells={[
          { value: String(session.setsDone), label: 'sets', lime: true },
          ...(session.volume > 0 ? [{ value: fmt(session.volume), label: 'kg lifted' }] : []),
          { value: String(session.exercises.length), label: 'exercises' },
        ]} />
      </Card>
      {session.exercises.map((e) => {
        const t = exerciseTrend(sessions, e.name, lifts[e.name]);
        const max = Math.max(...t.points.map((p) => p.volume), 0);
        return (
          <Card key={e.name} style={styles.gap}>
            <Heading level={3} style={[typeScale.label, { color: c.ink }]}>{e.name}</Heading>
            {e.sets.map((s, i) => (
              <Text key={i} style={[typeScale.textBody, tabular, { color: c.body }]}>{`Set ${i + 1}: ${setText(s)}`}</Text>
            ))}
            {t.pbDate === session.date ? <Text style={[typeScale.small, { color: c.brand }]}>Personal best</Text> : null}
            {t.points.length >= 2 && max > 0 ? (
              <View accessible accessibilityRole="image" accessibilityLabel={`${e.name} volume over ${t.points.length} sessions, ${t.points.map((p) => volumeText(p.volume)).join(', ')}`}>
                <View style={styles.bars}>
                  {t.points.map((p) => (
                    <View key={p.date} style={[styles.bar, { backgroundColor: c.track }]}>
                      <View style={{ height: `${(p.volume / max) * 100}%`, backgroundColor: p.date === session.date ? c.brand : c.muted }} />
                    </View>
                  ))}
                </View>
                <Text style={[typeScale.small, { color: c.muted }]}>{`Volume, last ${t.points.length} sessions${t.heaviest ? `. Heaviest set ${fmt(t.heaviest)} kg.` : '.'}`}</Text>
              </View>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm, marginTop: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56 },
  grow: { flex: 1 },
  gap: { gap: space.xs },
  bars: { flexDirection: 'row', gap: 4, height: 56, alignItems: 'flex-end' },
  bar: { flex: 1, maxWidth: 28, height: '100%', borderRadius: 6, overflow: 'hidden', justifyContent: 'flex-end' },
});
