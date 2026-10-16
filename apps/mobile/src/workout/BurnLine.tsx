import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { latestWeight, workoutBurn } from '@plate-and-bar/core';
import { fmt } from '../format';
import { Hint } from '../components/ui';
import { loadWeights } from '../db/progress';
import type { WorkoutDb } from '../db/workouts';
import { WhyLink } from '../why/WhyLink';
import type { ExState } from './model';

/** Prototype `renderWorkout` burn lines: "about N kcal burned" and the rough-estimate note. Every number is core's `workoutBurn`. */
export function BurnLine({ db, date, profileKg, exs, cardio, reloadKey }: { db: WorkoutDb; date: string; profileKg: number; exs: readonly ExState[]; cardio: number | null; reloadKey: number }) {
  // undefined while the weigh-ins load, so the "add your weight" hint never flashes for someone who has a weight.
  const [kg, setKg] = useState<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadWeights(db)
      .then((w) => live && setKg(latestWeight(w, date) ?? profileKg))
      .catch(() => live && setKg(profileKg));
    return () => {
      live = false;
    };
  }, [db, date, profileKg, reloadKey]);
  const sets = exs.flatMap((e) => e.sets.map((s) => ({ kind: 'work' as const, done: s.done, t: s.t })));
  if (kg === undefined) return null;
  const wb = kg ? workoutBurn(sets, cardio, kg) : null;
  if (!wb?.sets) return !kg && sets.some((s) => s.done) ? <Hint>Add your weight (setup or Progress tab) to see calories burned.</Hint> : null;
  return (
    <View style={{ gap: 4 }}>
      <Hint>{`About ${fmt(wb.gross)} kcal burned`}</Hint>
      <Hint>
        {`Rough estimate from ${wb.timed ? `${wb.min} minutes of training` : `${wb.sets} sets (about ${wb.min} minutes)`}${wb.cardio ? ` plus ${fmt(wb.cardio)} min cardio` : ''} at your bodyweight; about ${fmt(wb.extra)} kcal of it is above what you’d burn resting. Your calorie target already includes your usual training, so there’s no need to eat it back.`}
      </Hint>
      <WhyLink id="workoutburn" />
    </View>
  );
}
