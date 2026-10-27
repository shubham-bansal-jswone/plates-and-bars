import { useCallback, useEffect, useState } from 'react';
import { WhyLink } from '../why/WhyLink';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { addDays, coverageRows, doneCoverage, focusPicker, plannedCoverage, toggleFocus, FOCUS_MAX, type CoverageDay, type CoverageRow, type WeekPlan } from '@plate-and-bar/core';
import { loadSets, loadWorkout, loadLifts, type WorkoutDb } from '../db/workouts';
import { loadExclusions, loadSwaps } from '../db/rules';
import { fmt } from '../format';
import { Hint, Label, Chip } from '../components/ui';
import type { Profile } from '../setup/types';
import type { Settings } from '../settings/types';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { getCatalog } from '../workout/catalog';
import { listJoin, muscleName } from '../workout/copy';
import { dayQueue, dayWrites } from '../workout/dayQueue';
import { freshRead } from '../state/freshRead';
import { useDataVersion } from '../sync/useDataVersion';
import type { Workout, WorkoutSet } from '../workout/types';

const name = (m: string) => {
  const t = muscleName(m);
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const lower = (m: string) => name(m).toLowerCase();

/** Focus muscles (prototype `focusHtml`, `focusAction`): the chips, notes and limit all come from core. */
export function FocusSection({ focus, onChange, notify }: { focus: readonly string[]; onChange: (f: readonly string[]) => void; notify: (msg: string) => void }) {
  const picker = focusPicker(focus);
  const press = (m: string) => {
    const r = toggleFocus(focus, m);
    if (r.result === 'full') return notify(`Up to ${FOCUS_MAX} focus muscles. Remove one first.`);
    onChange(r.focus);
    notify(r.focus.length ? `Focus: ${listJoin(r.focus.map(lower))}` : 'No focus muscles');
  };
  return (
    <View style={styles.gap}>
      <Label>Focus muscles</Label>
      <WhyLink id="focus" />
      <Hint>Pick up to {FOCUS_MAX}. They get an extra set, come earlier in the session, and get an exercise added on days that train that area.</Hint>
      <View style={styles.wrap} accessibilityLabel="Focus muscles">
        {picker.chips.map((ch) => (
          <Chip key={ch.muscle} label={name(ch.muscle)} pressed={ch.pressed} onPress={() => press(ch.muscle)} />
        ))}
      </View>
      {picker.absNote ? <Hint>Training abs builds them, but doesn’t burn belly fat by itself; that comes from the calorie deficit.</Hint> : null}
      {picker.volumeHint ? <Hint>Other muscles keep enough work to maintain them; aim for about 12–16 weekly sets on your focus muscles in the coverage meter.</Hint> : null}
    </View>
  );
}

/** The 7 days ending `today`, as stored (core's `doneCoverage` input). */
async function loadDays(db: WorkoutDb, today: string): Promise<CoverageDay[]> {
  const dates = Array.from({ length: 7 }, (_, k) => addDays(today, k - 6));
  return Promise.all(
    dates.map(async (date) => {
      const [workout, sets] = await Promise.all([loadWorkout(db, date), loadSets(db, date)]);
      return { date, workout: workout as Workout | null, sets: sets as WorkoutSet[] };
    }),
  );
}

/** Planned and done weekly coverage (prototype `coverageHtml` and "Done in the last 7 days"); rows come from core. */
export function CoverageSection({ db, profile, settings, today }: { db: WorkoutDb; profile: Profile; settings: Settings; today: string }) {
  const [rows, setRows] = useState<{ planned: CoverageRow[]; done: CoverageRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const { adjustments } = settings;
  // Tab screens stay mounted, so the numbers are read again each time the tab is shown (prototype rebuilds on show).
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  // A sync pull also changes the sets and rules: read again, after the Workout tab's queued writes. Exclusions and swaps
  // saved by the rules section go through its own queue, which is not awaited (read-only here; next focus catches up).
  const dataVersion = useDataVersion();
  useEffect(() => {
    let live = true;
    (async () => {
      await freshRead(
        { queue: dayQueue, writes: dayWrites },
        () => Promise.all([loadDays(db, today), loadLifts(db), loadExclusions(db), loadSwaps(db)]),
        () => live,
        ([days, lifts, exclusions, swaps]) => {
          const planned = plannedCoverage({ date: today, profile, weekPlan: adjustments.weekPlan as WeekPlan | undefined, exclusions, swaps, lifts }, getCatalog());
          setRows({ planned: coverageRows(planned), done: coverageRows(doneCoverage(today, days, getCatalog().tags)) });
        },
      );
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [db, profile, adjustments, today, shown, dataVersion]);
  return (
    <View style={styles.gap}>
      {failed ? <Hint>Couldn’t read your coverage.</Hint> : null}
      {!rows && !failed ? <Hint>Loading…</Hint> : null}
      {rows ? (
        <>
          <Meter title="Weekly coverage: your plan" rows={rows.planned} />
          <Hint>Approximate hard sets per week from your plan, counting secondary muscles as half. Around 10 is a good target for most muscles; under 6 is flagged.</Hint>
          <WhyLink id="volume" />
          <Meter title="Done in the last 7 days" rows={rows.done} />
        </>
      ) : null}
    </View>
  );
}

export function Meter({ title, rows }: { title: string; rows: CoverageRow[] }) {
  const c = useTheme();
  return (
    <View style={styles.gap} accessibilityLabel={title}>
      <Label>{title}</Label>
      {rows.map((r) => (
        <View key={r.muscle} accessible accessibilityLabel={`${title}, ${name(r.muscle)}: ${fmt(r.shown)} sets${r.low ? ', low' : ''}`} style={styles.row}>
          <Text style={[styles.muscle, { color: c.ink }]}>{name(r.muscle)}</Text>
          <View style={[styles.track, { backgroundColor: c.track }]}>
            <View style={{ width: `${r.barPct}%`, height: 8, borderRadius: radius.full, backgroundColor: r.low ? c.caution : c.bar }} />
          </View>
          <Text style={{ color: r.low ? c.caution : c.ink, fontWeight: '700', minWidth: 28, textAlign: 'right' }}>{fmt(r.shown)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8, marginTop: 16 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muscle: { width: 110, fontSize: 14 },
  track: { flex: 1, height: 8, borderRadius: radius.full, overflow: 'hidden' },
});
