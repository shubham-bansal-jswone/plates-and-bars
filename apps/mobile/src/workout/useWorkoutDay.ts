import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cantRule,
  lastFor,
  widerRuleReplacements,
  noLoad,
  rampRate,
  rampTickFill,
  repWord,
  setTarget,
  tickFill,
  updateLift,
  mergeSecondSession,
  templateName,
  type CantDraft,
  type CantRule,
  type Checkin,
  type Exclusion,
  type LiftRecord,
  type Rate,
  type SessionLog,
  type Swap,
} from '@plate-and-bar/core';
import { deleteLift, loadLifts, loadSessionLog, loadSets, loadWorkout, saveLift, saveSet, saveWorkout, type WorkoutDb } from '../db/workouts';
import { localDate } from '../setup/logic';
import { freshRead } from '../state/freshRead';
import type { Profile } from '../setup/types';
import { buildSession } from './buildSession';
import { guidance, progressionContext, type Tuning } from './guidance';
import { catalog } from './catalog';
import { blankRow, exerciseRecord, exercisesFrom, setRecord, stamp, type ExState } from './model';
import type { Workout } from './types';

export interface Day {
  ready: boolean;
  workout: Workout | null;
  exs: ExState[];
  lifts: Record<string, LiftRecord>;
  sessions: SessionLog;
}

