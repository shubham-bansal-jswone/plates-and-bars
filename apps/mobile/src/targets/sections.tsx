import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { WorkoutDb } from '../db/workouts';
import { fmt } from '../format';
import { Hint, Label } from '../components/ui';
import type { Profile } from '../setup/types';
import type { Settings } from '../settings/types';
import { useTheme } from '../theme/useTheme';
import { MUSCLE } from '../workout/copy';
import { Chip } from '../workout/parts';
import type { CoverageRow, TargetsRules } from './rules';

const name = (m: string) => {
  const t = MUSCLE[m] ?? m;
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Focus muscles (prototype `focusHtml`): chips for the muscles core offers; core decides what a tap does. */
export function FocusSection({ rules, focus, onChange, notify }: { rules: TargetsRules; focus: readonly string[]; onChange: (f: readonly string[]) => void; notify: (msg: string) => void }) {
  const press = (m: string) => {
    const next = rules.toggleFocus(focus, m);
    if (!next) return notify(`Up to ${rules.focusMax} focus muscles. Remove one first.`);
    notify(next.length ? `Focus: ${next.map((x) => name(x).toLowerCase()).join(', ')}` : 'No focus muscles');
    onChange(next);
  };
  return (
    <View style={styles.gap}>
      <Label>Focus muscles</Label>
      <Hint>Pick up to {rules.focusMax}. They get an extra set, come earlier in the session, and get an exercise added on days that train that area.</Hint>
      <View style={styles.wrap} accessibilityLabel="Focus muscles">
        {rules.focusChoices.map((m) => (
          <Chip key={m} label={name(m)} pressed={focus.includes(m)} onPress={() => press(m)} />
        ))}
      </View>
      {focus.length ? <Hint>Other muscles keep enough work to maintain them. Check your focus muscles in the coverage meter below.</Hint> : null}
    </View>
  );
}

/** Weekly coverage, planned and done (prototype `coverageHtml` and "Done in the last 7 days"). */
export function CoverageSection({ rules, db, profile, settings, today }: { rules: TargetsRules; db: WorkoutDb; profile: Profile; settings: Settings; today: string }) {
  const c = useTheme();
  const [rows, setRows] = useState<CoverageRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    rules
      .coverage({ db, profile, settings, today })
      .then((r) => live && setRows(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [rules, db, profile, settings, today]);
  const top = Math.max(1, ...(rows ?? []).map((r) => Math.max(r.planned, r.done)));
  return (
    <View style={styles.gap}>
      <Label>Weekly coverage</Label>
      {failed ? <Hint>Couldn’t read your coverage.</Hint> : null}
      {!rows && !failed ? <Hint>Loading…</Hint> : null}
      {rows?.map((r) => (
        <View key={r.muscle} accessible accessibilityLabel={`${name(r.muscle)}: ${fmt(r.planned)} sets planned, ${fmt(r.done)} done${r.low ? ', low' : ''}`} style={styles.row}>
          <Text style={[styles.muscle, { color: c.ink }]}>{name(r.muscle)}</Text>
          <View style={styles.bars}>
            <View style={[styles.track, { backgroundColor: c.track }]}>
              <View style={{ width: `${(r.planned / top) * 100}%`, height: 8, borderRadius: 4, backgroundColor: r.low ? c.danger : c.brand }} />
            </View>
            <View style={[styles.track, { backgroundColor: c.track }]}>
              <View style={{ width: `${(r.done / top) * 100}%`, height: 8, borderRadius: 4, backgroundColor: c.carbs }} />
            </View>
          </View>
          <Text style={{ color: r.low ? c.danger : c.ink, fontWeight: '700', minWidth: 64, textAlign: 'right' }}>
            {fmt(r.done)} / {fmt(r.planned)}
          </Text>
        </View>
      ))}
      {rows ? <Hint>Hard sets this week: done out of planned. Secondary muscles count as half.</Hint> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8, marginTop: 16 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muscle: { width: 110, fontSize: 14 },
  bars: { flex: 1, gap: 3 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
});
