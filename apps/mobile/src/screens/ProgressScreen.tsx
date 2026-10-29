import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WhyLink } from '../why/WhyLink';
import { DailyRead } from '../why/DailyRead';
import { useOptionalSettings } from '../state/SettingsProvider';
import { profileWhyValues } from '../why/values';
import { StyleSheet, View } from 'react-native';
import { DEFAULT_KCAL_TARGET, formatWeight, round1, waterRetentionPhase, latestWeight, navyBodyFat, stepsTarget, weightSeries, WEIGHT_CHART_BOX, type MeasureKey } from '@plate-and-bar/core';
import { useDataVersion } from '../sync/useDataVersion';
import { useStepsVersion } from '../steps/DeviceStepsProvider';
import { Text } from '../components/Text';
import { Heading, Button, Caption, Card, Field, H1, Hint, Page } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { fmt, shortDate } from '../format';
import { BF_HINT, BF_MISSING, BF_NO_PROFILE, HOW_TO_MEASURE, HOW_TO_MEASURE_HIPS, getMeasures, SCALE_JUMP_BODY, RECENT_WEIGH_INS_TITLE, SCALE_JUMP_TITLE, WEIGHT_HINT } from '../progress/copy';
import { CheckinCard, RapidLossCard } from '../progress/CheckinCard';
import { RecentWorkouts, WorkoutDay } from '../progress/history/History';
import { useHistory } from '../progress/history/useHistory';
import { StrengthSection } from '../progress/StrengthSection';
import { WeekCard } from '../progress/WeekCard';
import { useCheckin } from '../progress/useCheckin';
import { RangedTrend } from '../progress/RangedTrend';
import { MeasureTrend } from '../progress/MeasureTrend';
import { WeeksOnTrack } from '../progress/WeeksOnTrack';
import { useProgress } from '../progress/useProgress';
import { useStoredText } from '../progress/useStoredText';
import { useProfile } from '../state/ProfileProvider';
import { useWeightUnit } from '../settings/weightUnit';
import { weightNumber, weightWithUnit } from '../workout/unitText';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';
import { SummaryCard } from '../ai/SummaryCard';
import { PhotosSection } from '../photos/PhotosSection';
import { CycleSection } from '../cycle/CycleSection';
import { useCycle } from '../cycle/useCycle';
import { LabsSection } from '../labs/LabsSection';
import { useLabs } from '../labs/useLabs';
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
  const labs = useLabs({ db, today: v.today, notify, reloadKey: dataVersion });
  const ci = useCheckin({ db, date: p.date, weights: p.weights, now, notify, reloadKey: dataVersion });

  const hist = useHistory(db, dataVersion);
  const [openDay, setOpenDay] = useState<string | null>(null);
  // The day just closed: focus returns to its row.
  const [closedDay, setClosedDay] = useState<string | null>(null);
  const opened = openDay ? hist?.sessions.find((s) => s.date === openDay) : undefined;

  // The open day vanished (a sync pulled it away): go back to the page, with focus on where it was.
  if (openDay && hist && !opened) {
    setClosedDay(openDay);
    setOpenDay(null);
  }
  const ready = status === 'ready' && p.ready;
  const showDay = ready && !!hist && !!opened;
  return (
    <View style={styles.fill}>
      <DateAnnouncer v={v} />
      <Page resetKey={openDay}>
        {showDay && hist && opened ? <WorkoutDay session={opened} sessions={hist.sessions} lifts={hist.lifts} onBack={() => { setClosedDay(openDay); setOpenDay(null); }} /> : null}
        {/* Hidden, not unmounted, while a day is open: typed weights and the sections' state survive going back. */}
        <View style={showDay ? styles.hidden : styles.body}>
        {ready ? <H1>Progress</H1> : null}
        <DateBar v={v} />
        {ready ? (
          <>
            {hist ? <RecentWorkouts sessions={hist.sessions} onOpen={(d) => { setClosedDay(null); setOpenDay(d); }} focusDate={closedDay} /> : null}
            <CheckinCard date={p.date} c={ci} cycleNote={!!cycle.info && waterRetentionPhase(cycle.info)} />
            <RapidLossCard c={ci} />
            <DailyRead sex={profile?.sex} values={profile ? profileWhyValues(profile, { date: p.date, flex: settings?.settings.flex, labHold: labs.holdOn }) : undefined} now={now} />
            <SummaryCard checkin={ci.checkin} profile={profile} />
            <StrengthSection db={db} date={v.date} weights={p.weights} sessions={ci.sessions} />
            <WeightSection p={p} />
            <MeasureSection p={p} isToday={v.isToday} />
            <PhotosSection db={db} date={v.today} weights={p.weights} tapes={p.tapes} notify={notify} />
            <CycleSection key={`cycle-${v.date}`} cycle={cycle} date={v.date} today={v.today} weights={p.weights} female={profile?.sex === 'female'} notify={notify} />
            <LabsSection labs={labs} today={v.today} />
            <StepsSleepSection key={`steps-${p.date}`} p={p} />
            <WeekCard date={v.today} pastDay={!v.isToday} days={ci.weekDays} kcalTarget={profile?.targets.kcal ?? DEFAULT_KCAL_TARGET} />
            <WeeksOnTrack sessions={ci.sessions} date={p.date} profile={profile} />
          </>
        ) : (
          <Hint>Loading…</Hint>
        )}
        </View>
      </Page>
      <ToastBar message={toast} />
    </View>
  );
}

type Progress = ReturnType<typeof useProgress>;

