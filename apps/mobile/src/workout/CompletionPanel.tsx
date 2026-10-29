import { useEffect, useRef, type ComponentRef, type Ref } from 'react';
import { Platform, StyleSheet, Text as RNText, View } from 'react-native';
import { type Milestone } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Card, Heading, MetricRow, Note } from '../components/ui';
import { sessionTimeLine } from '../progress/e1rm';
import type { WorkoutDb } from '../db/workouts';
import { radius, tabular, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { BurnLine } from './BurnLine';
import { milestoneLine, PR_LABEL, RATE_LABEL, ROUTINE_COPY } from './copy';
import type { ExState } from './model';
import { buildShareCard } from './shareModel';
import { ShareCard } from './ShareCard';
import { useShareCard } from './useShareCard';
import { useWeightUnit } from '../settings/weightUnit';

/**
 * "Session done": shown while every set is ticked, read from today's exercises only. Nothing is stored and nothing is locked:
 * un-tick a set and it goes. The elapsed time is core's `sessionElapsed` over the ticks (`t`), shown only when every ticked set has one; no streak. A personal best is a lift in `prs` (`useWorkoutDay`: core's `isPrToday` over today's sets), not the record's `pbToast`.
 */
export function CompletionPanel({ earned = [], db, date, profileKg, exs, cardio, prs, settlePrs, reloadKey, headingRef, onSaveRoutine }: { /** Milestones earned in this session (#1351 A9), one line each. */ earned?: readonly Milestone[]; /** Opens "Save as routine"; absent when the session has nothing to save. */ onSaveRoutine?: () => void; headingRef?: Ref<ComponentRef<typeof RNText>>; db: WorkoutDb; date: string; profileKg: number; exs: readonly ExState[]; cardio: number | null; /** Lifts that are a personal best today. */ prs: ReadonlySet<string>; /** Resolves when `prs` has been worked out for the current sets: Share waits for it, so the picture never lacks a PR the panel shows. */ settlePrs?: () => Promise<void>; reloadKey: number }) {
  const c = useTheme();
  const { unit } = useWeightUnit();
  const { cardRef, busy, note: shareNote, share } = useShareCard();
  // What the picture is built from, as of the last commit: Share reads it after waiting for `prs`, not the render it was tapped in.
  const latest = useRef({ date, exs, cardio, prs, unit });
  useEffect(() => {
    latest.current = { date, exs, cardio, prs, unit };
  });
  const sets = exs.flatMap((e) => e.sets);
  const done = sets.filter((s) => s.done).length;
  if (sets.length === 0 || done !== sets.length) return null;
  const card = buildShareCard({ date, exs, cardio, prs, unit });
  const elapsed = sessionTimeLine(exs.flatMap((e) => [...e.ramp, ...e.sets]));
  const twoSessions = exs.some((e) => e.part === 2);
  return (
    <Card testID="completion-panel">
      <Heading ref={headingRef} level={2} style={[type.title, { color: c.ink, textAlign: 'center' }]}>Session done</Heading>
      {twoSessions ? <Text style={[type.caption, { color: c.muted }]}>Today, both sessions together.</Text> : null}
      {/* MetricRow holds 3 cells; a 4th (cardio) goes on a second row so none truncates at 360 px. */}
      <MetricRow cells={card.stats.slice(0, 3)} />
      {card.stats.length > 3 ? <MetricRow cells={card.stats.slice(3)} /> : null}
      {elapsed ? <Text testID="completion-elapsed" accessibilityLabel={`Time: ${elapsed}`} style={[type.caption, { color: c.body }]}>{`Time: ${elapsed}`}</Text> : null}
      {exs.map((e, i) => {
        const rates = [...new Set(e.sets.flatMap((s) => (s.rate ? [RATE_LABEL[s.rate]] : [])))];
        const pr = prs?.has(e.name) ?? false;
        return (
          <View key={`${i}-${e.name}`} style={[styles.row, { borderColor: c.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyStrong, { color: c.ink }]}>{e.name}</Text>
              {rates.length ? <Text style={[type.caption, { color: c.muted }]}>Felt: {rates.join(', ')}</Text> : null}
            </View>
            {pr ? <Text style={[type.small, styles.pr, { backgroundColor: c.brand, color: c.onBrand }]}>{PR_LABEL}</Text> : null}
            {card.bests[i] ? <Text style={[type.heading, tabular, { color: c.ink }]}>{card.bests[i]}</Text> : null}
          </View>
        );
      })}
      {earned.map((m) => (
        <Text key={m.id} testID="completion-milestone" accessibilityLabel={`Milestone: ${milestoneLine(m)}`} style={[type.caption, { color: c.body }]}>{`Milestone: ${milestoneLine(m)}`}</Text>
      ))}
      <BurnLine db={db} date={date} profileKg={profileKg} exs={exs} cardio={cardio} reloadKey={reloadKey} />
      <Button kind="ghost" label="Share" a11yLabel="Share workout summary picture" onPress={() => void (settlePrs ? settlePrs().then(() => new Promise((r) => setTimeout(r, 16))).catch(() => undefined).then(() => share(buildShareCard(latest.current))) : share(card))} disabled={busy} busy={busy} />
      {onSaveRoutine ? <Button kind="ghost" label={ROUTINE_COPY.action} onPress={onSaveRoutine} /> : null}
      {shareNote ? <Note>{shareNote}</Note> : null}
      {Platform.OS === 'web' ? null : <ShareCard model={card} cardRef={cardRef} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, minHeight: 56 },
  pr: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, overflow: 'hidden' },
});