interface Options {
  db: WorkoutDb;
  profile: Profile | null;
  now: () => Date;
  focus: readonly string[];
  /** Short message for the toast. */
  notify: (msg: string) => void;
  /** A set was ticked: start the rest timer for `name`, then show `next`. */
  startRest: (name: string, next: string) => void;
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

const clone = (d: Day): Day => ({ ...d, exs: structuredClone(d.exs) });

/**
 * Today's workout: loads it from SQLite, and every action updates the screen and writes the changed
 * rows straight away (nothing waits on the network). Rules come from core; this only wires them to records.
 */
export function useWorkoutDay({ db, profile, now, focus, notify, startRest, exclusions, swaps, saveRule, tune, reloadKey = 0 }: Options) {
  const date = localDate(now());
  const [day, setDay] = useState<Day>({ ready: false, workout: null, exs: [], lifts: {}, sessions: {} });
  const ref = useRef(day);
  const commit = useCallback((d: Day) => {
    ref.current = d;
    setDay(d);
  }, []);

  // Every save goes through one FIFO queue, so they finish in the order the user acted, and each save reads
  // the latest state from the ref when it runs (not the snapshot from when it was queued).
  const queue = useRef<Promise<void>>(Promise.resolve());
  const writes = useRef(0);
  const enqueue = useCallback(
    (write: () => Promise<void>) => {
      writes.current++;
      queue.current = queue.current.then(write).catch(() => notify('Couldn’t save that. Try again.'));
      return queue.current;
    },
    [notify],
  );
  /** Start and second session build from stored history; a second tap while one runs is ignored. */
  const building = useRef(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const read = await freshRead({ queue, writes }, () => Promise.all([loadWorkout(db, date), loadSets(db, date), loadLifts(db), loadSessionLog(db)]), () => live);
      if (!read || !live) return;
      const [workout, sets, lifts, sessions] = read;
      commit({
        ready: true,
        workout,
        exs: workout ? exercisesFrom(workout, sets) : [],
        lifts,
        sessions,
      });
    })().catch(() => notify('Couldn’t read your saved workout.'));
    return () => {
      live = false;
    };
  }, [db, date, commit, notify, reloadKey]);

  const writeWorkout = async () => {
    const d = ref.current;
    if (d.workout) await saveWorkout(db, { ...d.workout, exercises: d.exs.map(exerciseRecord), updated_at: stamp(now()) });
  };
  const writeSets = async (i: number, kind: 'work' | 'ramp', indexes: number[]) => {
    for (const j of indexes) {
      const ex = ref.current.exs[i];
      if (ex && (kind === 'work' ? ex.sets : ex.ramp)[j]) await saveSet(db, date, setRecord(ex, kind, j, now()));
    }
  };

  /** Recomputes the exercise's lift record from its ticked sets; shows the personal-best toast when core says so. */
  const syncLift = async (i: number) => {
    const d = ref.current;
    const ex = d.exs[i];
    if (!profile || !ex) return;
    const { info } = guidance(ex, progressionContext(date, d.lifts, profile, d.workout, tune), d.workout);
    // Bodyweight for assisted machines: the latest logged weight if any (no weights table yet), else the profile's.
    const res = updateLift(d.lifts[ex.name], { sets: ex.sets, form: ex.form }, date, info.type, profile.weight_kg);
    if (!res) return;
    if (res.record === null) {
      // No ticked sets left and no earlier session: the lift's record is deleted (a tombstone in lift_stats).
      const { [ex.name]: _gone, ...rest } = ref.current.lifts;
      ref.current = { ...ref.current, lifts: rest };
      setDay(ref.current);
      await deleteLift(db, ex.name, stamp(now()));
      return;
    }
    ref.current = { ...ref.current, lifts: { ...ref.current.lifts, [ex.name]: res.record } };
    setDay(ref.current);
    await saveLift(db, ex.name, res.record);
    if (res.toast) notify(`New personal best on ${ex.name}`);
  };

  /** Applies `fn` to a copy of today's exercise `i` and shows it at once; `persist` is queued. */
  const change = (i: number, fn: (ex: ExState, d: Day) => boolean | void, persist: () => Promise<void>) => {
    const d = clone(ref.current);
    const ex = d.exs[i];
    if (!ex || fn(ex, d) === false) return;
    commit(d);
    void enqueue(persist);
  };

  const start = useCallback(
    async (template: string, checkin: Checkin, ciChoice: Workout['ci_choice']) => {
      if (!profile || building.current || ref.current.workout) return;
      building.current = true;
      try {
        const sessions = await loadSessionLog(db);
        const d = clone(ref.current);
        const built = buildSession({
          template,
          date,
          profile,
          where: profile.where,
          sessions,
          lifts: d.lifts,
          ciChoice,
          checkin,
          focus,
          exclusions,
          swaps,
        });
        d.workout = {
          id: null,
          version: 0,
          updated_at: stamp(now()),
          deleted_at: null,
          date,
          template: templateName(template, profile.where),
          base: template,
          where: null,
          cardio_min: null,
          mods: built.mods,
          exercises: [],
          ci_choice: ciChoice,
        };
        d.sessions = sessions;
        d.exs = built.exercises.map((e) => ({ name: e.name, part: 1, bridge: e.bridge, form: null, found: null, skipRamp: false, sets: Array.from({ length: e.sets }, blankRow), ramp: [] }));
        commit(d);
        await enqueue(async () => {
          await writeWorkout();
          for (let i = 0; i < d.exs.length; i++) await writeSets(i, 'work', Array.from((d.exs[i] as ExState).sets.keys()));
        });
      } finally {
        building.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, profile, date, focus, exclusions, swaps, commit, enqueue],
  );

  const addSecond = useCallback(
    async (template: string) => {
      if (!profile || building.current || !ref.current.workout) return;
      building.current = true;
      try {
        const sessions = await loadSessionLog(db);
        const d = clone(ref.current);
        const old = d.workout as Workout;
        const built = buildSession({
          template,
          date,
          profile,
          where: profile.where,
          sessions,
          lifts: d.lifts,
          ciChoice: old.ci_choice,
          checkin: {},
          focus,
          exclusions,
          swaps,
        });
        const first = d.exs.length;
        const builtEx: ExState[] = built.exercises.map((e) => ({ name: e.name, part: 1, bridge: e.bridge, form: null, found: null, skipRamp: false, sets: Array.from({ length: e.sets }, blankRow), ramp: [] }));
        const merged = mergeSecondSession({ exercises: d.exs, template: old.template, base: old.base, mods: old.mods }, template, { exercises: builtEx, mods: built.mods });
        const added = merged.exercises.slice(first) as ExState[];
        d.exs = merged.exercises as ExState[];
        d.workout = { ...old, template: merged.template, base: merged.base, mods: merged.mods };
        commit(d);
        notify(`${template} added to today`);
        await enqueue(async () => {
          await writeWorkout();
          for (let k = 0; k < added.length; k++) await writeSets(first + k, 'work', Array.from((added[k] as ExState).sets.keys()));
        });
      } finally {
        building.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, profile, date, focus, exclusions, swaps, commit, enqueue, notify],
  );

  const editSet = (i: number, kind: 'work' | 'ramp', j: number, field: 'w' | 'r', value: string) =>
    change(
      i,
      (ex) => {
        ((kind === 'work' ? ex.sets : ex.ramp)[j] as Record<'w' | 'r', string>)[field] = value;
      },
      () => writeSets(i, kind, [j]),
    );

  const tick = (i: number, j: number) => {
    const d0 = ref.current;
    const ex0 = d0.exs[i];
    if (!profile || !d0.workout || !ex0) return;
    const ctx = progressionContext(date, d0.lifts, profile, d0.workout, tune);
    const { info, sug } = guidance(ex0, ctx, d0.workout);
    change(
      i,
      (ex, d) => {
        const s = ex.sets[j];
        if (!s) return false;
        if (s.done) {
          s.done = false;
          s.rate = null;
          s.t = null;
          ex.form = null;
          return;
        }
        const f = tickFill(s, setTarget(ex.sets, j, sug, info, ex.found), info);
        if (!f.ok) {
          notify(`Enter the ${noLoad(info.type) ? '' : 'weight and '}${repWord(info.type)} first.`);
          return false;
        }
        s.w = f.w;
        s.r = f.r;
        s.done = true;
        s.t = stamp(now());
        const nj = ex.sets.findIndex((x) => !x.done);
        const nx = d.exs.slice(i + 1).find((e) => e.sets.some((x) => !x.done));
        if (nj >= 0) startRest(ex.name, `Next: set ${nj + 1} of ${ex.name}`);
        else if (nx) startRest(ex.name, `Next: ${nx.name}`);
      },
      async () => {
        await writeSets(i, 'work', [j]);
        await writeWorkout();
        await syncLift(i);
      },
    );
  };

  const rate = (i: number, j: number, value: Rate | null) =>
    change(
      i,
      (ex) => {
        (ex.sets[j] as { rate: Rate | null }).rate = value;
      },
      async () => {
        await writeSets(i, 'work', [j]);
        await syncLift(i);
      },
    );

  const setForm = (i: number, form: 'yes' | 'no' | null) =>
    change(
      i,
      (ex) => {
        ex.form = form;
      },
      async () => {
        await writeWorkout();
        await syncLift(i);
      },
    );

  const rampStart = (i: number) => change(i, (ex) => void (ex.ramp = [blankRow()]), () => writeSets(i, 'ramp', [0]));

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

  const rampAdd = (i: number) => change(i, (ex) => void ex.ramp.push(blankRow()), () => writeSets(i, 'ramp', [(ref.current.exs[i]?.ramp.length ?? 1) - 1]));

  const rampTick = (i: number, j: number) => {
    const d0 = ref.current;
    const ex0 = d0.exs[i];
    if (!profile || !ex0) return;
    const { info } = guidance(ex0, progressionContext(date, d0.lifts, profile, d0.workout, tune), d0.workout);
    change(
      i,
      (ex) => {
        const s = ex.ramp[j];
        if (!s) return false;
        if (s.done) {
          s.done = false;
          s.rate = null;
          s.t = null;
          ex.found = null;
          return;
        }
        const f = rampTickFill(ex.ramp, j, info);
        if (!f.ok) {
          notify('Enter the weight first.');
          return false;
        }
        s.w = f.w;
        s.r = f.r;
        s.done = true;
        s.t = stamp(now());
      },
      async () => {
        await writeSets(i, 'ramp', [j]);
        await writeWorkout();
      },
    );
  };

  const rampRated = (i: number, j: number, value: Rate | null) => {
    const d0 = ref.current;
    const ex0 = d0.exs[i];
    if (!profile || !ex0) return;
    const { info } = guidance(ex0, progressionContext(date, d0.lifts, profile, d0.workout, tune), d0.workout);
    change(
      i,
      (ex) => {
        (ex.ramp[j] as { rate: Rate | null }).rate = value;
        const r = rampRate(ex.ramp, j, value, info);
        ex.found = r.found;
        if (r.addSet) ex.ramp.push(blankRow());
      },
      async () => {
        await writeSets(i, 'ramp', Array.from((ref.current.exs[i]?.ramp ?? []).keys()));
        await writeWorkout();
      },
    );
  };

  /**
   * The "can't do" sheet's pick. A timed or permanent answer saves a rule (`today` does not, it only steers
   * today's session); the tapped exercise is replaced, and so is anything else today a wider rule covers.
   * An exercise with ticked sets keeps them and the replacement follows it, as in the prototype.
   */
  const cant = (i: number | null, draft: CantDraft, choice: string | null) => {
    const where = ref.current.workout?.where ?? profile?.where ?? 'gym';
    const rule = cantRule(draft, choice, date);
    const today = draft.dur === 'today';
    const saved = today ? null : saveRule(rule);
    if (!today && !saved) return; // the rules could not be read: nothing is changed (the store said why)
    const rules: Exclusion[] = saved ? [...exclusions, saved] : [...exclusions];
    const d = clone(ref.current);
    // Sets of the old exercise to tombstone (`rows` index into the copy taken before the change), and exercises to write.
    const gone: { ex: ExState; rows: ['work' | 'ramp', number][] }[] = [];
    const touched = new Set<string>();
    // TODO(#265, #269): core's cantSession/replaceAt replace this local copy (a replacement keeps the part of the exercise it replaces, #267).
    const replaceAt = (k: number, pick: string | null) => {
      const ex = d.exs[k] as ExState;
      const keep = ex.sets.some((s) => s.done);
      const rows: ['work' | 'ramp', number][] = ex.sets.flatMap((s, j) => (s.done ? [] : [['work', j] as ['work', number]]));
      if (!keep) ex.ramp.forEach((_, j) => rows.push(['ramp', j]));
      gone.push({ ex: structuredClone(ex), rows });
      const n = Math.max(3, lastFor(pick ?? '', d.lifts, date)?.sets.length ?? 0);
      const fresh: ExState[] = pick ? [{ name: pick, part: ex.part, bridge: false, form: null, found: null, skipRamp: false, sets: Array.from({ length: n }, blankRow), ramp: [] }] : [];
      if (pick) touched.add(pick);
      if (keep) {
        ex.sets = ex.sets.filter((s) => s.done);
        touched.add(ex.name);
        d.exs.splice(k + 1, 0, ...fresh);
      } else d.exs.splice(k, 1, ...fresh);
    };
    if (i !== null && d.exs[i]?.name === draft.name) replaceAt(i, choice);
    if (!today && rule.scope !== 'exercise')
      for (const r of widerRuleReplacements(d.exs, rule, choice, where, rules, d.lifts, catalog)) replaceAt(r.index, r.to);
    commit(d);
    notify(choice ? `Swapped in ${choice}` : `${draft.name} removed`);
    void enqueue(async () => {
      const at = stamp(now());
      for (const g of gone) for (const [kind, j] of g.rows) await saveSet(db, date, { ...setRecord(g.ex, kind, j, now()), deleted_at: at });
      await writeWorkout();
      for (let k = 0; k < ref.current.exs.length; k++) {
        const ex = ref.current.exs[k] as ExState;
        if (touched.has(ex.name)) await writeSets(k, 'work', Array.from(ex.sets.keys()));
      }
    });
  };

  return { date, day, cant, editSet, tick, rate, setForm, rampStart, rampSkip, rampAdd, rampTick, rampRated, start, addSecond };
}
