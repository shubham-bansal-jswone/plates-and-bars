import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { profileWhyValues } from '../why/values';
import { WhyLink } from '../why/WhyLink';
import { useFocusEffect } from 'expo-router';
import { AccessibilityInfo, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useDataVersion } from '../sync/useDataVersion';
import { Text } from '../components/Text';
import { HAND_PICKED, modsNote, overridesFromSettings, plannedCoverage, type WeekPlan, secondSessionChoices, sessionVolume, beginnerRamp, checkinFlags, isFocus, nextInList, coverageTemplates, mondayOf, planned, restFor, warmupSets, type Checkin, isLearning, exInfo, priorSessions, REST_EXTEND_SEC, type ExclusionReason } from '@plate-and-bar/core';
import { fmt } from '../format';
import { ClearanceCard } from '../components/ClearanceCard';
import { Button, Card, Disclosure, H1, Hint, MetricRow, Note, Page, useScrollToTopOn } from '../components/ui';
import { type } from '../theme/tokens';
import type { WorkoutDb } from '../db/workouts';
import type { PullDb } from '../db/outbox';
import { useProfile } from '../state/ProfileProvider';
import { useSettings } from '../state/SettingsProvider';
import { useTheme } from '../theme/useTheme';
import { buildSession } from '../workout/buildSession';
import { getCatalog } from '../workout/catalog';
import { CHECKIN, REASON_TEXT, listJoin, modsNoteText, muscleName } from '../workout/copy';
import { ExerciseCard, type Actions } from '../workout/ExerciseCard';
import { AddExerciseFlow } from '../workout/AddExerciseFlow';
import { BodyMap } from '../workout/BodyMap';
import { musclesOf } from '../workout/muscles';
import { workoutLists } from '../workout/workoutLists';
import { guidance, progressionContext, type Tuning } from '../workout/guidance';
import { ExerciseCards, RecheckCards, StartCards } from '../workout/ExerciseCards';
import { BurnLine } from '../workout/BurnLine';
import { CardioBlock } from '../workout/CardioBlock';
import { ModeNote, WeekTools } from '../workout/ScheduleTools';
import { CantSheet } from '../workout/CantSheet';
import { CompletionPanel } from '../workout/CompletionPanel';
import { Hero, IndexThumb, SegmentBar, StartButton } from '../workout/SessionHeader';
import { Chip, HowToSheet, RestBar, ToastBar, type RestState } from '../workout/parts';
import { useRestNotification } from '../reminders/useRestNotification';
import { useRules } from '../workout/useRules';
import { useWorkoutDay, type PickSeed } from '../workout/useWorkoutDay';
import { useLabHold } from '../labs/useLabHold';
import { labs } from '../labs/content';
import type { Workout } from '../workout/types';
import { DateAnnouncer, DateBar } from '../components/DateBar';
import { useViewedDate } from '../state/ViewedDate';

