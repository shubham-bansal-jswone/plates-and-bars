import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { Button, Hint, Label } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { shortDate } from '../format';
import { useTheme } from '../theme/useTheme';
import { ruleText } from '../workout/rulesCopy';
import { useRules } from '../workout/useRules';

/** Exercises avoided and swapped (prototype `rulesSectionHtml`): each can be removed, which stores a tombstone. */
export function RulesSection({ db, today, now, notify }: { db: WorkoutDb; today: string; now: () => Date; notify: (msg: string) => void }) {
  const c = useTheme();
  // Tab screens stay mounted, so the rules are read again each time the tab is shown.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  const { rules, removeRule, removeSwap } = useRules({ db, now, notify, reloadKey: shown });
  const active = rules.exclusions.filter((r) => !r.done);
  if (!active.length && !rules.swaps.length) return null;
  return (
    <View style={styles.gap}>
      <Label>Exercises and plan</Label>
      {active.length ? <Hint>Avoiding</Hint> : null}
      {active.map((r) => (
        <View key={r.id} style={styles.row}>
          <Text style={{ flex: 1, color: c.ink, fontSize: 15 }}>{ruleText(r)}</Text>
          <Button
            label="Remove"
            a11yLabel={`Remove ${ruleText(r)}`}
            kind="ghost"
            onPress={() => {
              removeRule(r.id);
              notify('Removed');
            }}
          />
        </View>
      ))}
      {rules.swaps.length ? <Hint>Swapped</Hint> : null}
      {rules.swaps.map((s) => (
        <View key={s.from} style={styles.row}>
          <Text style={{ flex: 1, color: c.ink, fontSize: 15 }}>
            {s.from} → {s.to}
            {s.bridge_until && s.bridge_until >= today ? `, bridge until ${shortDate(s.bridge_until)}` : ''}
          </Text>
          <Button
            label="Undo"
            a11yLabel={`Undo swap of ${s.from}`}
            kind="ghost"
            onPress={() => {
              removeSwap(s.from);
              notify('Swap undone');
            }}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
