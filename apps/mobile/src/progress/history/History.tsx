import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { fromKg, type WeightUnit } from '@plate-and-bar/core';
import { Text } from '../../components/Text';
import { PR_LABEL } from '../../workout/copy';
import { Button, Card, Note, Heading, Hint, MetricRow, Press } from '../../components/ui';
import { fmt, shortDate, weekdayLong } from '../../format';
import { space, tabular, type as typeScale } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { useWeightUnit } from '../../settings/weightUnit';
import { weightWithUnit } from '../../workout/unitText';
import { focusNode, useFocusOnMount } from '../../labelscan/focus';
import { blankRow, type ExState } from '../../workout/model';
import { buildShareCard } from '../../workout/shareModel';
import { ShareCard } from '../../workout/ShareCard';
import { useShareCard } from '../../workout/useShareCard';
import { getLibrary } from '../../library/exercises';
import { E1RM_NOTE, E1rmTrend } from '../E1rmTrend';
import { HISTORY_LIMIT, exerciseE1rm, exerciseTrend, setText, type HistorySession } from './logic';

export const HISTORY_EMPTY = 'No workouts logged yet. Your sessions will appear here.';
const FIRST = 5;

/** The library's exercise type, so bodyweight, time and assisted work gets no estimate; unknown names count as loaded (core's rule). */
const typeOf = (name: string) => getLibrary().find((x) => x.name === name)?.type;

/** Volume is weight x reps, so it converts like a weight. */
const volumeNumber = (kg: number, unit: WeightUnit): string => fmt(fromKg(kg, unit));
const volumeText = (kg: number, unit: WeightUnit): string => `${volumeNumber(kg, unit)} ${unit}`;
const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
const summary = (s: HistorySession, unit: WeightUnit): string => `${shortDate(s.date)}, ${s.name}, ${s.setsDone} ${s.setsDone === 1 ? 'set' : 'sets'}${s.volume > 0 ? `, ${volumeText(s.volume, unit)}` : ''}`;

