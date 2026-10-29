import { useCallback, useEffect, useRef, useState } from 'react';
import { buzz, PB_BUZZ } from '../haptics';
import {
  cantRule,
  restAfterTick,
  joinWithNext,
  moveExercise as coreMove,
  leaveGroup as coreLeave,
  restFor,
  noLoad,
  num,
  type ExType,
  type PrImprovement,
  rampRate,
  infoForUnit,
  rampTickFill,
  repWord,
  setTarget,
  tickFill,
  updateLift,
  isPrToday,
  priorBestOf,
  newExercise,
  lastFor,
  seededSession,
  startRoutine,
  mergeSecondSession,
  templateName,
  type CantDraft,
  type CantRule,
  HAND_PICKED,
  type Checkin,
  type Exclusion,
  type LiftRecord,
  type Milestone,
  type PriorBest,
  type PrSet,
  type Rate,
  type SessionLog,
  type Swap,
} from '@plate-and-bar/core';
import { newId } from '../db/records';
import { deleteLift, loadExerciseSets, loadLifts, loadSessionLog, loadSets, loadWorkout, saveLift, saveSet, saveWorkout, type WorkoutDb } from '../db/workouts';
import { inTransaction, type PullDb } from '../db/outbox';
import { localDate } from '../setup/logic';
import { parseCardio } from './cardio';
import { milestoneToastText, pbToastText } from './copy';
import { freshRead } from '../state/freshRead';
import { loadMilestoneData, takeNewMilestones, toastPick, type MilestoneData } from '../progress/milestoneStore';
import type { Profile } from '../setup/types';
import { displayRow, weightFromField } from './unitText';
import { buildSession } from './buildSession';
import { getCatalog } from './catalog';
import { rangesOf } from './adjust';
import { restTarget } from './restNext';
import { applyEdit, editRows, removalNote } from './groupUnits';
import type { RestNext } from './parts';
import { guidance, progressionContext, type Tuning } from './guidance';
import { cantChange, persistCant } from './cantApply';
import { dayQueue, dayWrites, enqueueDay } from './dayQueue';
import { blankRow, carryOnto, exerciseRecord, exercisesFrom, fixExGroups, isCardioOnly, mergeWorkout, setRecord, stamp, unversioned, type ExState, type Row } from './model';
import type { Workout } from './types';

export interface Day {
  ready: boolean;
  workout: Workout | null;
  exs: ExState[];
  lifts: Record<string, LiftRecord>;
  sessions: SessionLog;
}

interface Options {
  db: WorkoutDb & PullDb;
  /** The day shown (the viewed day, which may be a past one); today's date when not given. */
  date?: string;
  profile: Profile | null;
  now: () => Date;
  focus: readonly string[];
  /** Contract `Settings.adjustments` (recovery week, re-entry). */
  adjustments: Readonly<Record<string, unknown>>;
  /** The lab hold is on (#1070): new sessions are lighter. Off when not given. */
  labHold?: boolean;
  /** Short message for the toast. */
  notify: (msg: string) => void;
  /** A set was ticked and a rest follows: start the rest timer for `seconds`, then show `next` (a grouped session's dock follows it by position). */
  startRest: (seconds: number, next: RestNext) => void;
  /** The global "rest timer" setting is off: no rest starts (core's `restAfterTick`). Off when not given. */
  restOff?: boolean;
  /** Saved exercise rules and swaps; they shape the session being built. */
  exclusions: readonly Exclusion[];
  swaps: readonly Swap[];
  /** Stores a rule made by the "can't do" sheet, returning the saved record. */
  saveRule: (rule: CantRule) => Exclusion | null;
  /** Changed rep ranges and exercises coming back (settings). */
  tune: Tuning;
  /** Changes when sync stored pulled records: the day is read again (after queued local writes). */
  reloadKey?: number;
}

/** The workout a pick list was seeded from: its template and the exercises its preview showed (`BuiltSession.exercises`). */
export interface PickSeed {
  template: string;
  exercises: readonly { name: string; bridge?: boolean }[];
}

const NO_EARNED: Milestone[] = [];
const NO_PRS: ReadonlySet<string> = new Set();
const NOT_READY: Day = { ready: false, workout: null, exs: [], lifts: {}, sessions: {} };
const clone = (d: Day): Day => ({ ...d, exs: structuredClone(d.exs) });

/**
 * Today's workout: loads it from SQLite, and every action updates the screen and writes the changed
 * rows straight away (nothing waits on the network). Rules come from core; this only wires them to records.
 */
