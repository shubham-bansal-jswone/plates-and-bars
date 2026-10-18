import { useCallback, useEffect, useRef, useState } from 'react';
import { WhyLink } from '../why/WhyLink';
import { DailyRead } from '../why/DailyRead';
import { useOptionalSettings } from '../state/SettingsProvider';
import { profileWhyValues } from '../why/values';
import { StyleSheet, View } from 'react-native';
import { DEFAULT_KCAL_TARGET, round1, waterRetentionPhase, latestWeight, navyBodyFat, stepsTarget, trendChange, waistSeries, weightSeries, WAIST_CHART_BOX, WEIGHT_CHART_BOX, type MeasureKey } from '@plate-and-bar/core';
import { useDataVersion } from '../sync/useDataVersion';
import { useStepsVersion } from '../steps/DeviceStepsProvider';
import { Text } from '../components/Text';
import { Heading, Button, Caption, Card, Field, H1, Hint, Page } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { fmt, shortDate } from '../format';
import { BF_HINT, BF_MISSING, BF_NO_PROFILE, HOW_TO_MEASURE, getMeasures, SCALE_JUMP_BODY, SCALE_JUMP_TITLE, TREND_NONE, WEIGHT_HINT } from '../progress/copy';
import { CheckinCard, RapidLossCard } from '../progress/CheckinCard';
import { WeekCard } from '../progress/WeekCard';
import { useCheckin } from '../progress/useCheckin';
import { TrendChart } from '../progress/TrendChart';
import { useProgress } from '../progress/useProgress';
import { useStoredText } from '../progress/useStoredText';
import { useProfile } from '../state/ProfileProvider';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';
import { SummaryCard } from '../ai/SummaryCard';
import { PhotosSection } from '../photos/PhotosSection';
import { CycleSection } from '../cycle/CycleSection';
import { useCycle } from '../cycle/useCycle';
import { DateAnnouncer, DateBar } from '../components/DateBar';
import { useViewedDate } from '../state/ViewedDate';