function WeightSection({ p }: { p: Progress }) {
  const c = useTheme();
  const { unit } = useWeightUnit();
  const mine = p.weights.find((w) => w.date === p.date && !w.deleted_at);
  // The box shows the stored kg in the display unit; it is read back only when Save weight is pressed, never on its own.
  const [text, setText] = useStoredText(mine ? formatWeight(mine.weight_kg, unit) : '');
  const latest = latestWeight(p.weights, p.date);
  const recent = p.weights.filter((w) => !w.deleted_at && w.date <= p.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_WEIGH_INS);
  const toShown = useCallback((kg: number) => weightNumber(kg, unit), [unit]);
  const kgSeries = useMemo(() => weightSeries(p.weights, p.date, Infinity), [p.weights, p.date]);
  return (
    <Card style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>Body weight</Heading>
      <View style={styles.inline}>
        <Field label={`Weight in ${unit}`} inputMode="decimal" placeholder={unit} value={text} onChangeText={setText} />
        <Button kind="ghost" label="Save weight" onPress={() => p.saveWeightText(text, unit)} />
      </View>
      {latest !== null ? <Text style={{ color: c.ink }} accessibilityLabel={`Latest weigh-in ${weightWithUnit(latest, unit)}`}>{`Latest: ${weightWithUnit(latest, unit)}`}</Text> : <Hint>Log a few weigh-ins to see them here.</Hint>}
      <RangedTrend
        series={kgSeries}
        end={p.date}
        convert={toShown}
        unit={unit}
        noun="Weight"
        box={WEIGHT_CHART_BOX}
        changeLine={(ch) => (ch.direction === 'none' ? `No change since ${shortDate(ch.since)}.` : `${ch.direction === 'down' ? 'Down' : 'Up'} ${ch.amount} ${unit} since ${shortDate(ch.since)}.`)}
      />
      {recent.length > 0 ? <Heading level={3} style={[typeScale.label, { color: c.ink }]}>{RECENT_WEIGH_INS_TITLE}</Heading> : null}
      {recent.map((w) => (
        <Card key={w.date} style={[styles.row, { backgroundColor: c.surfaceSoft }]} accessible accessibilityLabel={`${shortDate(w.date)}, ${weightWithUnit(w.weight_kg, unit)}`}>
          <Text style={{ color: c.muted }}>{shortDate(w.date)}</Text>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{weightWithUnit(w.weight_kg, unit)}</Text>
        </Card>
      ))}
      <Hint>{WEIGHT_HINT}</Hint>
      <WhyLink id="scale" />
      {p.scaleJump ? (
        <Card accessibilityRole="alert">
          <Text style={{ color: c.ink, fontWeight: '700' }}>{SCALE_JUMP_TITLE(formatWeight(p.scaleJump.kg, unit), unit)}</Text>
          <Hint>{SCALE_JUMP_BODY}</Hint>
          <WhyLink id="scale" />
          <Button label="Got it" onPress={p.dismissJump} />
        </Card>
      ) : null}
    </Card>
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
  return (
    <Card style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>Measurements</Heading>
      {shown.map((m) => (
        <View key={m.key} style={styles.field}>
          <Caption>{`${m.label} (cm)`}</Caption>
          <Field label={`${m.label} in cm`} inputMode="decimal" placeholder="cm" value={text[m.key] ?? ''} onChangeText={(v) => setText({ ...text, [m.key]: v })} />
        </View>
      ))}
      <Button kind="ghost" disabled={!Object.values(text).some((t) => t?.trim())} label={isToday ? 'Save for today' : `Save for ${shortDate(p.date)}`} onPress={() => p.saveTape(text)} />
      <MeasureTrend
        tapes={p.tapes}
        end={p.date}
        estimate={
          bf !== null ? (
            <>
              <Text style={{ color: c.ink, fontWeight: '700' }}>{`Estimated body fat: about ${fmt(bf)}%`}</Text>
              <Hint>{BF_HINT(female)}</Hint>
            </>
          ) : null
        }
        missing={bf === null ? <Hint>{profile ? BF_MISSING(female) : BF_NO_PROFILE}</Hint> : null}
      />
      <Hint>{`How to measure. ${HOW_TO_MEASURE}${shown.some((m) => m.key === 'hips_cm') ? ` ${HOW_TO_MEASURE_HIPS}` : ''}`}</Hint>
    </Card>
  );
}

function StepsSleepSection({ p }: { p: Progress }) {
  const c = useTheme();
  const [steps, setSteps] = useStoredText(p.today?.steps != null ? String(p.today.steps) : ''); // 0 is a real count (#303)
  const [sleep, setSleep] = useStoredText(p.today?.sleep != null ? String(p.today.sleep) : ''); // 0 h is valid (contract 0-24)
  return (
    <Card style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>Steps and sleep</Heading>
      <Field label="Steps today" inputMode="numeric" placeholder="Steps" value={steps} onChangeText={setSteps} />
      <Hint>{`steps today, target about ${fmt(stepsTarget(p.notes, p.date))}`}</Hint>
      <WhyLink id="activity" />
      {p.today?.steps != null && <Hint>{`Source: ${p.today.steps_source === 'device' ? 'phone step sensor' : 'entered by you'}`}</Hint>}
      <Field label="Hours slept last night" inputMode="decimal" placeholder="Hours" value={sleep} onChangeText={setSleep} />
      <Hint>hours slept last night (aim for 7–9)</Hint>
      <WhyLink id="sleep" />
      <Button kind="ghost" label="Save steps and sleep" onPress={() => p.saveStepsSleep(steps, sleep)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { gap: 8 },
  hidden: { display: 'none' },
  section: { gap: 8, marginTop: 16 },
  inline: { gap: 8 },
  field: { gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
