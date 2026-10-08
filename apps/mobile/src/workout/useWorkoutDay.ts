import { useCallback, useEffect, useRef, useState } from 'react';
import {
  noLoad,
  rampRate,
  rampTickFill,
  repWord,
  setTarget,
  tickFill,
  updateLift,
  type Checkin,
  type LiftRecord,
  type Rate,
  type SessionLog,
} from '@plate-and-bar/core';
import { loadLifts, loadSessionLog, loadSets, loadWorkout, saveLift, saveSet, saveWorkout, type WorkoutDb } from '../db/workouts';
import { localDate } from '../setup/logic';
import type { Profile } from '../setup/types';
import { buildSession } from './buildSession';
import { guidance, progressionContext } from './guidance';
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
}

const clone = (d: Day): Day => ({ ...d, exs: structuredClone(d.exs) });

/**
 * Today's workout: loads it from SQLite, and every action updates the screen and writes the changed
 * rows straight away (nothing waits on the network). Rules come from core; this only wires them to records.
 */
export function useWorkoutDay({ db, profile, now, focus, notify, startRest }: Options) {
  const date = localDate(now());
  const [day, setDay] = useState<Day>({ ready: false, workout: null, exs: [], lifts: {}, sessions: {} });
  const ref = useRef(day);
  const commit = useCallback((d: Day) => {
    ref.current = d;
    setDay(d);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const [workout, sets, lifts, sessions] = await Promise.all([loadWorkout(db, date), loadSets(db, date), loadLifts(db), loadSessionLog(db)]);
      if (!live) return;
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
  }, [db, date, commit, notify]);

  const safely = useCallback(
    async (write: () => Promise<void>) => {
      try {
        await write();
      } catch {
        notify('Couldn’t save that. Try again.');
      }
    },
    [notify],
  );

  const writeWorkout = (d: Day) => saveWorkout(db, { ...(d.workout as Workout), exercises: d.exs.map(exerciseRecord), updated_at: stamp(now()) });
  const writeSets = async (d: Day, ex: ExState, kind: 'work' | 'ramp', indexes: number[]) => {
    for (const j of indexes) await saveSet(db, date, setRecord(ex, kind, j, now()));
  };

  /** Recomputes the exercise's lift record from its ticked sets; shows the personal-best toast when core says so. */
  const syncLift = async (d: Day, ex: ExState) => {
    if (!profile) return;
    const ctx = progressionContext(date, d.lifts, profile, d.workout);
    const { info } = guidance(ex, ctx, d.workout);
    const res = updateLift(d.lifts[ex.name], { sets: ex.sets, form: ex.form }, date, info.type);
    if (!res) return;
    ref.current = { ...ref.current, lifts: { ...ref.current.lifts, [ex.name]: res.record } };
    setDay(ref.current);
    await saveLift(db, ex.name, res.record);
    if (res.toast) notify(`New personal best on ${ex.name}`);
  };

  /** Applies `fn` to a copy of today's exercise `i`, shows it, then runs `persist` on the result. */
  const change = (i: number, fn: (ex: ExState, d: Day) => boolean | void, persist: (d: Day, ex: ExState) => Promise<void>) => {
    const d = clone(ref.current);
    const ex = d.exs[i];
    if (!ex || fn(ex, d) === false) return;
    commit(d);
    void safely(() => persist(d, ex));
  };

  const start = useCallback(
    async (template: string, checkin: Checkin, ciChoice: Workout['ci_choice']) => {
      if (!profile) return;
      const d = clone(ref.current);
      const sessions = await loadSessionLog(db);
      const built = buildSession({
        template,
        date,
        profile,
        where: profile.where,
        sessions,
        lifts: progressionContext(date, d.lifts, profile, null).lifts,
        ciChoice,
        checkin,
        focus,
      });
      const workout: Workout = {
        id: null,
        version: 0,
        updated_at: stamp(now()),
        deleted_at: null,
        date,
        template,
        base: template,
        where: null,
        cardio_min: null,
        mods: built.mods,
        exercises: [],
        ci_choice: ciChoice,
      };
      d.workout = workout;
      d.sessions = sessions;
      d.exs = built.exercises.map((e) => ({ name: e.name, part: 1, bridge: e.bridge, form: null, found: null, skipRamp: false, sets: Array.from({ length: e.sets }, blankRow), ramp: [] }));
      commit(d);
      await safely(async () => {
        await writeWorkout(d);
        for (const ex of d.exs) await writeSets(d, ex, 'work', Array.from(ex.sets.keys()));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, profile, date, focus, commit, safely],
  );

  const addSecond = useCallback(
    async (template: string) => {
      if (!profile || !ref.current.workout) return;
      const d = clone(ref.current);
      const old = d.workout as Workout;
      const sessions = await loadSessionLog(db);
      const built = buildSession({
        template,
        date,
        profile,
        where: profile.where,
        sessions,
        lifts: progressionContext(date, d.lifts, profile, old).lifts,
        ciChoice: old.ci_choice,
        checkin: {},
        focus,
      });
      const have = new Set(d.exs.map((e) => e.name));
      const added: ExState[] = built.exercises
        .filter((e) => !have.has(e.name))
        .map((e) => ({ name: e.name, part: 2, bridge: e.bridge, form: null, found: null, skipRamp: false, sets: Array.from({ length: e.sets }, blankRow), ramp: [] }));
      d.exs = [...d.exs, ...added];
      d.workout = { ...old, template: `${old.template || 'Session'} + ${template}`, base: old.base || template, mods: { ...old.mods, light: !!(old.mods.light || built.mods.light) } };
      commit(d);
      notify(`${template} added to today`);
      await safely(async () => {
        await writeWorkout(d);
        for (const ex of added) await writeSets(d, ex, 'work', Array.from(ex.sets.keys()));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, profile, date, focus, commit, safely, notify],
  );

  const editSet = (i: number, kind: 'work' | 'ramp', j: number, field: 'w' | 'r', value: string) =>
    change(
      i,
      (ex) => {
        ((kind === 'work' ? ex.sets : ex.ramp)[j] as Record<'w' | 'r', string>)[field] = value;
      },
      (d, ex) => writeSets(d, ex, kind, [j]),
    );

  const tick = (i: number, j: number) => {
    const d0 = ref.current;
    const ex0 = d0.exs[i];
    if (!profile || !d0.workout || !ex0) return;
    const ctx = progressionContext(date, d0.lifts, profile, d0.workout);
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
      async (d, ex) => {
        await writeSets(d, ex, 'work', [j]);
        await writeWorkout(d);
        await syncLift(d, ex);
      },
    );
  };

  const rate = (i: number, j: number, value: Rate | null) =>
    change(
      i,
      (ex) => {
        (ex.sets[j] as { rate: Rate | null }).rate = value;
      },
      async (d, ex) => {
        await writeSets(d, ex, 'work', [j]);
        await syncLift(d, ex);
      },
    );

  const setForm = (i: number, form: 'yes' | 'no' | null) =>
    change(
      i,
      (ex) => {
        ex.form = form;
      },
      async (d, ex) => {
        await writeWorkout(d);
        await syncLift(d, ex);
      },
    );

  const rampStart = (i: number) =>
    change(i, (ex) => void (ex.ramp = [blankRow()]), async (d, ex) => writeSets(d, ex, 'ramp', [0]));

  const rampSkip = (i: number) =>
    change(
      i,
      (ex) => {
        ex.ramp = [];
        ex.skipRamp = true;
        ex.found = null;
      },
      async (d) => writeWorkout(d),
    );

  const rampAdd = (i: number) =>
    change(i, (ex) => void ex.ramp.push(blankRow()), async (d, ex) => writeSets(d, ex, 'ramp', [ex.ramp.length - 1]));

  const rampTick = (i: number, j: number) => {
    const d0 = ref.current;
    const ex0 = d0.exs[i];
    if (!profile || !ex0) return;
    const { info } = guidance(ex0, progressionContext(date, d0.lifts, profile, d0.workout), d0.workout);
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
      async (d, ex) => {
        await writeSets(d, ex, 'ramp', [j]);
        await writeWorkout(d);
      },
    );
  };

  const rampRated = (i: number, j: number, value: Rate | null) => {
    const d0 = ref.current;
    const ex0 = d0.exs[i];
    if (!profile || !ex0) return;
    const { info } = guidance(ex0, progressionContext(date, d0.lifts, profile, d0.workout), d0.workout);
    change(
      i,
      (ex) => {
        (ex.ramp[j] as { rate: Rate | null }).rate = value;
        const r = rampRate(ex.ramp, j, value, info);
        ex.found = r.found;
        if (r.addSet) ex.ramp.push(blankRow());
      },
      async (d, ex) => {
        await writeSets(d, ex, 'ramp', Array.from(ex.ramp.keys()));
        await writeWorkout(d);
      },
    );
  };

  return { date, day, editSet, tick, rate, setForm, rampStart, rampSkip, rampAdd, rampTick, rampRated, start, addSecond };
}
