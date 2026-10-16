import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BURN_RANGE, burnToday, latestWeight, workoutBurn, type BurnToday } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { fmt } from '../format';
import { Button, Card, Hint } from '../components/ui';
import { loadWeights } from '../db/progress';
import { loadSets, loadWorkout, type WorkoutDb } from '../db/workouts';
import type { Profile } from '../setup/types';
import { useTheme } from '../theme/useTheme';

interface Props {
  db: WorkoutDb;
  date: string;
  profile: Profile;
  /** The day's steps from its note, if any. */
  steps: number | null;
  /** Kcal eaten so far (digestion is a tenth of it). */
  kcalEaten: number;
  /** Changes when sync stored pulled records. */
  reloadKey?: number;
}

/** Prototype `energyHtml`: "Estimated burn today so far" as a range, with a Details breakdown. Everything is core's `burnToday`. */
export function BurnCard({ db, date, profile, steps, kcalEaten, reloadKey = 0 }: Props) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [facts, setFacts] = useState<{ kg: number; sets: Awaited<ReturnType<typeof loadSets>>; cardio: number | null } | null>(null);
  // Tab screens stay mounted, so a set ticked or a weigh-in added elsewhere is read again each time the tab is shown.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  useEffect(() => {
    let live = true;
    Promise.all([loadWeights(db), loadSets(db, date), loadWorkout(db, date)])
      .then(([w, sets, workout]) => live && setFacts({ kg: latestWeight(w, date) ?? profile.weight_kg, sets, cardio: workout?.cardio_min ?? null }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [db, date, profile.weight_kg, shown, reloadKey]);
  if (!facts) return null;
  const wb = workoutBurn(facts.sets, facts.cardio, facts.kg);
  const b: BurnToday = burnToday(profile, facts.kg, steps, wb, kcalEaten);
  const range = `${fmt(b.total * (1 - BURN_RANGE))}–${fmt(b.total * (1 + BURN_RANGE))} kcal`;
  // "~10% of food eaten" is the prototype's copy for `burnToday`'s digestion share. Core exports no constant for
  // it (the 0.1 is inside `burnToday`), and `BURN_RANGE` — the only exported 0.1 — is the ±10% shown around the
  // total burn, a different rule, so reusing it would tie two unrelated figures together.
  const rows: [string, string, number][] = [
    ['Resting', '', b.bmr],
    ['Daily movement', steps ? `from ${fmt(steps)} steps` : 'from your activity level', b.move],
    ['Training', wb.sets || wb.cardio ? `${wb.sets} sets${wb.cardio ? `, ${fmt(wb.cardio)} min cardio` : ''}, rough` : 'nothing logged yet', b.train],
    ['Digestion', '~10% of food eaten', b.dig],
  ];
  return (
    <Card style={styles.gap}>
      <View style={styles.head}>
        <View accessible accessibilityLabel={`Estimated burn today so far, ${range}`}>
          <Hint>Estimated burn today so far</Hint>
          <Text style={{ color: c.ink, fontWeight: '700', fontSize: 18 }}>{range}</Text>
        </View>
        <Button label={open ? 'Hide' : 'Details'} a11yLabel={open ? 'Hide burn details' : 'Show burn details'} kind="ghost" expanded={open} onPress={() => setOpen(!open)} />
      </View>
      {open ? (
        <View style={styles.gap}>
          {rows.map(([label, sub, kcal]) => (
            <View key={label} style={styles.row} accessible accessibilityLabel={`${label}${sub ? `, ${sub}` : ''}, ${fmt(kcal)} kilocalories`}>
              <Text style={{ color: c.ink, flex: 1 }}>
                {label}
                {sub ? <Text style={{ color: c.muted }}>{`  ${sub}`}</Text> : null}
              </Text>
              <Text style={{ color: c.ink, fontWeight: '700' }}>{fmt(kcal)}</Text>
            </View>
          ))}
          <Hint>Your calorie target already includes your usual training, so there’s no need to eat back workout calories. Workout and step numbers are rough estimates.</Hint>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
