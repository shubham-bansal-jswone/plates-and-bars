import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { modsNote, secondSessionChoices, sessionVolume, beginnerRamp, checkinFlags, isFocus, nextInList, planList, planned, restFor, warmupSets, type Checkin } from '@plate-and-bar/core';
import { fmt } from '../format';
import { Button, H1, Hint, Note, Page } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { useProfile } from '../state/ProfileProvider';
import { useTheme } from '../theme/useTheme';
import { buildSession } from '../workout/buildSession';
import { catalog } from '../workout/catalog';
import { CHECKIN, MUSCLE, REASON_TEXT, listJoin, modsNoteText } from '../workout/copy';
import { ExerciseCard, type Actions } from '../workout/ExerciseCard';
import { guidance, progressionContext } from '../workout/guidance';
import { Card, Chip, HowToSheet, RestBar, ToastBar, type RestState } from '../workout/parts';
import { useWorkoutDay } from '../workout/useWorkoutDay';
import type { Workout } from '../workout/types';

const NO_FOCUS: readonly string[] = [];

interface Props {
  db: WorkoutDb;
  /** Clock, injectable for tests. */
  now?: () => Date;
  /** Focus muscles (contract `Settings.focus`); the app has no settings store yet. */
  focus?: readonly string[];
}

/** Workout tab: today's planned session with Start, then the session itself. */
export function WorkoutScreen({ db, now = () => new Date(), focus = NO_FOCUS }: Props) {
  const { profile, status } = useProfile();
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
    const total = restFor(name, catalog.tags);
    const t = Date.now();
    setRest({ id: t, end: t + total * 1000, total, label });
  }, []);

  const w = useWorkoutDay({ db, profile, now, focus, notify, startRest });
  const { day } = w;

  if (status !== 'ready' || !day.ready) return <Page><Hint>Loading…</Hint></Page>;
  if (!profile)
    return (
      <Page>
        <H1>Workout</H1>
        <Hint>Finish setup first, so the app can plan your sessions.</Hint>
      </Page>
    );

  const body =
    day.exs.length === 0 ? (
      <StartView w={w} profile={profile} focus={focus} />
    ) : (
      <SessionView w={w} profile={profile} focus={focus} onHowTo={setHowTo} />
    );
  return (
    <View style={styles.fill}>
      {body}
      <HowToSheet name={howTo} onClose={() => setHowTo(null)} />
      <RestBar rest={rest} onAdd={() => setRest((r) => (r ? { ...r, end: r.end + 30000, total: r.total + 30 } : r))} onSkip={() => setRest(null)} />
      <ToastBar message={toast} />
    </View>
  );
}

type W = ReturnType<typeof useWorkoutDay>;
type Prof = NonNullable<ReturnType<typeof useProfile>['profile']>;