/** "Recent workouts": one row per logged day, newest first. Tap opens that day. `focusDate`: the day just closed; focus returns to its row. */
export function RecentWorkouts({ sessions, onOpen, focusDate = null }: { sessions: readonly HistorySession[]; onOpen: (date: string) => void; focusDate?: string | null }) {
  const c = useTheme();
  const { unit } = useWeightUnit();
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
            <Press key={s.date} ref={(n) => void (rows.current[s.date] = n)} accessibilityRole="button" accessibilityLabel={summary(s, unit)} onPress={() => onOpen(s.date)}>
              <Card style={styles.row}>
                <View style={styles.grow}>
                  <Text style={[typeScale.bodyStrong, { color: c.ink }]}>{s.name}</Text>
                  <Text style={[typeScale.small, { color: c.muted }]}>{`${shortDate(s.date)}, ${s.setsDone} ${s.setsDone === 1 ? 'set' : 'sets'}`}</Text>
                </View>
                {s.volume > 0 ? (
                  <Text style={[typeScale.metricSm, tabular, { color: c.ink }]}>
                    {volumeNumber(s.volume, unit)}
                    <Text style={[typeScale.small, { color: c.muted }]}>{` ${unit}`}</Text>
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
export function WorkoutDay({ session, sessions, prs, onBack }: { session: HistorySession; sessions: readonly HistorySession[]; /** Lifts with a personal record this day (`prLiftsOn`, core's `personalRecords`). */ prs: ReadonlySet<string>; onBack: () => void }) {
  const c = useTheme();
  const { unit } = useWeightUnit();
  const focus = useFocusOnMount();
  const { cardRef, busy, note, share } = useShareCard();
  // The picture is built from the stored day's ticked work sets (weights are kg, as the workout screen keeps them).
  const exs: ExState[] = session.exercises.map((e) => ({
    name: e.name, part: 1, bridge: false, form: null, found: null, skipRamp: true, feel: null, ramp: [],
    sets: e.sets.map((s) => ({ ...blankRow(), w: s.w ? String(s.w) : '', r: s.r ? String(s.r) : '', done: true })),
  }));
  const card = session.finished ? buildShareCard({ date: session.date, exs, cardio: session.cardio, prs, unit, labels: session.exercises.map((e) => e.label) }) : null;
  return (
    <View style={styles.section}>
      <Button kind="link" label="Back to progress" onPress={onBack} />
      <View ref={focus} accessible>
        <Heading level={2} style={[typeScale.title, { color: c.ink }]}>{session.name}</Heading>
      </View>
      <Hint>{`${weekdayLong(session.date)}, ${shortDate(session.date)}`}</Hint>
      {session.elapsed ? <Text testID="session-elapsed" accessibilityLabel={`Time: ${session.elapsed}`} style={[typeScale.caption, { color: c.body }]}>{`Time: ${session.elapsed}`}</Text> : null}
      <Card>
        <MetricRow cells={[
          { value: String(session.setsDone), label: 'sets', lime: true, spoken: count(session.setsDone, 'set') },
          ...(session.volume > 0 ? [{ value: volumeNumber(session.volume, unit), label: `${unit} lifted`, spoken: `${volumeNumber(session.volume, unit)} ${unit} lifted` }] : []),
          { value: String(session.exercises.length), label: 'exercises', spoken: count(session.exercises.length, 'exercise') },
        ]} />
      </Card>
      {card ? (
        <>
          <Button kind="ghost" label="Share" a11yLabel={`Share summary picture of ${shortDate(session.date)}`} onPress={() => share(card)} disabled={busy} busy={busy} />
          {note ? <Note>{note}</Note> : null}
          {Platform.OS === 'web' ? null : <ShareCard model={card} cardRef={cardRef} />}
        </>
      ) : null}
      {session.exercises.map((e) => {
        const t = exerciseTrend(sessions, e.name);
        const e1 = exerciseE1rm(sessions, e.name, typeOf(e.name));
        const max = Math.max(...t.points.map((p) => p.volume), 0);
        return (
          <Card key={e.name} style={e.label ? [styles.gap, styles.member, { borderLeftColor: c.brand }] : styles.gap}>
            {e.label ? (
              <Text aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[typeScale.small, { color: c.brand }]}>{`Superset ${e.label}`}</Text>
            ) : null}
            <Heading level={3} style={[typeScale.label, { color: c.ink }]} a11yLabel={e.label ? `Superset ${e.label}: ${e.name}` : undefined}>{e.name}</Heading>
            {e.sets.map((s, i) => (
              <Text key={i} style={[typeScale.textBody, tabular, { color: c.body }]}>{`Set ${i + 1}: ${setText(s, unit)}`}</Text>
            ))}
            {prs.has(e.name) ? <Text style={[typeScale.small, { color: c.brand }]}>{PR_LABEL}</Text> : null}
            {t.points.length >= 2 && max > 0 ? (
              <View accessible accessibilityRole="image" accessibilityLabel={`${e.name} volume over ${t.points.length} sessions, ${t.points.map((p) => volumeText(p.volume, unit)).join(', ')}`}>
                <View style={styles.bars}>
                  {t.points.map((p) => (
                    <View key={p.date} style={[styles.bar, { backgroundColor: c.track }]}>
                      <View style={{ height: `${(p.volume / max) * 100}%`, backgroundColor: p.date === session.date ? c.brand : c.muted }} />
                    </View>
                  ))}
                </View>
                <Text style={[typeScale.small, { color: c.muted }]}>{`Volume, last ${t.points.length} sessions${t.heaviest ? `. Heaviest set ${weightWithUnit(t.heaviest, unit)}.` : '.'}`}</Text>
              </View>
            ) : null}
            <E1rmTrend points={e1} type={typeOf(e.name) ?? 'other'} span={`Last ${Math.min(sessions.length, HISTORY_LIMIT)} sessions`} note={false} />
          </Card>
        );
      })}
      {session.exercises.some((e) => exerciseE1rm(sessions, e.name, typeOf(e.name)).length >= 2) ? <Hint>{E1RM_NOTE}</Hint> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm, marginTop: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56 },
  grow: { flex: 1 },
  gap: { gap: space.xs },
  member: { borderLeftWidth: 4 },
  bars: { flexDirection: 'row', gap: 4, height: 56, alignItems: 'flex-end' },
  bar: { flex: 1, maxWidth: 28, height: '100%', borderRadius: 6, overflow: 'hidden', justifyContent: 'flex-end' },
});
