import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { latestWeight, navyBodyFat, stepsTarget, type MeasureKey } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Card, Field, H1, Hint, Label, Page } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { fmt } from '../format';
import { BF_HINT, BF_MISSING, BF_NO_PROFILE, HOW_TO_MEASURE, MEASURES, WEIGHT_HINT } from '../progress/copy';
import { useProgress } from '../progress/useProgress';
import { useProfile } from '../state/ProfileProvider';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';

interface Props {
  db: WorkoutDb;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

const RECENT_WEIGH_INS = 7;
const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Progress tab, body data: weight entry, tape measurements with the navy body-fat estimate, and steps and sleep. */
export function ProgressScreen({ db, now = () => new Date() }: Props) {
  const { status } = useProfile();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const p = useProgress({ db, now, notify });

  const ready = status === 'ready' && p.ready;
  return (
    <View style={styles.fill}>
      <Page>
        {ready ? (
          <>
            <H1>Progress</H1>
            <WeightSection p={p} />
            <MeasureSection p={p} />
            <StepsSleepSection p={p} />
          </>
        ) : (
          <Hint>Loading…</Hint>
        )}
      </Page>
      <ToastBar message={toast} />
    </View>
  );
}

type Progress = ReturnType<typeof useProgress>;

function WeightSection({ p }: { p: Progress }) {
  const c = useTheme();
  const mine = p.weights.find((w) => w.date === p.date && !w.deleted_at);
  const [text, setText] = useState(mine ? r1(mine.weight_kg) : '');
  const latest = latestWeight(p.weights, p.date);
  const recent = p.weights.filter((w) => !w.deleted_at && w.date <= p.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_WEIGH_INS);
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typeScale.heading, { color: c.ink }]}>Body weight</Text>
      <View style={styles.inline}>
        <Field label="Weight in kg" inputMode="decimal" placeholder="kg" value={text} onChangeText={setText} />
        <Button label="Save weight" onPress={() => p.saveWeightText(text)} />
      </View>
      {latest !== null ? <Text style={{ color: c.ink }} accessibilityLabel={`Latest weigh-in ${r1(latest)} kg`}>{`Latest: ${r1(latest)} kg`}</Text> : <Hint>Log a few weigh-ins to see them here.</Hint>}
      {recent.map((w) => (
        <Card key={w.date} style={styles.row} accessible accessibilityLabel={`${w.date}, ${r1(w.weight_kg)} kg`}>
          <Text style={{ color: c.muted }}>{w.date}</Text>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{`${r1(w.weight_kg)} kg`}</Text>
        </Card>
      ))}
      <Hint>{WEIGHT_HINT}</Hint>
    </View>
  );
}

function MeasureSection({ p }: { p: Progress }) {
  const c = useTheme();
  const { profile } = useProfile();
  const mine = p.tapes.find((m) => m.date === p.date && !m.deleted_at);
  const [text, setText] = useState<Partial<Record<MeasureKey, string>>>(() => Object.fromEntries(MEASURES.map((m) => [m.key, mine?.[m.key] ? r1(mine[m.key] as number) : ''])));
  // content/measures.json: a part with a rule shows for that sex, or when entered that day.
  const hasRule = (m: (typeof MEASURES)[number]) => m.show !== 'always' && m.show.sex === profile?.sex;
  const shown = MEASURES.filter((m) => m.show === 'always' || hasRule(m) || (m.show.or_entered_that_day && !!mine?.[m.key]));
  const female = MEASURES.some(hasRule);
  const bf = navyBodyFat(profile, p.tapes, p.date);
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typeScale.heading, { color: c.ink }]}>Measurements</Text>
      {shown.map((m) => (
        <View key={m.key} style={styles.field}>
          <Label>{`${m.label} (cm)`}</Label>
          <Field label={`${m.label} in cm`} inputMode="decimal" placeholder="cm" value={text[m.key] ?? ''} onChangeText={(v) => setText({ ...text, [m.key]: v })} />
        </View>
      ))}
      <Button label="Save for today" onPress={() => p.saveTape(text)} />
      {bf !== null ? (
        <>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{`Estimated body fat: about ${fmt(bf)}%`}</Text>
          <Hint>{BF_HINT(female)}</Hint>
        </>
      ) : (
        <Hint>{profile ? BF_MISSING(female) : BF_NO_PROFILE}</Hint>
      )}
      <Hint>{`How to measure. ${HOW_TO_MEASURE}`}</Hint>
    </View>
  );
}

function StepsSleepSection({ p }: { p: Progress }) {
  const c = useTheme();
  const [steps, setSteps] = useState(p.today?.steps ? String(p.today.steps) : '');
  const [sleep, setSleep] = useState(p.today?.sleep ? String(p.today.sleep) : '');
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typeScale.heading, { color: c.ink }]}>Steps and sleep</Text>
      <Field label="Steps today" inputMode="numeric" placeholder="Steps" value={steps} onChangeText={setSteps} />
      <Hint>{`steps today, target about ${fmt(stepsTarget(p.notes, p.date))}`}</Hint>
      <Field label="Hours slept last night" inputMode="decimal" placeholder="Hours" value={sleep} onChangeText={setSleep} />
      <Hint>hours slept last night (aim for 7–9)</Hint>
      <Button label="Save steps and sleep" onPress={() => p.saveStepsSleep(steps, sleep)} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  section: { gap: 8, marginTop: 16 },
  inline: { gap: 8 },
  field: { gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