interface Props {
  db: WorkoutDb;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

const RECENT_WEIGH_INS = 7;
const r1 = (n: number): string => round1(n).toString();

/** Progress tab, body data: weight entry, tape measurements with the navy body-fat estimate, and steps and sleep. */
export function ProgressScreen({ db, now = () => new Date() }: Props) {
  const { status, profile } = useProfile();
  const settings = useOptionalSettings();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const dataVersion = useDataVersion() + useStepsVersion(); // a pulled record or a phone step reading changed a day note
  const v = useViewedDate(now);
  const p = useProgress({ db, date: v.date, now, notify, reloadKey: dataVersion });
  const cycle = useCycle({ db, date: v.date, notify, reloadKey: dataVersion });
  const ci = useCheckin({ db, date: p.date, weights: p.weights, now, notify, reloadKey: dataVersion });

  const ready = status === 'ready' && p.ready;
  return (
    <View style={styles.fill}>
      <DateAnnouncer v={v} />
      <Page>
        {ready ? <H1>Progress</H1> : null}
        <DateBar v={v} />
        {ready ? (
          <>
            <CheckinCard date={p.date} c={ci} cycleNote={!!cycle.info && waterRetentionPhase(cycle.info)} />
            <RapidLossCard c={ci} />
            <DailyRead sex={profile?.sex} values={profile ? profileWhyValues(profile, { date: p.date, flex: settings?.settings.flex }) : undefined} now={now} />
            <SummaryCard checkin={ci.checkin} profile={profile} />
            <WeightSection p={p} />
            <MeasureSection p={p} isToday={v.isToday} />
            <PhotosSection db={db} date={v.today} weights={p.weights} tapes={p.tapes} notify={notify} />
            <CycleSection key={v.date} cycle={cycle} date={v.date} today={v.today} weights={p.weights} female={profile?.sex === 'female'} notify={notify} />
            <StepsSleepSection key={p.date} p={p} />
            <WeekCard date={p.date} days={ci.days} kcalTarget={profile?.targets.kcal ?? DEFAULT_KCAL_TARGET} />
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
  const series = weightSeries(p.weights, p.date);
  const change = trendChange(series);
  return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>Body weight</Heading>
      <View style={styles.inline}>
        <Field label="Weight in kg" inputMode="decimal" placeholder="kg" value={text} onChangeText={setText} />
        <Button label="Save weight" onPress={() => p.saveWeightText(text)} />
      </View>
      {latest !== null ? <Text style={{ color: c.ink }} accessibilityLabel={`Latest weigh-in ${r1(latest)} kg`}>{`Latest: ${r1(latest)} kg`}</Text> : <Hint>Log a few weigh-ins to see them here.</Hint>}
      {series.length >= 2 ? (
        <>
          <TrendChart points={series} box={WEIGHT_CHART_BOX} label={`Weight from ${series[0]?.v} to ${series[series.length - 1]?.v} kg`} />
          {change ? <Hint>{change.direction === 'none' ? `No change since ${shortDate(change.since)}.` : `${change.direction === 'down' ? 'Down' : 'Up'} ${change.amount} kg since ${shortDate(change.since)}.`}</Hint> : null}
        </>
      ) : (
        <Hint>{TREND_NONE}</Hint>
      )}
      {recent.map((w) => (
        <Card key={w.date} style={styles.row} accessible accessibilityLabel={`${w.date}, ${r1(w.weight_kg)} kg`}>
          <Text style={{ color: c.muted }}>{w.date}</Text>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{`${r1(w.weight_kg)} kg`}</Text>
        </Card>
      ))}
      <Hint>{WEIGHT_HINT}</Hint>
      <WhyLink id="scale" />
      {p.scaleJump ? (
        <Card accessibilityRole="alert">
          <Text style={{ color: c.ink, fontWeight: '700' }}>{SCALE_JUMP_TITLE(round1(p.scaleJump.kg))}</Text>
          <Hint>{SCALE_JUMP_BODY}</Hint>
          <WhyLink id="scale" />
          <Button label="Got it" onPress={p.dismissJump} />
        </Card>
      ) : null}
    </View>
  );
}

function MeasureSection({ p, isToday }: { p: Progress; isToday: boolean }) {
  const c = useTheme();
  const { profile } = useProfile();
  const MEASURES = getMeasures();
  const mine = p.tapes.find((m) => m.date === p.date && !m.deleted_at);
  const [text, setText] = useState<Partial<Record<MeasureKey, string>>>(() => Object.fromEntries(MEASURES.map((m) => [m.key, mine?.[m.key] ? r1(mine[m.key] as number) : ''])));
  // content/measures.json: a part with a rule shows for that sex, or when entered that day.
  const hasRule = (m: (typeof MEASURES)[number]) => m.show !== 'always' && m.show.sex === profile?.sex;
  const shown = MEASURES.filter((m) => m.show === 'always' || hasRule(m) || (m.show.or_entered_that_day && !!mine?.[m.key]));
  const female = profile?.sex === 'female';
  const bf = navyBodyFat(profile, p.tapes, p.date);
  const waist = waistSeries(p.tapes, p.date);
  const waistChange = trendChange(waist);
  return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>Measurements</Heading>
      {shown.map((m) => (
        <View key={m.key} style={styles.field}>
          <Caption>{`${m.label} (cm)`}</Caption>
          <Field label={`${m.label} in cm`} inputMode="decimal" placeholder="cm" value={text[m.key] ?? ''} onChangeText={(v) => setText({ ...text, [m.key]: v })} />
        </View>
      ))}
      <Button label={isToday ? 'Save for today' : `Save for ${shortDate(p.date)}`} onPress={() => p.saveTape(text)} />
      {waist.length >= 2 ? (
        <>
          <Heading level={3} style={[typeScale.label, { color: c.ink }]}>Waist</Heading>
          <TrendChart points={waist} box={WAIST_CHART_BOX} label={`Waist from ${waist[0]?.v} to ${waist[waist.length - 1]?.v} cm`} />
          {waistChange ? <Hint>{waistChange.direction === 'none' ? `No change in waist since ${shortDate(waistChange.since)}.` : `Waist ${waistChange.direction} ${waistChange.amount} cm since ${shortDate(waistChange.since)}.`}</Hint> : null}
        </>
      ) : null}
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
  const [steps, setSteps] = useStoredText(p.today?.steps != null ? String(p.today.steps) : ''); // 0 is a real count (#303)
  const [sleep, setSleep] = useStoredText(p.today?.sleep != null ? String(p.today.sleep) : ''); // 0 h is valid (contract 0-24)
  return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>Steps and sleep</Heading>
      <Field label="Steps today" inputMode="numeric" placeholder="Steps" value={steps} onChangeText={setSteps} />
      <Hint>{`steps today, target about ${fmt(stepsTarget(p.notes, p.date))}`}</Hint>
      <WhyLink id="activity" />
      {p.today?.steps != null && <Hint>{`Source: ${p.today.steps_source === 'device' ? 'phone step sensor' : 'entered by you'}`}</Hint>}
      <Field label="Hours slept last night" inputMode="decimal" placeholder="Hours" value={sleep} onChangeText={setSleep} />
      <Hint>hours slept last night (aim for 7–9)</Hint>
      <WhyLink id="sleep" />
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