interface Props {
  db: WorkoutDb & PullDb;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

/** Workout tab: today's planned session with Start, then the session itself. */
export function WorkoutScreen({ db, now = () => new Date() }: Props) {
  const { profile, status } = useProfile();
  const { ready, settings } = useSettings();
  const { focus, rest_off: restOff } = settings;
  const [toast, setToast] = useState<string | null>(null);
  const [rest, setRest] = useState<RestState | null>(null);
  const [howTo, setHowTo] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const startRest = useCallback((name: string, label: string) => {
    if (restOff) return;
    const total = restFor(name, getCatalog().tags);
    const t = Date.now();
    setRest({ id: t, end: t + total * 1000, total, label });
  }, [restOff]);

  // Tab screens stay mounted; rules removed on the Targets tab show here when this tab is shown again.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  // Pulled records (sync) also make the rules and the day read again, without a remount.
  const dataVersion = useDataVersion();
  const rulesApi = useRules({ db, now, notify, reloadKey: shown + dataVersion });
  const { rules, addRule } = rulesApi;
  const winW = useWindowDimensions().width;
  const wide = winW >= 1024;
  const tune = useMemo(() => ({ overrides: overridesFromSettings(settings.exercise_overrides), returning: settings.returning }), [settings.exercise_overrides, settings.returning]);
  const v = useViewedDate(now);
  const labHold = useLabHold(db); // the lab hold (#1070): new sessions are lighter
  const w = useWorkoutDay({ db, date: v.date, profile, now, focus, notify, startRest, labHold: labHold === true, adjustments: settings.adjustments, exclusions: rules.exclusions, swaps: rules.swaps, saveRule: addRule, tune, reloadKey: shown + dataVersion });
  const { day } = w;
  // The rest as a notification while the app is in the background (#1068); its +30 s and Skip come back through setRest.
  useRestNotification({ db, rest, setRest, sessionActive: day.exs.length > 0 });
  const addRest = () => setRest((r) => (r ? { ...r, end: r.end + REST_EXTEND_SEC * 1000, total: r.total + REST_EXTEND_SEC } : r));
  const [cantName, setCantName] = useState<{ i: number; name: string; reason?: ExclusionReason } | null>(null);

  const restBar = <RestBar rest={rest} onAdd={addRest} onSkip={() => setRest(null)} />;
  // One tree for every state, the state's content in the one body slot: the rest bar and toast keep their place (and so are not remounted,
  // which would repeat "Rest done, go!" and re-read the toast) while a day is read. They sit outside it as the prototype's #restbar and #toast sit outside #view.
  // The date bar is in the one Page for every state, so it is not remounted when a day finishes loading (a tap that spans the remount is lost, #1032).
  let content: ReactNode;
  let sheets: ReactNode = null;
  if (status !== 'ready' || !ready || !day.ready || !rules.ready || labHold === null) content = (
      <>
        <Hint>Loading…</Hint>
        <Skeleton />
      </>
    );
  else if (!profile)
    content = (
      <>
        <H1>Workout</H1>
        <Hint>Finish setup first, so the app can plan your sessions.</Hint>
      </>
    );
  else {
    const body =
      day.exs.length === 0 ? (
        <StartView key={w.date} now={now} w={w} labHold={labHold === true} profile={profile} focus={focus} rules={rulesApi} notify={notify} tune={tune} />
      ) : (
        <SessionView key={w.date} now={now} db={db} reloadKey={shown + dataVersion} w={w} profile={profile} focus={focus} rules={rulesApi} notify={notify} tune={tune} onHowTo={setHowTo} onCant={(i, name, reason) => setCantName(reason ? { i, name, reason } : { i, name })} />
      );
    const where = day.workout?.where ?? profile.where;
    const planned = () => plannedCoverage({ date: w.date, profile, weekPlan: settings.adjustments.weekPlan as WeekPlan | undefined, exclusions: rules.exclusions, swaps: rules.swaps, lifts: day.lifts }, getCatalog());
    content = body;
    sheets = (
      <>
        <HowToSheet name={howTo} onClose={() => setHowTo(null)} />
        <CantSheet
          name={cantName?.name ?? null}
          {...(cantName?.reason ? { reason: cantName.reason } : {})}
          where={where}
          inSession={day.exs.map((e) => e.name)}
          exclusions={rules.exclusions}
          lifts={day.lifts}
          setsFor={(m) => planned()[m] ?? 0}
          onPick={(draft, choice) => {
            w.cant(cantName ? cantName.i : null, draft, choice);
            setCantName(null);
          }}
          onClose={() => setCantName(null)}
        />
      </>
    );
  }
  return (
    <View style={styles.fill}>
      <DateAnnouncer v={v} />
      <Page resetKey={day.exs.length > 0}>
        {/* On a wide screen the content is two columns, wider than Page's phone-sized column: it overflows it evenly on both sides. */}
        <View style={[styles.body, wide && { width: Math.min(1120, winW - 32), alignSelf: 'center' }]}>
          <DateBar v={v} />
          {content}
        </View>
      </Page>
      {sheets}
      {restBar}
      <ToastBar message={toast} />
    </View>
  );
}

/** Placeholder rows while the day is read. */
function Skeleton() {
  const c = useTheme();
  return (
    <View aria-hidden style={{ gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ height: 56, borderRadius: 14, backgroundColor: c.surfaceSoft }} />
      ))}
    </View>
  );
}

const WHERE_CHOICES: [NonNullable<Workout['where']>, string][] = [['gym', 'Normal gym'], ['dumbbells', 'Dumbbells only'], ['bodyweight', 'Bodyweight only']];

type W = ReturnType<typeof useWorkoutDay>;
type Prof = NonNullable<ReturnType<typeof useProfile>['profile']>;