function StartView({ w, profile, focus }: { w: W; profile: Prof; focus: readonly string[] }) {
  const c = useTheme();
  const { date, day } = w;
  const [ci, setCi] = useState<Checkin>({});
  const [choice, setChoice] = useState<Workout['ci_choice']>(null);
  const plan = planned(date, { profile, sessions: day.sessions });
  const nextT = plan ? nextInList(plan, profile) : null;
  const flags = checkinFlags(ci, nextT);
  const startT = choice === 'swap' && nextT ? nextT : plan;
  const pick = <K extends keyof Checkin>(k: K, v: NonNullable<Checkin[K]>) => {
    const next: Checkin = { ...ci, [k]: ci[k] === v ? undefined : v };
    setCi(next);
    if (!checkinFlags(next, nextT).flagged) setChoice(null);
  };
  const built = startT
    ? buildSession({ template: startT, date, profile, where: profile.where, sessions: day.sessions, lifts: progressionContext(date, day.lifts, profile, null).lifts, ciChoice: choice, checkin: ci, focus })
    : null;
  const names = built ? built.exercises.map((e) => e.name) : [];
  const prim = [...new Set(names.flatMap((n) => catalog.tags[n]?.primary ?? []))];
  const eachSets = built && built.exercises.length && built.exercises.every((e) => e.sets === built.exercises[0]?.sets) ? built.exercises[0]?.sets : null;
  const others = (planList(profile) as readonly string[]).filter((k) => k !== plan);

  return (
    <Page>
      <H1>{plan ? `${plan} day` : 'Rest day'}</H1>
      <Hint>
        {plan
          ? 'Start with the planned exercises, then swap or add anything you like.'
          : 'Rest and recovery today. A walk and enough protein count. You can still log a session.'}
      </Hint>
      {plan && built && startT ? (
        <Card>
          <Text style={{ color: c.ink, fontSize: 15 }}>
            <Text style={{ fontWeight: '700' }}>Main focus: </Text>
            {listJoin(prim.map((m) => MUSCLE[m] ?? m))}
          </Text>
          {names.map((n, i) => (
            <Text key={n} accessibilityLabel={`Exercise ${i + 1}: ${n}`} style={{ color: c.ink, fontSize: 15 }}>
              {i + 1}. <Text style={{ fontWeight: '700' }}>{n}</Text>
              <Text style={{ color: c.muted }}> {listJoin((catalog.tags[n]?.primary ?? []).map((m) => MUSCLE[m] ?? m))}</Text>
              {isFocus(n, focus, catalog.tags) ? <Text style={{ color: c.brand, fontWeight: '800' }}> Focus</Text> : null}
            </Text>
          ))}
          <Hint>
            {names.length} exercises{eachSets ? `, ${eachSets} sets each${beginnerRamp(profile, date) ? ' for your first 2 weeks' : ''}` : ''}
            {names.some((n) => isFocus(n, focus, catalog.tags)) ? ', plus 1 on focus muscles' : ''}
            {profile.minutes ? `, sized to your ${profile.minutes}-minute sessions` : ''}.
            {built.left.length ? ` ${listJoin(built.left)} rotate in on other ${startT} days.` : ''}
          </Hint>

          <View style={[styles.checkin, { borderColor: c.line }]}>
            <Text style={{ color: c.ink, fontWeight: '700' }}>Quick check-in <Text style={{ color: c.muted, fontWeight: '400' }}>Optional</Text></Text>
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
                <View style={styles.wrap}>
                  <Chip label="Lighter session" pressed={choice === 'light'} onPress={() => setChoice('light')} />
                  {flags.swapTo ? <Chip label={`Swap with ${flags.swapTo}`} pressed={choice === 'swap'} onPress={() => setChoice('swap')} /> : null}
                  <Chip label="Keep original" pressed={choice === 'orig'} onPress={() => setChoice('orig')} />
                </View>
              </View>
            ) : flags.good ? (
              <Hint>Good to go.</Hint>
            ) : null}
            {built?.mods.short ? <Hint>{ci.time} minutes: the main {built.exercises.length} exercises only.</Hint> : null}
          </View>
          <Button label={`Start ${startT}`} onPress={() => void w.start(startT, ci, choice)} />
        </Card>
      ) : null}
      <View style={styles.wrap}>
        {others.map((k) => (
          <Chip key={k} label={`Start ${k}`} text={k} onPress={() => void w.start(k, ci, choice)} />
        ))}
      </View>
    </Page>
  );
}

function SessionView({ w, profile, focus, onHowTo }: { w: W; profile: Prof; focus: readonly string[]; onHowTo: (n: string) => void }) {
  const c = useTheme();
  const { date, day } = w;
  const [open, setOpen] = useState(false);
  const wk = day.workout as Workout;
  const ctx = progressionContext(date, day.lifts, profile, wk);
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

  return (
    <Page>
      <H1>{wk.template || 'Session'}</H1>
      <Text accessibilityLabel={`${done} of ${all} sets done`} style={{ color: c.muted, fontSize: 14 }}>
        {done} of {all} sets done, {fmt(vol)} kg lifted
      </Text>
      {notes.length ? <Note>Today: {notes.join('; ')}.</Note> : null}
      {day.exs.map((ex, i) => {
        const { info, sug } = guidance(ex, ctx, wk);
        const act: Actions = {
          edit: (kind, j, f, v) => w.editSet(i, kind, j, f, v),
          tick: (j) => w.tick(i, j),
          rate: (j, v) => w.rate(i, j, v),
          form: (v) => w.setForm(i, v),
          rampStart: () => w.rampStart(i),
          rampSkip: () => w.rampSkip(i),
          rampAdd: () => w.rampAdd(i),
          rampTick: (j) => w.rampTick(i, j),
          rampRate: (j, v) => w.rampRated(i, j, v),
          howTo: () => onHowTo(ex.name),
        };
        return (
          <View key={ex.name} style={{ gap: 8 }}>
            {ex.part === 2 && day.exs[i - 1]?.part !== 2 ? <H1>Second session</H1> : null}
            <ExerciseCard ex={ex} info={info} sug={sug} focus={focus} warm={warmupSets(ex, i, sug, day.exs, info, catalog.tags)} act={act} />
          </View>
        );
      })}
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
      <View style={{ height: 120 }} />
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  checkin: { borderTopWidth: 1, paddingTop: 10, gap: 10 },
});
