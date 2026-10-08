import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { addDays, coverageRows, doneCoverage, focusPicker, plannedCoverage, toggleFocus, FOCUS_MAX, type CoverageDay, type CoverageRow, type WeekPlan } from '@plate-and-bar/core';
import { loadSets, loadWorkout, loadLifts, type WorkoutDb } from '../db/workouts';
import { fmt } from '../format';
import { Hint, Label } from '../components/ui';
import type { Profile } from '../setup/types';
import type { Settings } from '../settings/types';
import { useTheme } from '../theme/useTheme';
import { catalog } from '../workout/catalog';
import { MUSCLE } from '../workout/copy';
import { Chip } from '../workout/parts';
import type { Workout, WorkoutSet } from '../workout/types';

const name = (m: string) => {
  const t = MUSCLE[m] ?? m;
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
    notify(r.focus.length ? `Focus: ${r.focus.map(lower).join(', ')}` : 'No focus muscles');
  };
  return (
    <View style={styles.gap}>
      <Label>Focus muscles</Label>
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
  useEffect(() => {
    let live = true;
    (async () => {
      const [days, lifts] = await Promise.all([loadDays(db, today), loadLifts(db)]);
      if (!live) return;
      // Exclusions and swaps are not stored in the app yet, so none are passed.
      const planned = plannedCoverage({ date: today, profile, weekPlan: adjustments.weekPlan as WeekPlan | undefined, lifts }, catalog);
      setRows({ planned: coverageRows(planned), done: coverageRows(doneCoverage(today, days, catalog.tags)) });
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [db, profile, adjustments, today]);
  return (
    <View style={styles.gap}>
      {failed ? <Hint>Couldn’t read your coverage.</Hint> : null}
      {!rows && !failed ? <Hint>Loading…</Hint> : null}
      {rows ? (
        <>
          <Meter title="Weekly coverage: your plan" rows={rows.planned} />
          <Hint>Approximate hard sets per week from your plan, counting secondary muscles as half. Around 10 is a good target for most muscles; under 6 is flagged.</Hint>
          <Meter title="Done in the last 7 days" rows={rows.done} />
        </>
      ) : null}
    </View>
  );
}

function Meter({ title, rows }: { title: string; rows: CoverageRow[] }) {
  const c = useTheme();
  return (
    <View style={styles.gap} accessibilityLabel={title}>
      <Label>{title}</Label>
      {rows.map((r) => (
        <View key={r.muscle} accessible accessibilityLabel={`${title}, ${name(r.muscle)}: ${fmt(r.shown)} sets${r.low ? ', low' : ''}`} style={styles.row}>
          <Text style={[styles.muscle, { color: c.ink }]}>{name(r.muscle)}</Text>
          <View style={[styles.track, { backgroundColor: c.track }]}>
            <View style={{ width: `${r.barPct}%`, height: 8, borderRadius: 4, backgroundColor: r.low ? c.danger : c.brand }} />
          </View>
          <Text style={{ color: r.low ? c.danger : c.ink, fontWeight: '700', minWidth: 28, textAlign: 'right' }}>{fmt(r.shown)}</Text>
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
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
});