function StartView({ now, w, labHold, profile, focus, rules, notify, tune }: { now: () => Date; w: W; labHold: boolean; profile: Prof; focus: readonly string[]; rules: ReturnType<typeof useRules>; notify: (msg: string) => void; tune: Tuning }) {
  const c = useTheme();
  const { date, day } = w;
  const { settings } = useSettings();
  const { markCleared } = useProfile();
  const [ci, setCi] = useState<Checkin>({});
  const [choice, setChoice] = useState<Workout['ci_choice']>(null);
  // Today's "where" override (prototype whereNow): null keeps the profile's. Stored on the workout at Start.
  const [override, setOverride] = useState<Workout['where']>(null);
  const [away, setAway] = useState(false);
  const [picking, setPicking] = useState(false);
  // Choosing a workout only previews it (#1005): nothing is stored until Start. `previewT` is the workout being previewed, `picked` the hand-picked exercises (from any workout) waiting for Start.
  const [previewT, setPreviewT] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  useScrollToTopOn(previewT);
  // The previewed workout the picks were seeded from (#1020); null for picks made from scratch. Start passes it only while a seeded exercise is still picked. While it is set the where override is fixed (the list was built for it).
  const [seed, setSeed] = useState<PickSeed | null>(null);
  const where = override ?? profile.where;
  const weekPlan = settings.adjustments.weekPlan as WeekPlan | undefined;
  const plan = planned(date, { profile, sessions: day.sessions, weekPlan, mode: settings.adjustments.mode as string | undefined });
  const nextT = plan ? nextInList(plan, profile) : null;
  const flags = checkinFlags(ci, nextT);
  const startT = previewT ?? (choice === 'swap' && nextT ? nextT : plan);
  const pick = <K extends keyof Checkin>(k: K, v: NonNullable<Checkin[K]>) => {
    const next: Checkin = { ...ci, [k]: ci[k] === v ? undefined : v };
    setCi(next);
    if (!checkinFlags(next, nextT).flagged) setChoice(null);
  };
  const built = startT
    ? buildSession({ template: startT, date, profile, where, sessions: day.sessions, lifts: progressionContext(date, day.lifts, profile, null, tune).lifts, ciChoice: choice, checkin: ci, focus, exclusions: rules.rules.exclusions, swaps: rules.rules.swaps, adjustments: settings.adjustments, labHold })
    : null;
  const names = built ? built.exercises.map((e) => e.name) : [];
  const { primary: prim, secondary: sec } = musclesOf(names);
  const eachSets = built && built.exercises.length && built.exercises.every((e) => e.sets === built.exercises[0]?.sets) ? built.exercises[0]?.sets : null;
  // This week's hand-picked plan replaces the usual list while it is the current week (prototype chipList).
  const weekTemplates = coverageTemplates(date, profile, weekPlan) as readonly string[];
  const others = weekTemplates.filter((k) => k !== plan);
  const lists = workoutLists(weekTemplates, where, { date, exclusions: rules.rules.exclusions, swaps: rules.rules.swaps, lifts: day.lifts });
  // Focus would fall to the document when the pressed chip or button unmounts: say where the user is now (a live region; iOS has no live regions, so it announces).
  const [said, setSaid] = useState('');
  const say = (msg: string) => {
    setSaid(msg);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(msg);
  };
  const back = () => {
    setPreviewT(null);
    setPicked([]);
    setSeed(null);
    say('Back to the list of workouts.');
  };
  const preview = (k: string) => {
    if (choice === 'swap') setChoice(null);
    setPreviewT(k);
    say(`${k} day preview. Nothing is saved until you start.`);
  };
  const { primary: pickedPrim, secondary: pickedSec } = musclesOf(picked);

  const awayLabel =
    where === profile.where
      ? profile.where === 'gym' ? 'Training away from your gym?' : 'Training somewhere else today?'
      : `Training ${where === 'gym' ? 'at a gym' : `with ${where === 'dumbbells' ? 'dumbbells only' : 'bodyweight only'}`} today`;

  const wide = useWindowDimensions().width >= 1024;
  const [ciOpen, setCiOpen] = useState<boolean | null>(null);
  const hasBuilt = !!(built && startT) && !picked.length;
  const list = picked.length ? picked : hasBuilt ? names : [];
  const muscles = picked.length ? { prim: pickedPrim, sec: pickedSec } : { prim, sec };
  const sets = hasBuilt && built ? built.exercises.reduce((t, e) => t + e.sets, 0) : null;
  const cells = [
    ...(list.length ? [{ label: 'Exercises', value: String(list.length) }] : []),
    ...(sets !== null ? [{ label: 'Sets', value: String(sets) }] : []),
    ...(hasBuilt && profile.minutes ? [{ label: 'Min per session', value: String(profile.minutes) }] : []),
  ];

  const hero = (
    <>
      <Hero title={picked.length ? 'Your exercises' : previewT ? `${previewT} day` : plan ? `${plan} day` : 'Rest day'} />
      <Hint>
        {picked.length
          ? 'Nothing is saved until you start. Add exercises from any workout.'
          : previewT
          ? 'Nothing is saved until you start. Go back to choose another workout.'
          : plan
          ? weekPlan && weekPlan.start === mondayOf(date)
            ? `This week’s ${weekPlan.list.length}-day plan.`
            : 'Start with the planned exercises, then swap or add anything you like.'
          : 'Rest and recovery today. A walk and enough protein count. You can still log a session.'}
      </Hint>
      {cells.length ? <MetricRow cells={cells} /> : null}
    </>
  );

  const action = picked.length ? (
    <>
      <StartButton label={`Start ${picked.length === 1 ? 'this exercise' : 'these exercises'}`} onPress={() => void w.startPicked(picked, override, choice, seed && picked.some((n) => seed.exercises.some((e) => e.name === n)) ? seed : null, ci.time ?? null)} />
      <Button label="Pick more exercises" kind="ghost" onPress={() => setPicking(true)} />
      <Button label="Back to workouts" kind="link" onPress={back} />
    </>
  ) : hasBuilt && startT ? (
    <>
      <StartButton label={`Start ${startT}`} onPress={() => void w.start(startT, ci, choice, override)} />
      {previewT ? (
        <Button
          label="Pick exercises"
          kind="ghost"
          onPress={() => {
            // Starts from this workout's exercises: drop some, add others from any workout, then Start.
            setPicked(names);
            if (built) setSeed({ template: startT as string, exercises: built.exercises });
            setPreviewT(null);
            setPicking(true);
          }}
        />
      ) : null}
      {previewT ? <Button label="Back to workouts" kind="link" onPress={back} /> : null}
    </>
  ) : null;

  const cards = (
    <>
      <RecheckCards date={date} lifts={day.lifts} rules={rules} notify={notify} />
      <StartCards date={date} lifts={day.lifts} sessions={day.sessions} profile={profile} plan={plan} notify={notify} now={now} />
    </>
  );

  const musclesView = list.length ? (
    <View style={{ gap: 8 }}>
      <BodyMap primary={muscles.prim} secondary={muscles.sec} />
      {picked.length ? null : (
        <>
          <Text style={{ color: c.ink, fontSize: 15 }}>
            <Text style={{ fontWeight: '700' }}>Main focus: </Text>
            {listJoin(prim.map((m) => muscleName(m)))}
          </Text>
          {sec.length ? <Hint>Also working: {listJoin(sec.map((m) => muscleName(m)))}</Hint> : null}
        </>
      )}
    </View>
  ) : null;

  const exerciseList = list.length ? (
    <View>
      {list.map((n, i) => (
        <View key={n} style={[styles.exRow, { borderColor: c.line }]}>
          <IndexThumb n={i + 1} />
          <Text accessibilityLabel={`Exercise ${i + 1}: ${n}`} style={{ flex: 1 }}>
            <Text style={[type.bodyStrong, { color: c.ink }]}>{n}</Text>
            <Text style={[type.caption, { color: c.muted }]}>{'\n'}{listJoin((getCatalog().tags[n]?.primary ?? []).map((m) => muscleName(m)))}</Text>
            {isFocus(n, focus, getCatalog().tags) ? <Text style={[type.bodyStrong, { color: c.link }]}> Focus</Text> : null}
          </Text>
          {picked.length ? (
            <Chip label={`Remove ${n} from your exercises`} text="Remove" onPress={() => {
              const rest = picked.filter((x) => x !== n);
              setPicked(rest);
              if (!rest.length) setSeed(null); // back to the list: the next picks start from scratch
            }} />
          ) : null}
        </View>
      ))}
    </View>
  ) : null;

  const notes = hasBuilt && built && startT ? (
    <>
      <Hint>
        {names.length} exercises{eachSets ? `, ${eachSets} sets each${beginnerRamp(profile, date) ? ' for your first 2 weeks' : ''}` : ''}
        {names.some((n) => isFocus(n, focus, getCatalog().tags)) ? ', plus 1 on focus muscles' : ''}
        {profile.minutes ? `, sized to your ${profile.minutes}-minute sessions` : ''}.
        {built.left.length ? ` ${listJoin(built.left)} rotate in on other ${startT} days.` : ''}
      </Hint>
      {built.lost.map((n) => (
        <Hint key={n}>
          {n} is left out with no replacement{getCatalog().tags[n] ? `, so your ${listJoin(getCatalog().tags[n]!.primary.map((m) => muscleName(m)))} get fewer sets each week` : ''}.
        </Hint>
      ))}
    </>
  ) : null;

  const disclosures = (
    <>
      {musclesView && !wide ? <Disclosure label="Muscles today">{musclesView}</Disclosure> : null}
      {hasBuilt && built ? (
        <Disclosure label="Quick check-in (optional)" open={ciOpen ?? flags.flagged} onOpenChange={setCiOpen}>
          {CHECKIN.map((q) => (
            <View key={q.key} style={{ gap: 6 }}>
              <Text style={{ color: c.ink, fontSize: 14 }}>{q.label}</Text>
              <View style={styles.wrap}>
                {q.options.map(([v, l]) => (
                  <Chip key={v} label={`${q.label}: ${l}`} text={l} pressed={ci[q.key] === v} onPress={() => pick(q.key, v)} />
                ))}
              </View>
            </View>
          ))}
          {flags.flagged ? (
            <View style={{ gap: 6 }}>
              <Note>
                Lighter session suggested. With {flags.reasons.map((r) => REASON_TEXT[r]).join(' and ')}, keep the same exercises with 1 fewer set each and no weight increases today.
                {flags.swapTo ? ` Or swap with ${flags.swapTo}, which uses different muscles.` : ''}
              </Note>
              <WhyLink id={flags.reasons.includes('sore') ? 'soreness' : 'sleep'} />
              <View style={styles.wrap}>
                <Chip label="Lighter session" pressed={choice === 'light'} onPress={() => setChoice('light')} />
                {flags.swapTo && !previewT ? <Chip label={`Swap with ${flags.swapTo}`} pressed={choice === 'swap'} onPress={() => setChoice('swap')} /> : null}
                <Chip label="Keep original" pressed={choice === 'orig'} onPress={() => setChoice('orig')} />
              </View>
            </View>
          ) : flags.good ? (
            <Hint>Good to go.</Hint>
          ) : null}
          {built.mods.short ? <Hint>{ci.time} minutes: the main {built.exercises.length} exercises only.</Hint> : null}
        </Disclosure>
      ) : null}
      {seed ? null : (
        <Disclosure label={awayLabel} open={away} onOpenChange={setAway}>
          <View style={styles.wrap}>
            {WHERE_CHOICES.map(([v, l]) => (
              <Chip
                key={v}
                label={l}
                pressed={where === v}
                onPress={() => {
                  setOverride(v === profile.where ? null : v);
                  setAway(false);
                }}
              />
            ))}
          </View>
        </Disclosure>
      )}
      <WeekTools date={date} notify={notify} />
      {/* On a rest day "Choose another day" is the only way to start a session, so it is open. */}
      {previewT || picked.length ? null : (
        <Disclosure label="Choose another day" defaultOpen={!plan}>
          <View style={styles.wrap}>
            {others.map((k) => (
              <Chip key={k} label={`Choose ${k}`} text={k} onPress={() => preview(k)} />
            ))}
            <Chip label="Pick exercises" onPress={() => setPicking(true)} />
          </View>
        </Disclosure>
      )}
      <ModeNote notify={notify} />
    </>
  );

  const flow = (
    <AddExerciseFlow open={picking} onClose={() => setPicking(false)} inSession={picked} workouts={lists} quiet add={(n) => {
        setPicked((p) => (p.includes(n) ? p : [...p, n]));
        setPreviewT(null);
        return true;
      }} notify={notify} />
  );

  const top = (
    <>
      <Text testID="start-announce" accessibilityLiveRegion="polite" style={styles.srOnly}>{Platform.OS === 'ios' ? '' : said}</Text>
      <ClearanceCard profile={profile} onCleared={() => void markCleared().then(() => notify('Thanks. Your normal plan is back.'), () => notify('Couldn’t save that. Try again.'))} />
      {labHold ? <Note>{labs.workout_note}</Note> : null}
    </>
  );
  const cardio = <CardioBlock value={day.workout?.cardio_min ?? null} onSave={w.setCardio} />;

  if (wide)
    return (
      <>
        {top}
        <View style={styles.cols}>
          <View style={styles.colLeft}>
            {hero}
            {action}
            {cards}
            {disclosures}
            {cardio}
          </View>
          <View style={styles.colRight}>
            {exerciseList}
            {notes}
            {musclesView}
          </View>
        </View>
        {flow}
      </>
    );
  return (
    <>
      {top}
      {hero}
      {action}
      {cards}
      {exerciseList}
      {notes}
      {disclosures}
      {cardio}
      {flow}
    </>
  );
}

