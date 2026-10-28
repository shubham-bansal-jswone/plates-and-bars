import { useRef, useState, type ComponentRef, type Ref } from 'react';
import { Platform, StyleSheet, Text as RNText, View } from 'react-native';
import { sessionVolume, type LiftRecord } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Card, Heading, MetricRow, Note } from '../components/ui';
import { fmt } from '../format';
import type { WorkoutDb } from '../db/workouts';
import { radius, tabular, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { BurnLine } from './BurnLine';
import { RATE_LABEL } from './copy';
import type { ExState } from './model';
import { bestSet, buildShareCard } from './shareModel';
import { ShareCard } from './ShareCard';
import { shareWorkoutImage } from './shareImage';

const n = (s: string): number => Number(s) || 0;
const r1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * "Session done": shown while every set is ticked, read from today's exercises only. Nothing is stored and nothing is locked:
 * un-tick a set and it goes. No duration (none is stored), no streak. A personal record is core's `updateLift` result (the record's `pbToast` is today).
 */
export function CompletionPanel({ db, date, profileKg, exs, cardio, lifts, reloadKey, headingRef }: { headingRef?: Ref<ComponentRef<typeof RNText>>; db: WorkoutDb; date: string; profileKg: number; exs: readonly ExState[]; cardio: number | null; lifts: Readonly<Record<string, LiftRecord>>; reloadKey: number }) {
  const c = useTheme();
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const sets = exs.flatMap((e) => e.sets);
  const done = sets.filter((s) => s.done).length;
  if (sets.length === 0 || done !== sets.length) return null;
  const vol = sessionVolume(exs);
  const reps = sets.reduce((t, s) => t + n(s.r), 0);
  const cells = [
    { label: 'Sets', value: `${done}/${sets.length}` },
    vol > 0 ? { label: 'Volume (kg)', value: fmt(vol) } : { label: 'Reps', value: fmt(reps) },
    { label: 'Exercises', value: String(exs.length) },
    ...(cardio ? [{ label: 'Cardio (min)', value: fmt(cardio) }] : []),
  ];
  const card = buildShareCard({ date, exs, cardio, lifts });
  const share = () => {
    setShareNote(null);
    shareWorkoutImage(card, cardRef).then(
      (res) => { if (res === 'unavailable') setShareNote('Sharing is not available on this device.'); },
      () => setShareNote('Could not share the picture. Try again.'),
    );
  };
  const twoSessions = exs.some((e) => e.part === 2);
  return (
    <Card testID="completion-panel">
      <Heading ref={headingRef} level={2} style={[type.title, { color: c.ink, textAlign: 'center' }]}>Session done</Heading>
      {twoSessions ? <Text style={[type.caption, { color: c.muted }]}>Today, both sessions together.</Text> : null}
      {/* MetricRow holds 3 cells; a 4th (cardio) goes on a second row so none truncates at 360 px. */}
      <MetricRow cells={cells.slice(0, 3)} />
      {cells.length > 3 ? <MetricRow cells={cells.slice(3)} /> : null}
      {exs.map((e, i) => {
        const b = bestSet(e.sets);
        const rates = [...new Set(e.sets.flatMap((s) => (s.rate ? [RATE_LABEL[s.rate]] : [])))];
        const pr = lifts[e.name]?.pbToast === date;
        return (
          <View key={`${i}-${e.name}`} style={[styles.row, { borderColor: c.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyStrong, { color: c.ink }]}>{e.name}</Text>
              {rates.length ? <Text style={[type.caption, { color: c.muted }]}>Felt: {rates.join(', ')}</Text> : null}
            </View>
            {pr ? <Text style={[type.small, styles.pr, { backgroundColor: c.brand, color: c.onBrand }]}>Personal record</Text> : null}
            {b ? <Text style={[type.heading, tabular, { color: c.ink }]}>{n(b.w) ? `${r1(n(b.w))} x ${n(b.r)}` : `${n(b.r)} reps`}</Text> : null}
          </View>
        );
      })}
      <BurnLine db={db} date={date} profileKg={profileKg} exs={exs} cardio={cardio} reloadKey={reloadKey} />
      <Button kind="ghost" label="Share" a11yLabel="Share workout summary picture" onPress={share} />
      {shareNote ? <Note>{shareNote}</Note> : null}
      {Platform.OS === 'web' ? null : <ShareCard model={card} cardRef={cardRef} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, minHeight: 56 },
  pr: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, overflow: 'hidden' },
});