export function useWorkoutDay({ db, date: shown, profile, now, focus, adjustments, labHold = false, notify, startRest, restOff = false, exclusions, swaps, saveRule, tune, reloadKey = 0 }: Options) {
  const date = shown ?? localDate(now());
  const [day, setDay] = useState<Day>({ ready: false, workout: null, exs: [], lifts: {}, sessions: {} });
  /** The day the loaded session belongs to: while the viewed day is another one the screen is not ready, so no action runs against the old day's rows. */
  const [loaded, setLoaded] = useState<string | null>(null);
  const ref = useRef(day);
  /** Milestones earned by ticks in this session of the viewed day (new since the last shown), for the completion panel; a remount starts it empty. */
  const [earnedIn, setEarnedIn] = useState<{ date: string; list: Milestone[] }>({ date: '', list: [] });
  /** The day shown now: a start or second session that was reading history when the day changed must not commit. */
  const dateRef = useRef(date);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);
  const commit = useCallback((d: Day) => {
    ref.current = d;
    setDay(d);
  }, []);

  // Every save goes through one FIFO queue (shared with the avoid picker on Targets), so they finish in the order the
  // user acted, and each save reads the latest state from the ref when it runs (not the snapshot from when it was queued).
  /** Writes queued by this hook: `dayWrites` moving beyond them means another screen (import, the avoid picker) wrote. */
  const ownWrites = useRef(0);
  const enqueue = useCallback((write: () => Promise<void>) => {
    ownWrites.current++;
    return enqueueDay(write, () => notify('Couldn’t save that. Try again.'));
  }, [notify]);
  /** Start and second session build from stored history; a second tap while one runs is ignored. */
  const building = useRef(false);
  /** Settles when the running Start has saved; an "Add ..." tapped meanwhile waits for it instead of being dropped (#864). */
  const starting = useRef<Promise<'saved' | 'adopted' | 'failed'> | null>(null);
  /** The stored workout row as this screen last loaded or wrote it: a different stored stamp means it changed elsewhere. */
  const synced = useRef<Workout | null>(null);
  /** Bumped after a write merged a change made elsewhere, so the screen reloads and shows the merged session. */
  const [merged, setMerged] = useState(0);
  /** What writeWorkout changes in memory inside a transaction, applied once it has committed (a failed save leaves `synced` alone). */
  const deferred = useRef<(() => void)[]>([]);
  /** Sets of the build Start dropped for an adopted session (#898): local id to the adopted id the entry was carried onto, or null when it was not. A queued write for a null one has nothing to save. */
  const dropped = useRef(new Map<string, string | null>());
  /** One transaction over the day's writes; they run through the txn handle `h`. No reads beyond what the writes already do. */
  const atomic = async (task: (h: WorkoutDb) => Promise<void>) => {
    deferred.current = [];
    await inTransaction(db, (txn) => task(txn as WorkoutDb)); // a throw skips the apply below
    deferred.current.splice(0).forEach((f) => f());
  };

  useEffect(() => {
    let live = true;
    (async () => {
      // The result is applied inside freshRead, in the same step as its counter check: a session being built
      // (start, addSecond) resumes from an await and must not land between the check and the commit.
      await freshRead({ queue: dayQueue, writes: dayWrites }, () => Promise.all([loadWorkout(db, date), loadSets(db, date), loadLifts(db), loadSessionLog(db)]), () => live, ([stored, sets, lifts, sessions]) => {
        // A session deleted on another device shows as no session, so a new one can be started (#408).
        const workout = stored?.deleted_at ? null : stored;
        synced.current = stored;
        commit({
          ready: true,
          workout,
          exs: workout ? exercisesFrom(workout, sets) : [],
          lifts,
          sessions,
        });
        setLoaded(date);
      });
    })().catch(() => notify('Couldn’t read your saved workout.'));
    return () => {
      live = false;
    };
  }, [db, date, commit, notify, reloadKey, merged]);

  // These run inside the day queue, so each re-reads the stored row first: a pull (or a rule saved on Targets) may have stored
  // a newer version since the screen loaded its copy. The stored version is kept, and a row the store has tombstoned stays deleted.
  // A txn handle `h` must come from `atomic`: its in-memory update is applied there, after commit.
  // `overTombstone`: start() already saw the tombstone and is replacing it on purpose, whatever its clock says.
  const writeWorkout = async (overTombstone = false, h: WorkoutDb = db) => {
    const d = ref.current;
    if (!d.workout) return;
    const stored = await loadWorkout(h, date);
    if (!overTombstone && stored?.deleted_at && Date.parse(stored.updated_at) > Date.parse(d.workout.updated_at)) return;
    const keep = new Map((stored && !stored.deleted_at ? stored.exercises : d.workout.exercises).map((x) => [x.name, x]));
    const base = synced.current;
    // A tombstoned row is no base: a new session over it must not add `group: null` to exercises that match its grouped names.
    const was = new Map((base && !base.deleted_at ? base : d.workout).exercises.map((x) => [x.name, x]));
    const mine = { ...d.workout, exercises: d.exs.map((e) => exerciseRecord(e, keep.get(e.name), was.get(e.name))) };
    // Changed since this screen loaded or wrote it (a pull, or a rule saved on Targets): merge rather than overwrite (#410).
    // Compared by content, not by the stamp (whole seconds); a sync push only patches `version`.
    const elsewhere = !overTombstone && !!base && !!stored && !stored.deleted_at && unversioned(stored) !== unversioned(base);
    const row = { ...(elsewhere ? mergeWorkout(base, mine, stored) : mine), version: stored?.version ?? d.workout.version, updated_at: stamp(now()) };
    await saveWorkout(h, row);
    // After a merge the base stays as it was until the reload: the screen still shows its old list, so a write queued
    // before the reload has to merge again rather than write that list back.
    const apply = () => {
      if (elsewhere) setMerged((n) => n + 1);
      else synced.current = row;
    };
    if (h === db) apply();
    else deferred.current.push(apply);
  };
  /** Today's exercise by name when a queued write runs: a can't-do swap or an added exercise may have moved it (#439). */
  const exNamed = (name: string) => ref.current.exs.find((e) => e.name === name);
  /** Writes the rows with these ids of exercise `name`, looked up when the write runs; gone rows are skipped. */
  const writeSets = async (name: string, kind: 'work' | 'ramp', ids: readonly string[], h: WorkoutDb = db, shown?: readonly ExState[]) => {
    const stored = new Map((await loadSets(h, date)).map((s) => [s.id, s]));
    // Rows of one name from before #1335 can share a set number (two copies each numbered from 0). Load orders them by (number, id) and writes
    // nothing; the first write for the name renumbers every live row of it to its shown position, so a ticked set stays put after a reload.
    const rows = (shown ?? ref.current.exs).find((e) => e.name === name);
    const live = [...stored.values()].filter((s) => s.exercise === name && s.kind === kind && !s.deleted_at);
    const clash = new Set(live.map((s) => s.set_index)).size < live.length;
    const moved = clash && rows ? (kind === 'work' ? rows.sets : rows.ramp).filter((r, k) => { const s = stored.get(r.id); return !!s && !s.deleted_at && s.set_index !== k; }).map((r) => r.id) : [];
    for (const id of [...ids, ...moved.filter((m) => !ids.includes(m))]) {
      const ex = (shown ?? ref.current.exs).find((e) => e.name === name);
      const j = ex ? (kind === 'work' ? ex.sets : ex.ramp).findIndex((r) => r.id === id) : -1;
      if (!ex || j < 0) continue;
      const rec = setRecord(ex, kind, j, now());
      const was = stored.get(rec.id);
      if (was?.deleted_at) continue;
      await saveSet(h, date, { ...rec, version: was?.version ?? rec.version });
    }
  };

  // First run: the milestones already earned count as shown before any tick, so old history never toasts (#1351 A9). Queued, so a tick waits for it.
  const unit = tune.unit ?? 'kg';
  const msRef = useRef({ profile, unit, overrides: tune.overrides ?? {}, end: '' });
  useEffect(() => {
    const today = localDate(now());
    msRef.current = { profile, unit, overrides: tune.overrides ?? {}, end: date > today ? date : today };
  });
  const hasProfile = !!profile;
  /**
   * Milestone state per reload (mount, the screen's reloadKey: a pull, restore, import or a return to the tab, another day): every done set
   * and the session log without the viewed day, the weigh-ins and the shown ids. The same reload marks every milestone already earned as
   * shown, silently: only a tick on the viewed day may announce one (#1351 A9). A tick reads nothing from the db.
   */
  const msChain = useRef<Promise<void>>(Promise.resolve());
  const ms = useRef<{ data: Promise<MilestoneData | null>; foreign: number } | null>(null);
  const foreignNow = () => dayWrites.current - ownWrites.current;
  const loadMs = (): Promise<MilestoneData | null> => {
    const m = msRef.current;
    return loadMilestoneData(db, { profile: m.profile, overrides: m.overrides, unit: m.unit, end: m.end }, date).catch(() => null);
  };
  useEffect(() => {
    if (!hasProfile) {
      ms.current = null;
      return;
    }
    // Not in the day queue, so a tick's queued writes never wait on a history read. It leaves the viewed day out, the only day this hook writes,
    // so queued writes of its own cannot change what it reads.
    // On `msChain` like every evaluation, so it reads the shown ids after the write of every earlier tick and a tick's new id is never overwritten.
    const data = msChain.current.then(loadMs);
    msChain.current = data.then(() => undefined, () => undefined);
    ms.current = { data, foreign: foreignNow() };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMs reads the latest values through refs
  }, [db, hasProfile, reloadKey, date]);

  /** The all-time best before a viewed date, per lift: read once (not per tick) and dropped when the data may have changed. */
  const priorBests = useRef<{ name: string; date: string; bodyweight: number | null; prior: PriorBest }[]>([]);
  // A sync pull, an import or restore (the screen's reloadKey moves) can change any earlier day.
  const generation = useRef(0);
  useEffect(() => {
    priorBests.current = [];
    generation.current++; // a read still in flight started before this reload: its result is not stored
  }, [reloadKey]);
  /** `name|date` of lifts that toasted a personal best: once per lift per day even when the lift has no stored record to carry `pbToast` (a CSV import). */
  const toastedToday = useRef(new Set<string>());
  const priorBestFor = async (name: string, type: ExType, bodyweight: number | null): Promise<PriorBest> => {
    // A new weigh-in is a different bodyweight: assisted lifts rescore the earlier days at it.
    const hit = priorBests.current.find((p) => p.name === name && p.date === date && p.bodyweight === bodyweight);
    if (hit) return hit.prior;
    const gen = generation.current;
    const prior = priorBestOf(await loadExerciseSets(db, name), type, date, bodyweight);
    if (gen !== generation.current) return prior;
    priorBests.current = [...priorBests.current.filter((p) => p.name !== name || p.date !== date), { name, date, bodyweight, prior }];
    return prior;
  };
  /** Today's ticked and unticked work sets of an exercise as core's record rules read them. */
  const todaySets = (ex: ExState): PrSet[] =>
    ex.sets.map((r) => ({ date, exercise: ex.name, kind: 'work', weight_kg: r.w === '' ? null : num(r.w), reps: r.r === '' ? null : Math.round(num(r.r)), done: r.done, rate: r.rate }));

  /**
   * Lifts of the viewed day that are a personal best now (#1372), for the completion panel's badge and the share picture: core's `isPrToday` over
   * today's in-memory sets and the toast path's cached prior best, so the badge, the toast, History and the Recent PRs list use one rule and an untick
   * removes it. `pbToast` only gates the toast. Worked out only while the session is complete (the only time the panel shows), so a day opened
   * half-done reads no history for it.
   */
  /** `for`: the exercises the names were worked out for; a later edit makes them stale at once, so a badge never outlives the sets it was read from. */
  /** The evaluation in flight (resolved once `prs` is set), for `settlePrs`. */
  const prPending = useRef<Promise<void>>(Promise.resolve());
  const [prState, setPrState] = useState<{ for: unknown; names: ReadonlySet<string> }>({ for: null, names: NO_PRS });
  useEffect(() => {
    const exs = loaded === date ? day.exs : [];
    const sets = exs.flatMap((e) => e.sets);
    if (!profile || sets.length === 0 || sets.some((s) => !s.done)) {
      prPending.current = Promise.resolve();
      return;
    }
    let live = true;
    const ctx = progressionContext(date, day.lifts, profile, day.workout, tune);
    prPending.current = (async () => {
      const names = new Set<string>();
      for (const ex of exs) {
        const { info } = guidance(ex, ctx, day.workout);
        const prior = await priorBestFor(ex.name, info.type, profile.weight_kg).catch(() => null);
        if (prior && isPrToday(prior, todaySets(ex), info.type, profile.weight_kg)) names.add(ex.name);
      }
      if (live) setPrState({ for: day.exs, names });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- priorBestFor and todaySets read `date`, the db and refs; the sets, the day and the data version are the inputs
  }, [day.exs, loaded, date, profile?.weight_kg, reloadKey]);

  /** Recomputes the exercise's lift record from its ticked sets; shows the personal-best toast when core says so. */
  // Runs inside the day queue and builds on the stored lift records, not the screen's copy: a pull may have stored a
  // newer record (another device's session) since the screen loaded (#409).
  // `removed`: an exercise taken out of the session, recomputed as if it had no sets left.
  const syncLift = async (name: string, removed?: ExState, fromTick = false) => {
    if (!profile || !(removed ?? exNamed(name))) return;
    // This write is to `date`: the prior best of every later viewed day may have changed, whatever the rest of this does.
    priorBests.current = priorBests.current.filter((p) => p.name !== name || p.date <= date);
    const lifts = await loadLifts(db);
    const d = ref.current; // read after the await, so a tap made meanwhile is included
    const ex = removed ? { ...removed, sets: [], form: null } : exNamed(name);
    if (!ex) return;
    const { info } = guidance(ex, progressionContext(date, lifts, profile, d.workout, tune), d.workout);
    // Bodyweight for assisted machines: the latest logged weight if any (no weights table yet), else the profile's.
    const res = updateLift(lifts[ex.name], { sets: ex.sets, form: ex.form }, date, info.type, profile.weight_kg);
    if (!res) return;
    if (res.record === null) {
      // No ticked sets left and no earlier session: the lift's record is deleted (a tombstone in lift_stats).
      const { [ex.name]: _gone, ...rest } = lifts;
      ref.current = { ...ref.current, lifts: rest };
      setDay(ref.current);
      await deleteLift(db, ex.name, stamp(now()));
      return;
    }
    // The toast follows the all-time rule (core `isPrToday`), not `updateLift`'s last-8 `checkBest`. updateLift stays as it is
    // and the record it returns is corrected here: `pbToast` is `date` once a PR has toasted today (kept as before; it only gates the
    // toast to once a day). The Personal best badges do not read it: they come from the PR rule (`prs`, History's `personalRecords`), #1372.
    const was = lifts[ex.name];
    const key = `${ex.name}|${date}`;
    const toasted = was?.pbToast === date || toastedToday.current.has(key);
    let pr: PrImprovement | null = null;
    if (!toasted && ex.sets.some((s) => s.done)) {
      const prior = await priorBestFor(ex.name, info.type, profile.weight_kg);
      pr = isPrToday(prior, todaySets(ex), info.type, profile.weight_kg);
    }
    const record = { ...res.record };
    if (pr || toasted) record.pbToast = date;
    else {
      if (was?.pbToast !== undefined && was.date === date) record.pbToast = was.pbToast;
      else delete record.pbToast;
    }
    ref.current = { ...ref.current, lifts: { ...lifts, [ex.name]: record } };
    setDay(ref.current);
    await saveLift(db, ex.name, record);
    if (pr) {
      toastedToday.current.add(key);
      const unit = tune.unit ?? 'kg';
      notify(pbToastText(ex.name, pr, unit, info.type));
      buzz(PB_BUZZ);
    }
    // A milestone is looked for only on a tick (not a rate change, a form change or a removal; an untick earns none and un-shows none), in memory over
    // the reload's cache plus today's sets. The queue never waits on it: this captures what the tick needs and chains the evaluation onto `msChain`,
    // which keeps ticks in order. A history read (the reload's, or a reseed after a write by another screen) can finish a moment after the PR toast
    // and the rest timer; that is accepted. Every new milestone is marked shown and listed for the completion panel; one is toasted, and not when this tick's personal best was.
    // Known gap: done sets of the viewed day that arrive by a pull or an import (another device logged today) are left out of the reload seed on purpose,
    // so the next tick here can toast at most one milestone they earned.
    if (fromTick && ex.sets.some((s) => s.done) && dateRef.current === date) {
      const w = ref.current;
      const sets = w.exs.flatMap((e) => todaySets(e)).filter((x) => x.done);
      const entry = sets.length > 0 ? { t: w.workout?.base || w.workout?.template || HAND_PICKED, n: sets.length } : null;
      const snap = { date, sets, entry, pr: !!pr, m: msRef.current, cache: ms.current, foreign: foreignNow() };
      msChain.current = msChain.current.then(() => evaluateMilestones(snap)).catch(() => undefined);
    }
  };
  const evaluateMilestones = async (snap: { date: string; sets: PrSet[]; entry: { t: string; n: number } | null; pr: boolean; m: typeof msRef.current; cache: typeof ms.current; foreign: number }) => {
    if (!snap.cache) return;
    let data = await snap.cache.data;
    if (!data) return;
    if (snap.foreign !== snap.cache.foreign) {
      // Another screen wrote since the reload (an import): read again, silently seeding what it brought, before this tick counts. Kept on the cache for the next tick.
      data = (await loadMs()) ?? data;
      snap.cache.data = Promise.resolve(data);
      snap.cache.foreign = snap.foreign;
    }
    if (dateRef.current !== snap.date) return; // the day changed meanwhile: the cache and the sets belong to another day
    const { m } = snap;
    const fresh = await takeNewMilestones(db, data, { date: snap.date, sets: snap.sets, entry: snap.entry }, { profile: m.profile, overrides: m.overrides, unit: m.unit, end: m.end }).catch(() => []);
    if (fresh.length === 0 || dateRef.current !== snap.date) return;
    setEarnedIn((cur) => ({ date: snap.date, list: [...(cur.date === snap.date ? cur.list : []), ...fresh.filter((f) => !(cur.date === snap.date && cur.list.some((x) => x.id === f.id)))] }));
    const pick = toastPick(fresh);
    if (!snap.pr && pick) notify(milestoneToastText(pick));
  };

  /** Applies `fn` to a copy of today's exercise `i` and shows it at once; `persist` is queued and gets the exercise's name. */
  const change = (i: number, fn: (ex: ExState, d: Day) => boolean | void, persist: (name: string) => Promise<void>) => {
    const d = clone(ref.current);
    const ex = d.exs[i];
    if (!ex || fn(ex, d) === false) return;
    commit(d);
    const { name } = ex;
    void enqueue(() => persist(name));
  };
  const ids = (rows: readonly Row[]) => rows.map((r) => r.id);

  /** Cardio minutes to keep: the screen's when the user changed them since `base`, else the stored row's (a pull may have changed them). A tombstoned base counts as no minutes: the screen showed none. */
  const minutes = (screen: number | null, base: Workout | null, stored: Workout): number | null => (screen === (base && !base.deleted_at ? base.cardio_min : null) ? stored.cardio_min : screen);

  /** Starts the day's session from what `make` builds out of the stored history; shared by Start and the hand-picked start. */
  const begin = async (make: (sessions: SessionLog, d: Day) => { workout: Omit<Workout, 'cardio_min'>; exs: ExState[] }) => {
      // A cardio-only day (minutes logged, no session) is not a started session: Start turns it into one and keeps the minutes.
      if (!profile || building.current || (ref.current.workout && !isCardioOnly(ref.current.workout))) return;
      building.current = true;
      let finished: (outcome: 'saved' | 'adopted' | 'failed') => void = () => {};
      let outcome: 'saved' | 'adopted' | 'failed' = 'failed';
      starting.current = new Promise((r) => (finished = r));
      try {
        const sessions = await loadSessionLog(db);
        if (dateRef.current !== date) return; // the day changed while the history was read
        const d = clone(ref.current);
        const made = make(sessions, d);
        d.workout = { ...made.workout, cardio_min: d.workout?.cardio_min ?? null };
        d.sessions = sessions;
        d.exs = made.exs;
        commit(d);
        // One transaction: the old sets' tombstones, the workout row and the new sets are stored together or not at all (#516).
        await enqueue(async () => {
          let adopted = false;
          await atomic(async (h) => {
            // Started over a session deleted on another device: its sets go with it, so the new session does not
            // pick them up (the contract does not promise that the deleting device tombstoned them).
            const stored = await loadWorkout(h, date);
            if (stored && !stored.deleted_at && !isCardioOnly(stored)) {
              // A live session is already stored (pulled from another device, or kept after a removal) that this screen
              // has not shown yet: never overwrite it; read it again so it shows instead.
              // That session is stored, so Start counts as saved and a waiting Add applies to it, not to the one built here.
              setMerged((n) => n + 1);
              adopted = true;
              // Writes queued against the local build (a tick made while Start waited) run after this and would write that build
              // over the stored row (#898). Make the adopted session the one they act on, with the user's entries carried onto its
              // matching sets; they then find the adopted rows by name and skip the local ids, keeping the stored id and version.
              const { exs, changed, kept } = carryOnto(exercisesFrom(stored, await loadSets(h, date)), ref.current.exs);
              for (const c of changed) await writeSets(c.name, 'work', c.ids, h, exs);
              deferred.current.push(() => {
                synced.current = stored;
                kept.forEach((to, from) => dropped.current.set(from, to));
                ref.current = { ...ref.current, workout: stored, exs };
                setDay(ref.current);
              });
              return;
            }
            const overTombstone = !!stored?.deleted_at;
            if (overTombstone) {
              const at = stamp(now());
              for (const s of await loadSets(h, date)) if (!s.deleted_at) await saveSet(h, date, { ...s, updated_at: at, deleted_at: at });
            }
            // A cardio-only row pulled but not shown yet: its minutes carry over unless the user changed them on this screen.
            const mine = ref.current.workout;
            if (stored && !stored.deleted_at && mine) {
              const keep = minutes(mine.cardio_min, synced.current, stored);
              if (keep !== mine.cardio_min) {
                // The ref changes now (the workout row below is built from it); the screen shows it once the transaction has committed.
                ref.current = { ...ref.current, workout: { ...mine, cardio_min: keep } };
                deferred.current.push(() => setDay(ref.current));
              }
            }
            await writeWorkout(overTombstone, h);
            for (const ex of d.exs) await writeSets(ex.name, 'work', ids(ex.sets), h);
          });
          outcome = adopted ? 'adopted' : 'saved'; // only once the transaction has resolved: a failed COMMIT throws before this
        });
      } finally {
        building.current = false;
        starting.current = null;
        finished(outcome);
      }
  };

  const start = useCallback(
    (template: string, checkin: Checkin, ciChoice: Workout['ci_choice'], override: Workout['where'] = null) =>
      begin((sessions, d) => {
        const built = buildSession({ template, date, profile: profile as Profile, where: override ?? (profile as Profile).where, sessions, lifts: d.lifts, ciChoice, checkin, focus, exclusions, swaps, adjustments, labHold });
        return {
          workout: { id: null, version: 0, updated_at: stamp(now()), deleted_at: null, date, template: templateName(template, override ?? (profile as Profile).where), base: template, where: override, mods: built.mods, exercises: [], ci_choice: ciChoice },
          exs: built.exercises.map((e) => ({ name: e.name, part: 1, bridge: e.bridge, form: null, found: null, skipRamp: false, feel: null, sets: Array.from({ length: e.sets }, blankRow), ramp: [] })),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, profile, date, focus, adjustments, labHold, exclusions, swaps, commit, enqueue],
  );

  /**
   * Start from hand-picked exercises, from any workout (prototype `exPick` with no template): a "Session" with each exercise's default sets and the start screen's where override and check-in choice (prototype keeps `w.ciChoice`).
   * With a `seed` (the picks started from a previewed workout, #1020) the session keeps that workout as `base` and gets its check-in, re-entry and deload adjustments (core `seededSession`); deliberately unlike `exPick`.
   */
  const startPicked = (names: readonly string[], override: Workout['where'] = null, ciChoice: Workout['ci_choice'] = null, seed: PickSeed | null = null, time: string | null = null) =>
    begin((sessions, d) => {
      const blank = (n: number) => Array.from({ length: n }, blankRow);
      if (!seed) {
        return {
          workout: { id: null, version: 0, updated_at: stamp(now()), deleted_at: null, date, template: HAND_PICKED, base: null, where: override, mods: {}, exercises: [], ci_choice: ciChoice },
          exs: names.map((name) => ({ name, part: 1, bridge: false, form: null, found: null, skipRamp: false, feel: null, sets: newExercise(name, { lifts: d.lifts, date }, 1).sets.map(() => blankRow()), ramp: [] })),
        };
      }
      const where = override ?? (profile as Profile).where;
      const { deload, reentry } = rangesOf(adjustments);
      const made = seededSession({ base: seed.template, seeded: seed.exercises, picks: names, date, ciChoice, time, where, profile: profile as Profile, deload, reentry, labHold, focus, tags: getCatalog().tags, lastSets: (n) => lastFor(n, d.lifts, date)?.sets.length });
      return {
        workout: { id: null, version: 0, updated_at: stamp(now()), deleted_at: null, date, template: templateName(seed.template, where), base: made.base, where: override, mods: made.mods, exercises: [], ci_choice: ciChoice },
        exs: made.exercises.map((e) => ({ name: e.name, part: 1, bridge: e.bridge, form: null, found: null, skipRamp: false, feel: null, sets: blank(e.sets), ramp: [] })),
      };
    });

  /**
   * Start from a saved routine (#1184): a hand-picked session (`HAND_PICKED`, no base, so the rotation skips it) with the routine's
   * names and stored set counts; core's `startRoutine` applies only the deload and light steps. Exercises the library lacks or the
   * rules exclude stay in the session, and the screen flags them. Like every start, never overwrites a session already stored.
   */
  const startFromRoutine = (routine: readonly { name: string; sets: number; group?: string | null }[], override: Workout['where'] = null, ciChoice: Workout['ci_choice'] = null) =>
    begin(() => {
      const where = override ?? (profile as Profile).where;
      const { deload, reentry } = rangesOf(adjustments);
      const cat = getCatalog();
      const made = startRoutine({ date, ciChoice, where, profile: profile as Profile, deload, reentry, tags: cat.tags, routine, catalogue: Object.keys(cat.tags), exclusions, newId });
      return {
        workout: { id: null, version: 0, updated_at: stamp(now()), deleted_at: null, date, template: HAND_PICKED, base: null, where: override, mods: made.mods, exercises: [], ci_choice: ciChoice },
        exs: made.exercises.map((e) => ({ name: e.name, part: 1, bridge: false, form: null, found: null, skipRamp: false, feel: null, ...(e.group ? { group: e.group } : {}), sets: Array.from({ length: e.sets }, blankRow), ramp: [] })),
      };
    });

  const addSecond = useCallback(
    async (template: string) => {
      // A tap during the Start save waits for it, then adds (the screen already shows the chips once Start has committed).
      // If that save failed, give up: the failure toast stays and the user taps again. A date change while waiting drops the Add on purpose: the user left that day.
      const started = starting.current ? await starting.current : 'saved';
      if (started === 'failed') return;
      if (!profile || building.current) return;
      building.current = true;
      try {
        if (started === 'adopted') {
          // Start kept the stored session; take it as the base, as the reload that is under way will. Done after `building` is claimed, so a double tap commits it once.
          const [stored, storedSets] = await Promise.all([loadWorkout(db, date), loadSets(db, date)]);
          if (dateRef.current !== date) return;
          if (!stored || stored.deleted_at) return;
          synced.current = stored;
          commit({ ...ref.current, workout: stored, exs: exercisesFrom(stored, storedSets) });
        }
        if (!ref.current.workout) return;
        const sessions = await loadSessionLog(db);
        if (dateRef.current !== date) return; // the day changed while the history was read
        const d = clone(ref.current);
        const old = d.workout as Workout;
        const built = buildSession({
          template,
          date,
          profile,
          where: old.where ?? profile.where,
          sessions,
          lifts: d.lifts,
          ciChoice: old.ci_choice,
          checkin: {},
          focus,
          exclusions,
          swaps,
          adjustments,
          labHold,
        });
        const first = d.exs.length;
        const builtEx: ExState[] = built.exercises.map((e) => ({ name: e.name, part: 1, bridge: e.bridge, form: null, found: null, skipRamp: false, feel: null, sets: Array.from({ length: e.sets }, blankRow), ramp: [] }));
        const merged = mergeSecondSession({ exercises: d.exs, template: old.template, base: old.base, mods: old.mods }, template, { exercises: builtEx, mods: built.mods });
        const added = merged.exercises.slice(first) as ExState[];
        d.exs = merged.exercises as ExState[];
        d.workout = { ...old, template: merged.template, base: merged.base, mods: merged.mods };
        commit(d);
        notify(`${template} added to today`);
        await enqueue(() =>
          atomic(async (h) => {
            await writeWorkout(false, h);
            for (const ex of added) await writeSets(ex.name, 'work', ids(ex.sets), h);
          }),
        );
      } finally {
        building.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, profile, date, focus, adjustments, labHold, exclusions, swaps, commit, enqueue, notify],
  );

  const editSet = (i: number, kind: 'work' | 'ramp', j: number, field: 'w' | 'r', value: string) => {
    let id = '';
    change(
      i,
      (ex) => {
        const row = (kind === 'work' ? ex.sets : ex.ramp)[j];
        if (!row) return false;
        (row as Record<'w' | 'r', string>)[field] = value;
        id = row.id;
      },
      (name) => writeSets(name, kind, [id]),
    );
  };

  const tick = (i: number, j: number) => {
    const d0 = ref.current;
    const ex0 = d0.exs[i];
    if (!profile || !d0.workout || !ex0) return;
    const ctx = progressionContext(date, d0.lifts, profile, d0.workout, tune);
    const { info, sug } = guidance(ex0, ctx, d0.workout);
    let id = '';
    let empty: 'w' | 'r' | undefined;
    change(
      i,
      (ex, d) => {
        const s = ex.sets[j];
        if (!s) return false;
        id = s.id;
        if (s.done) {
          s.done = false;
          s.rate = null;
          s.t = null;
          ex.form = null;
          return;
        }
        const unit = ctx.unit ?? 'kg';
        const uinfo = infoForUnit(info, unit);
        const f = tickFill(displayRow(s, unit), setTarget(ex.sets.map((r) => displayRow(r, unit)), j, sug, uinfo, ex.found, unit), uinfo, unit);
        if (!f.ok) {
          empty = f.w === '' && !noLoad(info.type) ? 'w' : 'r';
          notify(`Enter the ${noLoad(info.type) ? '' : 'weight and '}${repWord(info.type)} first.`);
          return false;
        }
        if (s.w === '') s.w = weightFromField(f.w, unit) ?? ''; // a typed weight is left as it is; only a blank takes the suggestion (as kg text)
        s.r = f.r;
        s.done = true;
        s.t = stamp(now());
        if (d.exs.some((e) => e.group)) {
          // A grouped session: core's restAfterTick says whether a rest follows and what comes next. Only here, when the set has just been ticked: core treats it as done.
          const r = restAfterTick(d.exs.map((e) => ({ name: e.name, sets: e.sets.length, group: e.group })), i, j, (k, n) => !!d.exs[k]?.sets[n]?.done, { restOff, tags: getCatalog().tags });
          if (r.kind !== 'none' && r.next) startRest(r.seconds, restTarget(d.exs, i, r.next));
        } else if (!restOff) {
          // An ungrouped session: as before groups.
          const nj = ex.sets.findIndex((x) => !x.done);
          const nx = d.exs.slice(i + 1).find((e) => e.sets.some((x) => !x.done));
          const from = d.exs.slice(i).map((e) => e.name);
          const total = restFor(ex.name, getCatalog().tags);
          if (nj >= 0) startRest(total, { label: `Next: set ${nj + 1} of ${ex.name}`, from });
          else if (nx) startRest(total, { label: `Next: ${nx.name}`, from });
        }
      },
      async (name) => {
        if (dropped.current.get(id) === null) return;
        await atomic(async (h) => {
          await writeSets(name, 'work', [id], h);
          await writeWorkout(false, h);
        });
        await syncLift(name, undefined, true);
      },
    );
    return empty;
  };

  const rate = (i: number, j: number, value: Rate | null) => {
    let id = '';
    change(
      i,
      (ex) => {
        const s = ex.sets[j];
        if (!s) return false;
        s.rate = value;
        id = s.id;
      },
      async (name) => {
        if (dropped.current.get(id) === null) return;
        await writeSets(name, 'work', [id]);
        await syncLift(name);
      },
    );
  };

  /**
   * Cardio minutes for today, from the field's text (see `parseCardio`). With no workout yet this stores a cardio-only day
   * (see `isCardioOnly`), as the prototype lets you log cardio before, or without, a session; blank text on such a day stores nothing.
   */
  const setCardio = (text: string) => {
    const d = clone(ref.current);
    const cardio_min = parseCardio(text);
    if (d.workout) {
      d.workout = { ...d.workout, cardio_min };
      commit(d);
      void enqueue(() => writeWorkout());
      return;
    }
    if (cardio_min === null) return;
    d.workout = { id: null, version: 0, updated_at: stamp(now()), deleted_at: null, date, template: null, base: null, where: null, cardio_min, mods: {}, exercises: [], ci_choice: null };
    commit(d);
    void enqueue(() =>
      atomic(async (h) => {
        const stored = await loadWorkout(h, date);
        if (stored && !stored.deleted_at) {
          // A session pulled from another device that this screen has not shown yet: the minutes go onto it, never over it.
          // The screen's latest value, which may be a cleared field (null): not the first keystroke this write was queued with.
          const row = { ...stored, cardio_min: ref.current.workout ? ref.current.workout.cardio_min : cardio_min, updated_at: stamp(now()) };
          await saveWorkout(h, row);
          const sets = await loadSets(h, date);
          // Shown once the transaction has committed: a failed save leaves the screen as it was.
          deferred.current.push(() => {
            ref.current = { ...ref.current, workout: row, exs: exercisesFrom(row, sets) };
            synced.current = row;
            setDay(ref.current);
          });
          return;
        }
        // Over a session deleted on another device: its sets go with it, as when starting one (the contract does not
        // promise that the deleting device tombstoned them).
        if (stored) {
          const at = stamp(now());
          for (const s of await loadSets(h, date)) if (!s.deleted_at) await saveSet(h, date, { ...s, updated_at: at, deleted_at: at });
        }
        await writeWorkout(!!stored, h);
      }),
    );
  };

  const setForm = (i: number, form: 'yes' | 'no' | null) =>
    change(
      i,
      (ex) => {
        ex.form = form;
      },
      async (name) => {
        await writeWorkout();
        await syncLift(name);
      },
    );

  /** Saves the answer to "Where did you feel that set most?" (prototype `feel`). */
  const setFeel = (i: number, feel: string) =>
    change(
      i,
      (ex) => {
        ex.feel = feel;
      },
      () => writeWorkout(),
    );

  /** After "It hurt": drops the sets not done yet (prototype `feel-skip`); their stored rows become tombstones. */
  const skipRemaining = (i: number) => {
    let gone: Row[] = [];
    change(
      i,
      (ex) => {
        gone = ex.sets.filter((s) => !s.done);
        if (!gone.length) return false;
        ex.sets = ex.sets.filter((s) => s.done);
        notify('Skipped the remaining sets');
      },
      async (name) => {
        const at = stamp(now());
        const goneIds = new Set(gone.map((g) => g.id));
        for (const stored of (await loadSets(db, date)).filter((s) => goneIds.has(s.id) && !s.deleted_at)) await saveSet(db, date, { ...stored, updated_at: at, deleted_at: at });
        await writeSets(name, 'work', ids(exNamed(name)?.sets ?? [])); // the rows left move up: set_index is the position
      },
    );
  };

  /**
   * "Complete workout": finishes early with only the ticked sets. Unticked work sets become tombstones and an exercise with no
   * ticked set is removed, in one commit and one transaction, so a reload never sees half of it. Ratings, ramps of kept
   * exercises and cardio stay. False when nothing is ticked. Lift records are untouched: only ticked sets feed them.
   */
  const finishEarly = () => {
    const d = clone(ref.current);
    if (!d.workout) return false;
    const gone = new Set<string>();
    const goneEx = new Set<string>();
    const kept: ExState[] = [];
    for (const e of d.exs) {
      if (!e.sets.some((s) => s.done)) goneEx.add(e.name);
      else {
        for (const s of e.sets) if (!s.done) gone.add(s.id);
        e.sets = e.sets.filter((s) => s.done);
        kept.push(e);
      }
    }
    if (!kept.length) return false;
    d.exs = fixExGroups(kept); // a group left with under 2 members is dissolved, before the write and before the planned snapshot's signature
    commit(d);
    void enqueue(() =>
      atomic(async (h) => {
        const at = stamp(now());
        for (const s of await loadSets(h, date)) if (!s.deleted_at && (gone.has(s.id) || goneEx.has(s.exercise))) await saveSet(h, date, { ...s, updated_at: at, deleted_at: at });
        await writeWorkout(false, h);
        for (const e of kept) await writeSets(e.name, 'work', ids(e.sets), h); // the rows left move up: set_index is the position
      }),
    );
    return true;
  };

  const rampStart = (i: number) => {
    const row = blankRow();
    change(i, (ex) => void (ex.ramp = [row]), (name) => writeSets(name, 'ramp', [row.id]));
  };

  const rampSkip = (i: number) =>
    change(
      i,
      (ex) => {
        ex.ramp = [];
        ex.skipRamp = true;
        ex.found = null;
      },
      () => writeWorkout(),
    );

  const rampAdd = (i: number) => {
    const row = blankRow();
    change(i, (ex) => void ex.ramp.push(row), (name) => writeSets(name, 'ramp', [row.id]));
  };

  /** Adds a working set at the last set's weight, reps empty (prototype `addset`). */
  const addSet = (i: number) => {
    const row = blankRow();
    change(
      i,
      (ex) => void ex.sets.push({ ...row, w: ex.sets[ex.sets.length - 1]?.w ?? '' }),
      (name) => writeSets(name, 'work', [row.id]),
    );
  };

  /** Removes the last working set when there is more than one (prototype `rmset`): its stored row becomes a tombstone. */
  const removeSet = (i: number) => {
    let gone: Row | undefined;
    change(
      i,
      (ex) => {
        if (ex.sets.length <= 1) return false;
        gone = ex.sets.pop();
        notify('Set removed'); // announced: the button may disappear with it (one set left)
      },
      async (name) => {
        if (!gone) return;
        const stored = (await loadSets(db, date)).find((s) => s.id === gone?.id);
        if (stored && !stored.deleted_at) {
          const at = stamp(now());
          await saveSet(db, date, { ...stored, updated_at: at, deleted_at: at });
        }
        if (gone.done) await syncLift(name); // a ticked set counted toward the lift record
      },
    );
  };

  /**
   * Groups exercise `i` with the next one (core's `joinWithNext` decides; a refused one changes nothing): a new group id for two ungrouped
   * exercises, the id of the group the other one is in, or, for two groups, the first group's id for both. Returns the names of the group's members in order, or null when refused.
   */
  const groupWithNext = (i: number): string[] | null => {
    const d = clone(ref.current);
    if (!d.workout) return null;
    const out = joinWithNext(editRows(d.exs), i, (k, s) => !!d.exs[k]?.sets[s]?.done, newId);
    if (!out) return null;
    d.exs = applyEdit(d.exs, out.exs);
    const members = d.exs.slice(out.members[0], out.members[1]).map((e) => e.name);
    commit(d);
    void enqueue(() => writeWorkout());
    return members;
  };

  /**
   * Moves exercise `i` one step up (-1) or down (+1); core's `moveExercise` keeps the groups valid (a member at the edge leaves its group; an
   * ungrouped exercise hops a whole superset) and null refuses (list end, other session part). Returns the exercise list as it is now and the
   * exercise's new index, or null when refused.
   */
  const moveExercise = (i: number, dir: -1 | 1): { exs: readonly ExState[]; to: number } | null => {
    const d = clone(ref.current);
    if (!d.workout) return null;
    const out = coreMove(editRows(d.exs), i, dir);
    if (!out) return null;
    d.exs = applyEdit(d.exs, out.exs);
    commit(d);
    void enqueue(() => writeWorkout());
    return { exs: d.exs, to: out.to };
  };

  /**
   * Takes exercise `i` out of its superset and keeps it in the session (core's `leaveGroup`): explicit `group: null` on it, and on the other member when a pair
   * dissolves (ADR 012). Returns the exercise list as it is now and the exercise's new index, or null when `i` is in no superset.
   */
  const leaveGroup = (i: number): { exs: readonly ExState[]; to: number } | null => {
    const d = clone(ref.current);
    if (!d.workout) return null;
    const out = coreLeave(editRows(d.exs), i);
    if (!out) return null;
    d.exs = applyEdit(d.exs, out.exs);
    commit(d);
    void enqueue(() => writeWorkout());
    return { exs: d.exs, to: out.to };
  };

  /** Dissolves the group of exercise `i`: every member gets an explicit `group: null` (ADR 012: the three-way merge must see the ungroup). Returns the former members' names, or null when `i` is in no group. */
  const ungroup = (i: number): string[] | null => {
    const d = clone(ref.current);
    const id = d.exs[i]?.group;
    if (!d.workout || !id) return null;
    const members = d.exs.filter((e) => e.group === id);
    for (const e of members) e.group = null;
    commit(d);
    void enqueue(() => writeWorkout());
    return members.map((e) => e.name);
  };

  /**
   * Adds a library exercise to today's session (prototype `exPick`): as many blank work sets as its last session, at least 3
   * (core `newExercise`). It joins the last exercise's part, so it shows with the session it was added to. A name already in
   * the session is refused: the contract keeps names unique within a workout.
   */
  const addExercise = (name: string) => {
    const d = clone(ref.current);
    if (!d.workout || d.exs.some((e) => e.name === name)) return false;
    const part = d.exs[d.exs.length - 1]?.part ?? 1;
    const built = newExercise(name, { lifts: d.lifts, date }, part);
    const ex: ExState = { name, part, bridge: false, form: null, found: null, skipRamp: false, feel: null, sets: built.sets.map(() => blankRow()), ramp: [] };
    d.exs = [...d.exs, ex];
    if (!d.workout.template) d.workout = { ...d.workout, template: HAND_PICKED };
    commit(d);
    // One transaction: a sync push or pull never sees the exercise without its sets (#492), and a failure stores neither.
    void enqueue(() =>
      atomic(async (h) => {
        await writeWorkout(false, h);
        await writeSets(name, 'work', ids(ex.sets), h);
      }),
    );
    return true;
  };

  /**
   * Removes the exercise named `name` from today's session (prototype `delex`); false when it is not in the session. Its stored set rows become tombstones and its lift record
   * is recomputed without them. Removing the last one deletes today's workout, so a new session can be started (#413).
   */
  const removeExercise = (name: string) => {
    const d = clone(ref.current);
    const gone = d.exs.find((e) => e.name === name);
    if (!gone || !d.workout) return false;
    d.exs = fixExGroups(d.exs.filter((e) => e.name !== name)); // a group left with under 2 members is dissolved
    const last = d.exs.length === 0;
    // The last exercise out ends the session, not the cardio minutes (prototype delex): they stay as a cardio-only day.
    const cardio = d.workout.cardio_min;
    if (last) d.workout = cardio === null ? null : { ...d.workout, template: null, base: null, where: null, mods: {}, exercises: [], ci_choice: null };
    commit(d);
    void enqueue(async () => {
      const at = stamp(now());
      let after: Workout | null | undefined; // the base to keep once the transaction has committed
      let show = false;
      // One transaction: the tombstoned sets and the workout row change together or not at all (#516).
      await atomic(async (h) => {
        after = undefined;
        show = false;
        // Every stored row of the exercise, also ones a pull stored that this screen never loaded.
        for (const s of await loadSets(h, date)) if (s.exercise === name && !s.deleted_at) await saveSet(h, date, { ...s, updated_at: at, deleted_at: at });
        if (last) {
          const stored = await loadWorkout(h, date);
          if (stored && !stored.deleted_at) {
            // Exercises another device added since this screen loaded are not this removal's to delete: keep them.
            const base = synced.current;
            const elsewhere = stored.exercises.filter((e) => e.name !== name && !base?.exercises.some((b) => b.name === e.name));
            if (elsewhere.length) {
              const row = { ...stored, exercises: elsewhere, updated_at: at };
              await saveWorkout(h, row);
              after = row;
              show = true; // show them
            } else if (minutes(cardio, base, stored) !== null) {
              // The stored minutes decide, not the screen's copy, when the screen never changed them (a pull may have stored some).
              const cardio_min = minutes(cardio, base, stored);
              const row = { ...stored, template: null, base: null, where: null, mods: {}, exercises: [], ci_choice: null, cardio_min, updated_at: at };
              await saveWorkout(h, row);
              after = row;
              show = cardio_min !== cardio; // pulled minutes the screen did not have: show them
            } else {
              await saveWorkout(h, { ...stored, updated_at: at, deleted_at: at });
              after = null;
            }
          }
        } else await writeWorkout(false, h);
      });
      if (after !== undefined) synced.current = after;
      if (show) setMerged((n) => n + 1);
      if (gone.sets.some((s) => s.done)) await syncLift(gone.name, gone);
    });
    return true;
  };

  const rampTick = (i: number, j: number) => {
    const d0 = ref.current;
    const ex0 = d0.exs[i];
    if (!profile || !ex0) return;
    const { info } = guidance(ex0, progressionContext(date, d0.lifts, profile, d0.workout, tune), d0.workout);
    let id = '';
    let empty: 'w' | undefined;
    change(
      i,
      (ex) => {
        const s = ex.ramp[j];
        if (!s) return false;
        id = s.id;
        if (s.done) {
          s.done = false;
          s.rate = null;
          s.t = null;
          ex.found = null;
          return;
        }
        const unit = tune.unit ?? 'kg';
        const f = rampTickFill(ex.ramp.map((r) => displayRow(r, unit)), j, infoForUnit(info, unit), unit);
        if (!f.ok) {
          empty = 'w';
          notify('Enter the weight first.');
          return false;
        }
        if (s.w === '') s.w = weightFromField(f.w, unit) ?? '';
        s.r = f.r;
        s.done = true;
        s.t = stamp(now());
      },
      async (name) => {
        await atomic(async (h) => {
          await writeSets(name, 'ramp', [id], h);
          await writeWorkout(false, h);
        });
      },
    );
    return empty;
  };

  const rampRated = (i: number, j: number, value: Rate | null) => {
    let rows: string[] = [];
    const d0 = ref.current;
    const ex0 = d0.exs[i];
    if (!profile || !ex0) return;
    const { info } = guidance(ex0, progressionContext(date, d0.lifts, profile, d0.workout, tune), d0.workout);
    const unit = tune.unit ?? 'kg';
    change(
      i,
      (ex) => {
        (ex.ramp[j] as { rate: Rate | null }).rate = value;
        const r = rampRate(ex.ramp.map((x) => displayRow(x, unit)), j, value, infoForUnit(info, unit), unit);
        ex.found = r.found;
        if (r.addSet) ex.ramp.push(blankRow());
        rows = ids(ex.ramp); // the rows this action touched, fixed now (not whatever is there when the write runs)
      },
      async (name) => {
        await atomic(async (h) => {
          await writeSets(name, 'ramp', rows, h);
          await writeWorkout(false, h);
        });
      },
    );
  };

  /**
   * The "can't do" sheet's pick. A timed or permanent answer saves a rule (`today` does not, it only steers
   * today's session); core's `cantSession` replaces the tapped exercise, and anything else today a wider rule covers.
   * An exercise with ticked sets keeps them and the replacement follows it, as in the prototype.
   */
  const cant = (i: number | null, draft: CantDraft, choice: string | null) => {
    // A session never holds one name twice (#1340): the sheet never offers a name already in it, and core refuses it too. Nothing is saved or changed.
    if (choice && ref.current.exs.some((e) => e.name === choice)) {
      notify(`${choice} is already in today’s session.`);
      return;
    }
    const rule = cantRule(draft, choice, date);
    const gone = removalNote(ref.current.exs, draft.name).toast; // said before the exercises change: a member of a superset leaves it
    const today = draft.dur === 'today';
    const saved = today ? null : saveRule(rule);
    if (!today && !saved) return; // the rules could not be read: nothing is changed (the store said why)
    const d = clone(ref.current);
    const w = d.workout;
    if (w) {
      const at = stamp(now());
      const rows = new Map<string, Row>();
      const records = d.exs.flatMap((e) => {
        for (const r of [...e.sets, ...e.ramp]) rows.set(r.id, r);
        return [...e.sets.keys()].map((j) => setRecord(e, 'work', j, now())).concat([...e.ramp.keys()].map((j) => setRecord(e, 'ramp', j, now())));
      });
      // `w` (the loaded row) is only the stored copy and never decides the group; the base is `synced.current`, the row last written, so after an Ungroup it holds the explicit null and a swap keeps writing it.
      const ch = cantChange({ ...w, exercises: d.exs.map((e) => exerciseRecord(e, w.exercises.find((x) => x.name === e.name), (synced.current ?? w).exercises.find((x) => x.name === e.name))) }, records, i, draft, choice, w.where ?? profile?.where ?? 'gym', exclusions, d.lifts, date, at);
      d.exs = ch.exercises.map((x) => {
        const pick = (kind: 'work' | 'ramp'): Row[] =>
          ch.sets
            .filter((s) => s.exercise === x.name && s.kind === kind)
            .sort((a, b) => a.set_index - b.set_index)
            .map((s) => rows.get(s.id) ?? { id: s.id, version: s.version, w: '', r: '', done: false, rate: null, t: null });
        return { name: x.name, part: x.part, bridge: x.bridge, form: x.form, found: x.found_kg, skipRamp: x.skip_ramp, feel: x.feel ?? null, group: x.group ?? null, sets: pick('work'), ramp: pick('ramp') };
      });
      d.workout = { ...w, exercises: ch.exercises };
      commit(d);
      void enqueue(async () => {
        // Through the same merge as writeWorkout (#444): a row changed elsewhere keeps what it gained there.
        const out = await persistCant(db, date, w, ch, at, synced.current);
        // Written as is: that row is the new base (a second swap must not see the first as added elsewhere). Merged or
        // deleted elsewhere: read the day again.
        if (out === 'stale') setMerged((n) => n + 1);
        else synced.current = out;
      });
    }
    notify(choice ? `Swapped in ${choice}` : gone);
  };

  return { date, msSettled: () => msChain.current, earned: earnedIn.date === date ? earnedIn.list : NO_EARNED, prs: loaded === date && prState.for === day.exs ? prState.names : NO_PRS, settlePrs: () => prPending.current, day: loaded === date ? day : NOT_READY, cant, setCardio, editSet, tick, rate, setForm, setFeel, skipRemaining, rampStart, rampSkip, rampAdd, rampTick, rampRated, addSet, removeSet, groupWithNext, moveExercise, leaveGroup, ungroup, addExercise, removeExercise, finishEarly, start, startPicked, startFromRoutine, addSecond };
}