function SessionView({ now, db, reloadKey, w, profile, focus, rules, notify, tune, onHowTo, onCant }: { now: () => Date; db: WorkoutDb; reloadKey: number; w: W; profile: Prof; focus: readonly string[]; rules: ReturnType<typeof useRules>; notify: (msg: string) => void; tune: Tuning; onHowTo: (n: string) => void; onCant: (i: number, name: string, reason?: ExclusionReason) => void }) {
  const c = useTheme();
  const { date, day } = w;
  const { settings } = useSettings();
  const wide = useWindowDimensions().width >= 1024;
  const [open, setOpen] = useState(false);
  // The muscle map is closed until the user opens it (open from the start on a wide screen, where it has room); once the user taps it, their choice stays.
  const [mapOpen, setMapOpen] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  // One exercise is expanded at a time: the user's pick, else the first with sets left. Acting on an exercise pins it, so its rating chips and form question stay put after its last tick.
  const [pinned, setPinned] = useState<string | null>(null);
  const wk = day.workout as Workout;
  const ctx = progressionContext(date, day.lifts, profile, wk, tune);
  let done = 0;
  let all = 0;
  for (const ex of day.exs)
    for (const s of ex.sets) {
      all++;
      if (s.done) {
        done++;
      }
    }
  const notes = modsNote(wk.mods).map(modsNoteText);
  const choices = secondSessionChoices({ exercises: day.exs, template: wk.template, base: wk.base }, profile);
  const vol = sessionVolume(day.exs);
  const { primary: mainMuscles, secondary: alsoMuscles } = musclesOf(day.exs.map((e) => e.name));
  const mapShown = mapOpen ?? wide;
  const complete = all > 0 && done === all;
  const current = pinned && day.exs.some((e) => e.name === pinned) ? pinned : (day.exs.find((e) => e.sets.some((s) => !s.done))?.name ?? null);

  const info = (
    <Disclosure label="Session info" defaultOpen={wide}>
      <WhyLink id="split" label="Why these exercises?" values={profileWhyValues(profile)} />
      {complete ? null : <BurnLine db={db} date={date} profileKg={profile.weight_kg} exs={day.exs} cardio={wk.cardio_min} reloadKey={reloadKey} />}
      {mainMuscles.length ? (
        <View>
          <Button kind="link" label={`Muscles today: ${listJoin(mainMuscles.map((m) => muscleName(m)))}`} expanded={mapShown} onPress={() => setMapOpen(!mapShown)} />
          {mapShown ? <BodyMap primary={mainMuscles} secondary={alsoMuscles} /> : null}
        </View>
      ) : null}
    </Disclosure>
  );

  const stack = (
    <>
      {day.exs.map((ex, i) => {
        const { info, sug } = guidance(ex, ctx, wk);
        const pin = () => setPinned(ex.name);
        const act: Actions = {
          edit: (kind, j, f, v) => (pin(), w.editSet(i, kind, j, f, v)),
          tick: (j) => (pin(), w.tick(i, j)),
          rate: (j, v) => (pin(), w.rate(i, j, v)),
          form: (v) => (pin(), w.setForm(i, v)),
          rampStart: () => (pin(), w.rampStart(i)),
          rampSkip: () => (pin(), w.rampSkip(i)),
          rampAdd: () => (pin(), w.rampAdd(i)),
          rampTick: (j) => (pin(), w.rampTick(i, j)),
          rampRate: (j, v) => (pin(), w.rampRated(i, j, v)),
          howTo: () => onHowTo(ex.name),
          cant: () => onCant(i, ex.name),
          cantPain: () => onCant(i, ex.name, 'pain'),
          feel: (v) => (pin(), w.setFeel(i, v)),
          skipRest: () => w.skipRemaining(i),
          addSet: () => (pin(), w.addSet(i)),
          removeSet: () => (pin(), w.removeSet(i)),
          remove: () => {
            if (w.removeExercise(ex.name)) notify(`${ex.name} removed`);
          },
        };
        return (
          <View key={ex.name} style={{ gap: 8 }}>
            {ex.part === 2 && day.exs[i - 1]?.part !== 2 ? <H1 level={2}>Second session</H1> : null}
            <ExerciseCard expanded={ex.name === current} onToggle={pin} notify={notify} lifts={day.lifts} prior={priorSessions(day.lifts[ex.name], date)} infoOf={(n) => exInfo(n, getCatalog(), ctx.overrides?.[n], ctx.where)} learning={isLearning(!!getCatalog().cards[ex.name], day.lifts[ex.name], date)} ex={ex} info={info} sug={sug} focus={focus} warm={warmupSets(ex, i, sug, day.exs, info, getCatalog().tags)} act={act} cards={<ExerciseCards ex={ex} info={info} date={date} lifts={day.lifts} rules={rules} notify={notify} now={now} where={wk.where ?? profile.where} />} />
          </View>
        );
      })}
      <Button label="Add exercise" kind="ghost" onPress={() => setAdding(true)} />
      <AddExerciseFlow open={adding} onClose={() => setAdding(false)} inSession={day.exs.map((e) => e.name)} workouts={workoutLists(coverageTemplates(date, profile, settings.adjustments.weekPlan as WeekPlan | undefined) as readonly string[], wk.where ?? profile.where, { date, exclusions: rules.rules.exclusions, swaps: rules.rules.swaps, lifts: day.lifts })} add={w.addExercise} notify={notify} />
      <Hint>Tap the tick with a field empty to use the suggested number. Rate each set so the next one adjusts: Easy adds a step, Couldn’t finish drops about 10%.</Hint>
      {choices ? (
        <Card>
          <Button label="Training again later today?" kind="link" onPress={() => setOpen(!open)} />
          {open ? (
            <>
              <Hint>Twice-a-day training is for experienced lifters with enough recovery. Pick different muscles from this morning’s session.</Hint>
              <View style={styles.wrap}>
                {choices.map((t) => (
                  <Chip key={t} label={`Add ${t}`} text={t} onPress={() => void w.addSecond(t)} />
                ))}
              </View>
            </>
          ) : null}
        </Card>
      ) : null}
      <CardioBlock value={wk.cardio_min} onSave={w.setCardio} />
    </>
  );

  const head = (
    <>
      <H1>{wk.template || HAND_PICKED}</H1>
      <SegmentBar exs={day.exs} />
      <Text accessibilityLabel={`${done} of ${all} sets done`} style={[type.caption, { color: c.muted }]}>
        {done} of {all} sets done, {fmt(vol)} kg lifted
      </Text>
      {notes.length ? <Note>Today: {notes.join('; ')}.</Note> : null}
      <CompletionPanel db={db} date={date} profileKg={profile.weight_kg} exs={day.exs} cardio={wk.cardio_min} lifts={day.lifts} reloadKey={reloadKey} />
    </>
  );

  // Under the rest dock (about 150 high) the last controls stay reachable.
  const spacer = <View style={{ height: 184 }} />;
  if (wide)
    return (
      <>
        {head}
        <View style={styles.cols}>
          <View style={styles.colLeft}>{stack}</View>
          <View style={styles.colSide}>{info}</View>
        </View>
        {spacer}
      </>
    );
  return (
    <>
      {head}
      {info}
      {stack}
      {spacer}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  exRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, borderTopWidth: 1 },
  cols: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  colLeft: { flex: 1, maxWidth: 560, gap: 8 },
  colRight: { flex: 1, maxWidth: 560, gap: 8 },
  colSide: { width: 360, gap: 8 },
  srOnly: { position: 'absolute', width: 1, height: 1, margin: -1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' },
});
