import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { addDays, BURN_RANGE, bodyweightOn, burnToday, stepsTarget, workoutBurn, type BurnToday } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { fmt } from '../format';
import { dateSub } from '../state/ViewedDate';
import { Button, Card, Field, Hint } from '../components/ui';
import { loadDayNote } from '../db/food';
import { loadWeights } from '../db/progress';
import { loadSets, loadWorkout, type WorkoutDb } from '../db/workouts';
import type { Profile } from '../setup/types';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { WhyLink } from '../why/WhyLink';
import { useStoredText } from '../progress/useStoredText';

interface Props {
  db: WorkoutDb;
  date: string;
  profile: Profile;
  /** The day's steps from its note, if any. */
  steps: number | null;
  /** The day's hours slept from its note, if any. */
  sleep: number | null;
  /** Saves the two boxes on the day note (the same rule and write as Progress); false when an entry was refused. */
  onSaveStepsSleep: (steps: string, sleep: string) => boolean;
  /** Kcal eaten so far (digestion is a tenth of it). */
  kcalEaten: number;
  /** The real today: "today so far" wording shows only when `date` is it (#1123). */
  today?: string;
  /** Changes when sync stored pulled records. */
  reloadKey?: number;
}

/** Prototype `energyHtml`: "Estimated burn today so far" (on a past day, "Estimated burn on <date>") as a range, with a Details breakdown. Everything is core's `burnToday`. */
export function BurnCard({ db, date, profile, steps, sleep, onSaveStepsSleep, kcalEaten, today = date, reloadKey = 0 }: Props) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [facts, setFacts] = useState<{ kg: number; sets: Awaited<ReturnType<typeof loadSets>>; cardio: number | null; stepsGoal: number } | null>(null);
  // Tab screens stay mounted, so a set ticked or a weigh-in added elsewhere is read again each time the tab is shown.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  useEffect(() => {
    let live = true;
    const before = Array.from({ length: 7 }, (_, i) => addDays(date, i - 7));
    Promise.all([loadWeights(db), loadSets(db, date), loadWorkout(db, date), Promise.all(before.map((d) => loadDayNote(db, d)))])
      .then(([w, sets, workout, notes]) => live && setFacts({ kg: bodyweightOn(w, date, profile.weight_kg) ?? 0, sets, cardio: workout?.cardio_min ?? null, stepsGoal: stepsTarget(notes.filter((n) => n !== null), date) }))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [db, date, profile.weight_kg, shown, reloadKey]);
  // Until the first read answers, hold the card's place: it sits above the meals, so popping in later moved "+ Add to breakfast"
  // down by its height and a tap aimed at it missed (#1411). A failed read shows nothing, as before.
  if (!facts) return failed ? null : <View testID="burn-pending" aria-hidden style={[styles.pending, { backgroundColor: c.surface }]} />;
  const wb = workoutBurn(facts.sets, facts.cardio, facts.kg);
  const b: BurnToday = burnToday(profile, facts.kg, steps, wb, kcalEaten);
  const label = date === today ? 'Estimated burn today so far' : `Estimated burn on ${dateSub(date)}`;
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
        <View style={{ flexShrink: 1 }} accessible accessibilityLabel={`${label}, ${range}`}>
          <Hint>{label}</Hint>
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
          <StepsSleepInputs key={date} steps={steps} sleep={sleep} goal={facts.stepsGoal} onSave={onSaveStepsSleep} />
          <Hint>Your calorie target already includes your usual training, so there’s no need to eat back workout calories. Workout and step numbers are rough estimates.</Hint>
        </View>
      ) : null}
    </Card>
  );
}

/** Prototype's two inputs under the breakdown: steps today (with the target) and hours slept last night, each with its why-link. */
function StepsSleepInputs({ steps, sleep, goal, onSave }: { steps: number | null; sleep: number | null; goal: number; onSave: (steps: string, sleep: string) => boolean }) {
  const [s, setS] = useStoredText(steps != null ? String(steps) : ''); // 0 is a real count (#303)
  const [h, setH] = useStoredText(sleep != null ? String(sleep) : ''); // 0 h is valid (contract 0-24)
  return (
    <View style={styles.gap}>
      <Field label="Steps today" inputMode="numeric" placeholder="Steps" value={s} onChangeText={setS} />
      <Hint>{`steps today, target about ${fmt(goal)}`}</Hint>
      <WhyLink id="activity" />
      <Field label="Hours slept last night" inputMode="decimal" placeholder="Hours" value={h} onChangeText={setH} />
      <Hint>hours slept last night (aim for 7–9)</Hint>
      <WhyLink id="sleep" />
      <Button label="Save" a11yLabel="Save steps and sleep from the burn details" onPress={() => onSave(s, h)} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  /** The height of the closed card at the default text size and width (measured in the web build). */
  pending: { height: 92, borderRadius: radius.lg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
