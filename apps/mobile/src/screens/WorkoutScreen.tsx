import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type ReactNode } from 'react';
import { profileWhyValues } from '../why/values';
import { WhyLink } from '../why/WhyLink';
import { useFocusEffect } from 'expo-router';
import { AccessibilityInfo, Platform, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import { useDataVersion } from '../sync/useDataVersion';
import { Text } from '../components/Text';
import { HAND_PICKED, ROUTINE_EXERCISES_MAX, routineFromSession, modsNote, overridesFromSettings, missingExercises, plannedCoverage, type WeekPlan, secondSessionChoices, sessionVolume, beginnerRamp, checkinFlags, isFocus, nextInList, coverageTemplates, mondayOf, planned, warmupRamp, type Checkin, isLearning, exInfo, fromKg, canGroupWithNext, infoForUnit, priorSessions, REST_EXTEND_SEC, type ExclusionReason } from '@plate-and-bar/core';
import { fmt } from '../format';
import { ClearanceCard } from '../components/ClearanceCard';
import { Button, Card, Chip, Disclosure, H1, Hint, MetricRow, Note, Page, useScrollToTopOn } from '../components/ui';
import { type } from '../theme/tokens';
import type { WorkoutDb } from '../db/workouts';
import type { PullDb } from '../db/outbox';
import { useProfile } from '../state/ProfileProvider';
import { useSettings } from '../state/SettingsProvider';
import { useTheme } from '../theme/useTheme';
import { buildSession } from '../workout/buildSession';
import { getCatalog } from '../workout/catalog';
import { CHECKIN, REASON_TEXT, listJoin, modsNoteText, muscleName, ROUTINE_COPY, MY_ROUTINES } from '../workout/copy';
import { ExerciseCard, type Actions } from '../workout/ExerciseCard';
import { ringUntilBlur } from '../workout/focusRing';
import { SupersetBlock } from '../workout/SupersetBlock';
import { groupEx, groupReason, groupRounds, groupUnits, removalNote, upNext, type Unit } from '../workout/groupUnits';
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
import { SaveRoutineSheet } from '../workout/SaveRoutineSheet';
import { RoutinesSection, type PendingUndo } from '../workout/RoutinesSection';
import { FinishWorkout } from '../workout/FinishWorkout';
import { useScrollIntoView } from '../workout/scrollIntoView';
import { focusNode } from '../labelscan/focus';
import { LibraryEntryButton } from '../library/LibraryEntryButton';
import { Hero, IndexThumb, SegmentBar, StartButton } from '../workout/SessionHeader';
import { DOCK_FALLBACK_H, DOCK_SPACER_MARGIN, HowToSheet, RestBar, ToastBar, type GroupNext, type RestNext, type RestState } from '../workout/parts';
import { restRetarget } from '../workout/restNext';
import { useRestNotification } from '../reminders/useRestNotification';
import { usePersistedRest } from '../workout/restStore';
import { useRules } from '../workout/useRules';
import { useWeightUnit } from '../settings/weightUnit';
import { useWorkoutDay, type PickSeed } from '../workout/useWorkoutDay';
import { useLabHold } from '../labs/useLabHold';
import { labs } from '../labs/content';
import type { Workout } from '../workout/types';
import type { ExState } from '../workout/model';
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
  const v = useViewedDate(now);
  const startRest = useCallback((total: number, next: RestNext) => {
    const t = Date.now();
    setRest({ id: t, end: t + total * 1000, total, ...next, date: v.date });
  }, [v.date]);

  // Tab screens stay mounted; rules removed on the Targets tab show here when this tab is shown again.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  // Pulled records (sync) also make the rules and the day read again, without a remount.
  const dataVersion = useDataVersion();
  const rulesApi = useRules({ db, now, notify, reloadKey: shown + dataVersion });
  const { rules, addRule } = rulesApi;
  const winW = useWindowDimensions().width;
  const wide = winW >= 1024;
  const { unit } = useWeightUnit();
  const tune = useMemo(() => ({ overrides: overridesFromSettings(settings.exercise_overrides), returning: settings.returning, unit }), [settings.exercise_overrides, settings.returning, unit]);
  const labHold = useLabHold(db); // the lab hold (#1070): new sessions are lighter
  const w = useWorkoutDay({ db, date: v.date, profile, now, focus, notify, startRest, restOff, labHold: labHold === true, adjustments: settings.adjustments, exclusions: rules.exclusions, swaps: rules.swaps, saveRule: addRule, tune, reloadKey: shown + dataVersion });
  const { day } = w;
  usePersistedRest(db, rest, setRest, v.date);
  // The rest as a notification while the app is in the background (#1068); its +30 s and Skip come back through setRest.
  useRestNotification({ db, rest, setRest, sessionActive: day.exs.length > 0 });
  // The dock never names an exercise that is gone or finished: it moves on to the next one with an undone set, or closes when none is left.
  // Only on the day it started on (the rest keeps running while another day is read). Adjusting state while rendering, as React documents.
  if (rest?.from && rest.date === v.date && day.ready) {
    // Only exercises from the ticked one onward (the prototype's tick rule), never an earlier skipped one.
    const open = new Set(day.exs.filter((e) => e.sets.some((x) => !x.done)).map((e) => e.name));
    const first = rest.from.find((n) => open.has(n));
    if (first !== rest.from[0] || !first) setRest(first ? { ...rest, label: `Next: ${first}`, from: rest.from.slice(rest.from.indexOf(first)) } : null);
  } else if (rest?.at && rest.to && rest.date === v.date && day.ready) {
    // A grouped session: the dock follows it by position.
    const t = restRetarget(day.exs, rest as GroupNext);
    if (!t) setRest(null);
    else if (t !== (rest as GroupNext)) setRest({ ...rest, ...t });
  }
  const addRest = () => setRest((r) => (r ? { ...r, end: r.end + REST_EXTEND_SEC * 1000, total: r.total + REST_EXTEND_SEC } : r));
  const [cantName, setCantName] = useState<{ i: number; name: string; reason?: ExclusionReason } | null>(null);

  // Brings a node into view above the rest dock (when one is up). One mechanism for the session: the up-next set of a superset, the finish question.
  const [measuredDock, setMeasuredDock] = useState<number | null>(null);
  const dockH = measuredDock ?? DOCK_FALLBACK_H;
  const scroll = useScrollIntoView();
  // Each rest mounts a new dock, whose height is only known after its first layout (its label can be longer than the last one's), and a tick's rest can
  // start after the render that moved the marker. So the node revealed for a tick (`last`, cleared by the next tick: `reveal(null)`) is scrolled to again,
  // once, on the first layout of a new rest's dock. A later height change never scrolls (the user may have scrolled), and nothing is timed.
  const dock = useRef<{ id: number; h: number } | null>(null); // the last dock laid out: its rest and height
  const last = useRef<ComponentRef<typeof View> | null>(null);
  const reveal = (node: ComponentRef<typeof View> | null | undefined) => {
    last.current = node ?? null;
    if (!node) return;
    if (!rest) scroll.reveal(node, 0);
    else if (dock.current?.id === rest.id) scroll.reveal(node, dock.current.h);
    // else: this rest's dock has no height yet; its first layout reveals the node
  };
  const onDockHeight = (h: number, id: number) => {
    setMeasuredDock(h); // for the page spacer
    const first = dock.current?.id !== id;
    dock.current = { id, h };
    if (first && last.current) scroll.reveal(last.current, h);
  };
  const restBar = <RestBar rest={rest} onAdd={addRest} onSkip={() => setRest(null)} onHeight={onDockHeight} />;
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
        <StartView key={w.date} now={now} db={db} w={w} labHold={labHold === true} profile={profile} focus={focus} rules={rulesApi} notify={notify} tune={tune} />
      ) : (
        <SessionView key={w.date} reveal={reveal} dockH={dockH} now={now} db={db} reloadKey={shown + dataVersion} w={w} profile={profile} focus={focus} rules={rulesApi} notify={notify} tune={tune} onHowTo={setHowTo} onCant={(i, name, reason) => setCantName(reason ? { i, name, reason } : { i, name })} />
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
            // Renames the swapped exercise in the rest dock's list (it tracks names). The label changes only when it named that exercise: the replacement starts at set 1.
            if (cantName && choice) setRest((r) => (r?.from?.includes(cantName.name) && r.date === v.date ? { ...r, ...(r.from[0] === cantName.name ? { label: `Next: ${choice}` } : {}), from: r.from.map((n) => (n === cantName.name ? choice : n)) } : r));
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
      <Page resetKey={day.exs.length > 0} wide={wide} scroller={scroll.scroller}>
        {/* On a wide screen the content is two columns in Page's wide container, the same one Food and Targets use. */}
        <View style={styles.body}>
          <DateBar v={v} />
          {content}
        </View>
      </Page>
      {sheets}
      {restBar}
      <ToastBar message={toast} top />
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

function StartView({ now, db, w, labHold, profile, focus, rules, notify, tune }: { now: () => Date; db: WorkoutDb; w: W; labHold: boolean; profile: Prof; focus: readonly string[]; rules: ReturnType<typeof useRules>; notify: (msg: string) => void; tune: Tuning }) {
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
  // A routine just deleted, waiting for Undo. Kept here: the section unmounts while a preview or pick list is open.
  const [undo, setUndo] = useState<PendingUndo | null>(null);
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

  // Start passes the seed only while a seeded exercise is still picked (#1020); those sessions keep the lab hold.
  const seededStart = seed && picked.some((n) => seed.exercises.some((e) => e.name === n)) ? seed : null;
  const action = picked.length ? (
    <>
      <StartButton label={`Start ${picked.length === 1 ? 'this exercise' : 'these exercises'}`} onPress={() => void w.startPicked(picked, override, choice, seededStart, ci.time ?? null)} />
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

  // Saved routines sit beside the plan, not in place of it; they are hidden while a preview or a pick list is open (the pending Undo is kept).
  const routinesView = previewT || picked.length ? null : <RoutinesSection db={db} notify={notify} undo={undo} setUndo={setUndo} onStart={(r) => void w.startFromRoutine(r.exercises, override, choice)} />;

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
          <IndexThumb n={i + 1} name={n} />
          <Text accessibilityLabel={`Exercise ${i + 1}: ${n}`} style={{ flex: 1 }}>
            <Text style={[type.bodyStrong, { color: c.ink }]}>{n}</Text>
            <Text style={[type.caption, { color: c.muted }]}>{'\n'}{listJoin((getCatalog().tags[n]?.primary ?? []).map((m) => muscleName(m)))}</Text>
            {isFocus(n, focus, getCatalog().tags) ? <Text style={[type.bodyStrong, { color: c.ink }]}> Focus</Text> : null}
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
        {built.left.length ? ` ${listJoin(built.left)} ${built.left.length === 1 ? 'rotates' : 'rotate'} in on your other ${startT} days.` : ''}
      </Hint>
      {built.lost.map((n) => (
        <Hint key={n}>
          {n} is left out with no replacement{getCatalog().tags[n] ? `, so your ${listJoin(getCatalog().tags[n]!.primary.map((m) => muscleName(m)))} get fewer sets each week` : ''}.
        </Hint>
      ))}
    </>
  ) : null;

  // Inline and above Start, as in the prototype: the answers shape the session Start builds, so they are never behind a tap.
  const checkin = (
    hasBuilt && built ? (
      <View style={{ gap: 8 }}>
        <Text style={[type.bodyStrong, { color: c.ink }]}>Quick check-in (optional)</Text>
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
      </View>
    ) : null
  );

  const disclosures = (
    <>
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
      <LibraryEntryButton />
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
      {labHold && !(picked.length && !seededStart) ? <Note>{labs.workout_note}</Note> : null}
    </>
  );
  const cardio = <CardioBlock value={day.workout?.cardio_min ?? null} onSave={w.setCardio} />;

  if (wide)
    return (
      <>
        {top}
        <View style={styles.cols}>
          <View style={styles.colLeft}>
            {cards}
            {hero}
            {checkin}
            {action}
            {routinesView}
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
      {cards}
      {hero}
      {checkin}
      {action}
      {musclesView}
      {exerciseList}
      {notes}
      {routinesView}
      {disclosures}
      {cardio}
      {flow}
    </>
  );
}

function SessionView({ reveal, dockH, now, db, reloadKey, w, profile, focus, rules, notify, tune, onHowTo, onCant }: { reveal: (node: ComponentRef<typeof View> | null | undefined) => void; dockH: number; now: () => Date; db: WorkoutDb; reloadKey: number; w: W; profile: Prof; focus: readonly string[]; rules: ReturnType<typeof useRules>; notify: (msg: string) => void; tune: Tuning; onHowTo: (n: string) => void; onCant: (i: number, name: string, reason?: ExclusionReason) => void }) {
  const c = useTheme();
  const { date, day } = w;
  const { settings } = useSettings();
  const { unit } = useWeightUnit();
  const wide = useWindowDimensions().width >= 1024;
  const [open, setOpen] = useState(false);
  // The muscle map is open until the first set is ticked (prototype sessionMapHtml); once the user taps it, their choice stays.
  const [mapOpen, setMapOpen] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [savingRoutine, setSavingRoutine] = useState(false);
  // After Complete workout the panel appears; focus moves to its heading once it is there.
  const focusPanel = useRef(false);
  const panelHeading = useRef<ComponentRef<typeof RNText>>(null);
  // One exercise is expanded at a time: the user's pick, else the first with sets left. Acting on an exercise pins it, so its rating chips and form question stay put after its last tick.
  const [pinned, setPinned] = useState<string | null>(null);
  const wk = day.workout as Workout;
  const ctx = progressionContext(date, day.lifts, profile, wk, tune);
  let done = 0;
  let all = 0;
  for (const ex of day.exs)
    for (const s of ex.sets) {
      all++;
      if (s.done) done++;
    }
  const notes = modsNote(wk.mods).map(modsNoteText);
  // A routine session (or any hand-picked one) can hold a name the library no longer has, or one the user's rules exclude: flagged, kept until removed.
  const flagged = wk.template === HAND_PICKED ? missingExercises(day.exs.map((e) => e.name), { catalogue: Object.keys(getCatalog().tags), exclusions: rules.rules.exclusions, tags: getCatalog().tags }) : [];
  const choices = secondSessionChoices({ exercises: day.exs, template: wk.template, base: wk.base }, profile);
  const vol = sessionVolume(day.exs);
  const { primary: mainMuscles, secondary: alsoMuscles } = musclesOf(day.exs.map((e) => e.name));
  const mapShown = mapOpen ?? done === 0;
  const complete = all > 0 && done === all;
  // "Complete workout" drops the unticked sets and exercises, so the planned session is kept from the moment it is pressed.
  // It stays valid only while the exercise list (names and set counts) is the one Complete left behind (`sig`, taken once the drop has landed);
  // any later change (add, swap, remove, second session, sync reload) discards it and the live session is saved.
  // v1 limit: the snapshot is component state, so after a remount (another day and back, app reload) the post-drop session is what gets saved.
  const sig = JSON.stringify(day.exs.map((e) => [e.name, e.sets.length, e.group ?? null]));
  const [finished, setFinished] = useState<{ routine: ReturnType<typeof routineFromSession>; total: number; sig: string | null } | null>(null);
  const live = { routine: routineFromSession(day.exs.map((e) => ({ name: e.name, sets: e.sets.length, group: e.group }))), total: day.exs.length };
  const { routine, total } = complete && finished && (finished.sig === null || finished.sig === sig) ? finished : live;
  // Adjusting state during render (React's pattern for state derived from props): take the signature once the drop has landed, drop the snapshot when the list moves on.
  if (finished && finished.sig === null && complete) setFinished({ ...finished, sig });
  else if (finished && finished.sig !== null && finished.sig !== sig) setFinished(null);
  useEffect(() => {
    if (!focusPanel.current || !complete) return;
    focusPanel.current = false;
    focusNode(panelHeading.current);
  }, [complete]);
  const current = pinned && day.exs.some((e) => e.name === pinned) ? pinned : (day.exs.find((e) => e.sets.some((s) => !s.done))?.name ?? null);
  const units = groupUnits(day.exs);
  // The open unit is every unit holding an exercise with the current name (as on base, where `expanded` was `ex.name === current`): a name twice opens both copies.
  const inUnit = (u: Unit) => (current ? day.exs.findIndex((e, k) => k >= u.start && k < u.end && e.name === current) : -1);
  // A live region, and on iOS (which has none) an announcement: where focus is not enough (a group made, the marker moving).
  const [said, setSaid] = useState('');
  const say = (msg: string) => {
    setSaid(msg);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(msg);
  };
  // Focus lands on a node (the block header, an exercise heading) once the render that shows it is done; nodes register by key.
  const [nodes] = useState(() => new Map<string, ComponentRef<typeof RNText>>());
  const [focusOn, setFocusOn] = useState<{ key: string } | null>(null);
  const reg = (key: string) => (n: ComponentRef<typeof RNText> | null) => void (n ? nodes.set(key, n) : nodes.delete(key));
  // The ring colour is read when focus is applied, not a dependency: a theme change must not move focus again.
  const ring = useRef(c.focus);
  useEffect(() => void (ring.current = c.focus));
  useEffect(() => {
    const node = focusOn ? nodes.get(focusOn.key) : null;
    if (!node) return;
    focusNode(node);
    // After a click the browser draws no ring on a script-focused node (:focus-visible); the user must see where focus went, as after a key press.
    if (Platform.OS === 'web') {
      ringUntilBlur(node as unknown as HTMLElement, ring.current);
    }
  }, [focusOn, nodes]);
  // The marker moved inside the open superset (a tick): say where. Not on first show, and not when another unit opened.
  const open0 = units.find((u) => u.labels.length > 0 && inUnit(u) >= 0);
  const marker = open0 ? upNext(day.exs, open0.start, open0.end) : null;
  const markerKey = open0 && marker ? `${open0.start}.${open0.end}:${marker.ex}:${marker.set}` : null;
  const lastMarker = useRef<string | null>(null);
  const upRow = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    const before = lastMarker.current;
    lastMarker.current = markerKey;
    // Same unit, same members (a member just added is announced as a new superset, not as a move of the marker).
    if (before && !markerKey) setSaid(''); // the block is done (or closed): an old "Up next" must not stay in the live region
    if (!before || !markerKey || before === markerKey || before.split(':')[0] !== markerKey.split(':')[0] || !open0 || !marker) return;
    say(`Up next: ${day.exs[marker.ex]?.name}, ${String.fromCharCode(65 + marker.ex - open0.start)}${marker.set + 1}.`);
    // The up-next row may be off-screen (a block of 3 or more, long cards): scroll it into view, only when it is not already.
    reveal(upRow.current);
  }, [markerKey]); // eslint-disable-line react-hooks/exhaustive-deps -- says once per move
  const removeNamed = (n: string) => {
    const note = removalNote(day.exs, n);
    if (!w.removeExercise(n)) return;
    notify(note.toast);
    if (note.said) say(note.said);
  };

  // The map is open until the first tick on every width (prototype sessionMapHtml).
  const info = (
    <>
      {mainMuscles.length ? (
        <View>
          <Disclosure label={`Muscles today: ${listJoin(mainMuscles.map((m) => muscleName(m)))}`} open={mapShown} onOpenChange={setMapOpen}>
            <BodyMap primary={mainMuscles} secondary={alsoMuscles} />
          </Disclosure>
        </View>
      ) : null}
    </>
  );

  const ungroup = (u: Unit) => {
    const names = w.ungroup(u.start);
    if (!names) return;
    setPinned(names[0] as string);
    setFocusOn({ key: `ex:${names[0]}` });
    notify('Superset ungrouped');
  };
  const group = (i: number) => {
    const names = w.groupWithNext(i);
    if (!names) return;
    setPinned((day.exs[i] as ExState).name);
    setFocusOn({ key: `header:${names[0]}` });
    say(`${listJoin(names)} are now a superset.`);
  };
  /** One exercise's card: a lone exercise, or a member of the superset `m.unit` (then `m.next` is the set up next in it). */
  const card = (i: number, expanded: boolean, m?: { unit: Unit; next: { ex: number; set: number } | null }) => {
    const ex = day.exs[i] as ExState;
    const { info, sug } = guidance(ex, ctx, wk);
    const pin = () => setPinned(ex.name);
    const act: Actions = {
      edit: (kind, j, f, v) => (pin(), w.editSet(i, kind, j, f, v)),
      tick: (j) => (pin(), reveal(null), w.tick(i, j)),
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
      remove: () => removeNamed(ex.name),
    };
    // "Superset with next": on an open exercise, with core's rule and the first-time ramp (the app's); hidden when there is no offer.
    let superset: ComponentProps<typeof ExerciseCard>['superset'];
    const nx = day.exs[i + 1];
    const rule = canGroupWithNext(groupEx(day.exs), i, (k, s) => !!day.exs[k]?.sets[s]?.done);
    // Hidden: no offer here, or this exercise is itself finished (a finished card stays open; it says nothing about supersets).
    const finished = ex.sets.length > 0 && ex.sets.every((x) => x.done);
    const hidden = finished || (!rule.ok && (rule.why === 'last' || rule.why === 'inner'));
    if (expanded && nx && nx.part === ex.part && !hidden) {
      const ramping = (e: ExState) => guidance(e, ctx, wk).sug.mode === 'new' && !e.skipRamp && e.found === null && !e.sets.some((x) => x.done);
      const pending = [ex, nx].find(ramping);
      superset = { next: nx.name, reason: groupReason(rule, day.exs.map((e) => e.name)) ?? (pending ? `Finish the first-time ramp for ${pending.name} first.` : null), onPress: () => group(i) };
    }
    const lead = m ? (m.next ? m.next.ex : expanded ? inUnit(m.unit) : -1) : -1;
    return (
      <ExerciseCard
        key={ex.name}
        {...(superset ? { superset } : {})}
        {...(m ? { member: { letter: String.fromCharCode(65 + i - m.unit.start), upNext: !!m.next && m.next.ex === i }, compact: expanded && lead !== i, currentSet: m.next && m.next.ex === i ? m.next.set : -1 } : {})}
        headingRef={reg(`ex:${ex.name}`)}
        upNextRef={upRow}
        expanded={expanded}
        onToggle={pin}
        notify={notify}
        lifts={day.lifts}
        prior={priorSessions(day.lifts[ex.name], date)}
        infoOf={(n) => exInfo(n, getCatalog(), ctx.overrides?.[n], ctx.where)}
        learning={isLearning(!!getCatalog().cards[ex.name], day.lifts[ex.name], date)}
        ex={ex}
        info={info}
        sug={sug}
        focus={focus}
        warm={warmupRamp(ex, i, sug, day.exs, infoForUnit(info, unit), getCatalog().tags)}
        act={act}
        cards={<ExerciseCards ex={ex} info={info} date={date} lifts={day.lifts} rules={rules} notify={notify} now={now} where={wk.where ?? profile.where} />}
      />
    );
  };

  const stack = (
    <>
      {units.map((u) => {
        const open = inUnit(u) >= 0;
        const first = day.exs[u.start] as ExState;
        const second = first.part === 2 && day.exs[u.start - 1]?.part !== 2 ? <H1 level={2}>Second session</H1> : null;
        if (u.labels.length === 0) return <View key={first.name} style={{ gap: 8 }}>{second}{card(u.start, open)}</View>;
        const members = day.exs.slice(u.start, u.end);
        const next = upNext(day.exs, u.start, u.end);
        return (
          <View key={`g:${first.name}`} style={{ gap: 8 }}>
            {second}
            <SupersetBlock names={members.map((e) => e.name)} rounds={groupRounds(members)} open={open} headerRef={reg(`header:${first.name}`)} onUngroup={() => ungroup(u)}>
              {members.map((_, k) => card(u.start + k, open, { unit: u, next }))}
            </SupersetBlock>
          </View>
        );
      })}
      <Button label="Add exercise" kind="ghost" onPress={() => setAdding(true)} />
      {routine.length && !complete ? <Button label={ROUTINE_COPY.action} kind="ghost" onPress={() => setSavingRoutine(true)} /> : null}
      {savingRoutine ? <SaveRoutineSheet db={db} exercises={routine} defaultName={wk.template && wk.template !== HAND_PICKED ? wk.template : ''} capped={total > ROUTINE_EXERCISES_MAX} onSaved={(n) => (setSavingRoutine(false), notify(ROUTINE_COPY.saved(n)))} onClose={() => setSavingRoutine(false)} /> : null}
      <AddExerciseFlow open={adding} onClose={() => setAdding(false)} inSession={day.exs.map((e) => e.name)} workouts={workoutLists(coverageTemplates(date, profile, settings.adjustments.weekPlan as WeekPlan | undefined) as readonly string[], wk.where ?? profile.where, { date, exclusions: rules.rules.exclusions, swaps: rules.rules.swaps, lifts: day.lifts })} add={w.addExercise} notify={notify} />
      <Hint>Tap the tick to log a set. An empty field uses the suggested number when there is one; on a first-time exercise, enter it yourself. Rate each set so the next one adjusts: Easy adds a step, Couldn’t finish drops about 10%.</Hint>
      {choices ? (
        <Card>
          <Button label="Training again later today?" kind="link" onPress={() => setOpen(!open)} />
          {open ? (
            <>
              <Hint>Twice-a-day training is for experienced lifters with enough recovery. Pick different muscles from your earlier session today.</Hint>
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
      {done > 0 && !complete ? <FinishWorkout done={done} all={all} onAsk={reveal} onFinish={() => {
          if (!w.finishEarly()) return;
          setFinished({ routine, total, sig: null });
          focusPanel.current = true;
        }} /> : null}
    </>
  );

  const head = (
    <>
      <Text testID="session-announce" accessibilityLiveRegion="polite" style={styles.srOnly}>{Platform.OS === 'ios' ? '' : said}</Text>
      <H1>{wk.template || HAND_PICKED}</H1>
      <SegmentBar exs={day.exs} />
      <Text accessibilityLabel={`${done} of ${all} sets done`} style={[type.caption, { color: c.muted }]}>
        {done} of {all} sets done, {fmt(fromKg(vol, unit))} {unit} lifted
      </Text>
      <WhyLink id="split" label="Why these exercises?" values={profileWhyValues(profile)} />
      {/* Once every set is ticked the completion panel shows the burn estimate; showing it here too would repeat it. */}
      {complete ? null : <BurnLine db={db} date={date} profileKg={profile.weight_kg} exs={day.exs} cardio={wk.cardio_min} reloadKey={reloadKey} />}
      {notes.length ? <Note>Today: {notes.join('; ')}.</Note> : null}
      {flagged.map(({ name: n, reason }) => (
        <View key={n} style={styles.wrap}>
          <View style={styles.fill}>
            <Note>{reason === 'unknown' ? MY_ROUTINES.unknown(n) : MY_ROUTINES.excluded(n)}</Note>
          </View>
          <Chip label={MY_ROUTINES.removeLabel(n)} text={MY_ROUTINES.remove} onPress={() => removeNamed(n)} />
        </View>
      ))}
      <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <CompletionPanel earned={w.earned} headingRef={panelHeading} db={db} date={date} profileKg={profile.weight_kg} exs={day.exs} cardio={wk.cardio_min} lifts={day.lifts} reloadKey={reloadKey} {...(routine.length ? { onSaveRoutine: () => setSavingRoutine(true) } : {})} />
      </View>
    </>
  );

  // Under the rest dock the last controls stay reachable.
  const spacer = <View testID="dock-spacer" style={{ height: dockH + DOCK_SPACER_MARGIN }} />;
  if (wide)
    return (
      <>
        {head}
        <View style={styles.cols}>
          <View style={styles.colMain}>{stack}</View>
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
  colMain: { flex: 1, gap: 8 },
  colRight: { flex: 1, maxWidth: 560, gap: 8 },
  colSide: { width: 360, gap: 8 },
  srOnly: { position: 'absolute', width: 1, height: 1, margin: -1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' },
});
