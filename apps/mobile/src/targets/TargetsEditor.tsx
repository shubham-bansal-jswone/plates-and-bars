import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { cleanTarget, fitCarbs, macroKcal, macrosOff, RAPID_LOSS_KCAL, type TargetSet } from '@plate-and-bar/core';
import { fmt } from '../format';
import { Button, Caption, Field, Hint, Label } from '../components/ui';
import type { Profile } from '../setup/types';

const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

type Key = keyof TargetSet;
const FIELDS: [Key, string][] = [
  ['kcal', 'Calories (kcal)'],
  ['protein_g', 'Protein (g)'],
  ['carbs_g', 'Carbs (g)'],
  ['fat_g', 'Fat (g)'],
];

interface Props {
  profile: Profile;
  setProfile: (p: Profile) => Promise<void>;
  now: () => Date;
  /** Shown when the write fails. */
  notify: (msg: string) => void;
}

/**
 * Prototype `renderTargets`' "Daily targets": the four numbers are editable and saved on the profile as typed (whole
 * numbers, never below 0), and a macro total more than 50 kcal off the calories offers "Adjust carbs to match calories".
 * A later setup, recalculation or check-in suggestion writes new targets over these, as in the prototype.
 */
export function TargetsEditor({ profile, setProfile, now, notify }: Props) {
  const t = profile.targets;
  const [text, setText] = useState<Record<Key, string>>(() => ({ kcal: String(t.kcal), protein_g: String(t.protein_g), carbs_g: String(t.carbs_g), fat_g: String(t.fat_g) }));
  // Targets changed elsewhere (check-in, sync, Adjust carbs): show them. Typing "12." keeps its text while the number is the same.
  // The newest values, so two quick edits both land; `pending` counts saves in flight, while which no pulled-in value overrides what is typed.
  const latest = useRef<TargetSet>(t);
  const pending = useRef(0);
  useEffect(() => {
    if (pending.current > 0) return;
    latest.current = t;
    setText((cur) => {
      const next = { ...cur };
      for (const [k] of FIELDS) if (cleanTarget(cur[k]) !== t[k]) next[k] = String(t[k]);
      return next;
    });
  }, [t.kcal, t.protein_g, t.carbs_g, t.fat_g]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (targets: TargetSet) => {
    latest.current = targets;
    pending.current += 1;
    setProfile({ ...profile, targets, updated_at: stamp(now()) })
      .catch(() => notify('Couldn’t save that on this device. Try again.'))
      .finally(() => (pending.current -= 1));
  };
  const change = (k: Key, v: string) => {
    setText({ ...text, [k]: v });
    save({ ...latest.current, [k]: cleanTarget(v) });
  };
  const off = macrosOff(t);
  return (
    <View style={{ gap: 8, marginTop: 16 }}>
      <Label>Daily targets</Label>
      {FIELDS.map(([k, label]) => (
        <View key={k} style={{ gap: 4 }}>
          <Caption>{label}</Caption>
          <Field label={label} inputMode="numeric" value={text[k]} onChangeText={(v) => change(k, v)} />
        </View>
      ))}
      <Hint>{`Your macros add up to ${fmt(macroKcal(t))} kcal.${off ? ' That doesn’t match your calorie target.' : ''}`}</Hint>
      {off ? <Button label="Adjust carbs to match calories" kind="ghost" onPress={() => {
            const next = { ...latest.current, carbs_g: fitCarbs(latest.current) };
            setText((cur) => ({ ...cur, carbs_g: String(next.carbs_g) }));
            save(next);
          }} /> : null}
      {/* The 150 is core's `RAPID_LOSS_KCAL`: the prototype's one daily calorie-adjustment step (its `calorieCard`,
          where the app adds it back, and `renderTargets`, this hint), so the number lives in one place. */}
      <Hint>{`You can fine-tune these by hand. If your weekly average weight hasn’t moved after 2–3 weeks, lower calories by about ${RAPID_LOSS_KCAL}.`}</Hint>
    </View>
  );
}
