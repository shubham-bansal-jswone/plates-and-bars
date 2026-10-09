import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, num, type MeasureKey } from '@plate-and-bar/core';
import { loadMeasurements, loadWeights, saveMeasurement, saveWeight } from '../db/progress';
import { loadDayNote, patchDayNote } from '../db/food';
import type { WorkoutDb } from '../db/workouts';
import type { DayNote } from '../food/types';
import { localDate } from '../setup/logic';
import { MEASURE_NONE, SLEEP_BAD, SLEEP_MAX_H, STEPS_BAD, TAPE_MAX_CM, TAPE_MIN_CM, WEIGHT_ABOVE_KG, WEIGHT_BAD, WEIGHT_BELOW_KG } from './copy';
import type { Measurement, Weight } from './types';

const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const tenth = (n: number): number => Math.round(n * 10) / 10;

interface Options {
  db: WorkoutDb;
  now: () => Date;
  /** Short message for the toast. */
  notify: (msg: string) => void;
}

const blankNote = (date: string): DayNote => ({ id: null, version: 0, deleted_at: null, updated_at: '', date, complete: null, steps: null, sleep: null, fast: false });
const isNumber = (text: string): boolean => Number.isFinite(Number(text.trim()));
const blankTape = (date: string): Measurement => ({ id: null, version: 0, updated_at: '', deleted_at: null, date, waist_cm: null, neck_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, hips_cm: null });

/**
 * Body data for the day: weigh-ins, tape measurements and the day note's steps and sleep, read from SQLite. Every save
 * shows at once and its write goes through one FIFO queue (nothing waits on the network). Deletes are tombstones.
 */
export function useProgress({ db, now, notify }: Options) {
  const date = localDate(now());
  const [ready, setReady] = useState(false);
  const [weights, setWeights] = useState<Weight[]>([]);
  const [tapes, setTapes] = useState<Measurement[]>([]);
  /** Day notes for the 7 days before `date` and `date` itself (what `stepsTarget` reads). */
  const [notes, setNotes] = useState<DayNote[]>([]);
  const weightsRef = useRef(weights);
  const tapesRef = useRef(tapes);
  const notesRef = useRef(notes);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    (async () => {
      const days = Array.from({ length: 8 }, (_, i) => addDays(date, i - 7));
      const [w, m, n] = await Promise.all([loadWeights(db), loadMeasurements(db), Promise.all(days.map((d) => loadDayNote(db, d)))]);
      if (!live) return;
      weightsRef.current = w;
      tapesRef.current = m;
      notesRef.current = n.filter((x): x is DayNote => x !== null);
      setWeights(w);
      setTapes(m);
      setNotes(notesRef.current);
      setReady(true);
    })().catch(() => {
      if (live) notify('Couldn’t read your saved progress.');
    });
    return () => {
      live = false;
    };
  }, [db, date, notify]);

  const enqueue = useCallback(
    (write: () => Promise<void>) => {
      queue.current = queue.current.then(write).catch(() => notify('Couldn’t save that. Try again.'));
    },
    [notify],
  );

  const putWeight = useCallback(
    (w: Weight) => {
      weightsRef.current = [...weightsRef.current.filter((x) => x.date !== w.date), w];
      setWeights(weightsRef.current);
      enqueue(() => saveWeight(db, w));
    },
    [db, enqueue],
  );

  /** Saves the day's weigh-in; an empty box clears it (a tombstone). */
  const saveWeightText = useCallback(
    (text: string) => {
      const v = num(text);
      const prev = weightsRef.current.find((w) => w.date === date);
      const t = stamp(now());
      if (v > WEIGHT_ABOVE_KG && v < WEIGHT_BELOW_KG) {
        putWeight({ id: null, version: prev?.version ?? 0, updated_at: t, deleted_at: null, date, weight_kg: tenth(v) });
        notify('Weight saved');
      } else if (!text.trim()) {
        if (prev && !prev.deleted_at) putWeight({ ...prev, deleted_at: t, updated_at: t });
        notify('Weight cleared');
      } else notify(WEIGHT_BAD);
    },
    [date, now, notify, putWeight],
  );

  /** Saves the filled boxes into the day's measurements, keeping the ones already stored; out-of-range entries are ignored. */
  const saveTape = useCallback(
    (entered: Partial<Record<MeasureKey, string>>) => {
      const row: Partial<Record<MeasureKey, number>> = {};
      for (const [k, text] of Object.entries(entered) as [MeasureKey, string][]) {
        const v = num(text);
        if (v >= TAPE_MIN_CM && v <= TAPE_MAX_CM) row[k] = tenth(v);
      }
      if (!Object.keys(row).length) return notify(MEASURE_NONE);
      // A deleted row's values are gone, but its version carries on (the record is revived, not a new one).
      const prev = tapesRef.current.find((m) => m.date === date);
      const base = prev && !prev.deleted_at ? prev : { ...blankTape(date), version: prev?.version ?? 0 };
      const m: Measurement = { ...base, ...row, deleted_at: null, updated_at: stamp(now()) };
      tapesRef.current = [...tapesRef.current.filter((x) => x.date !== date), m];
      setTapes(tapesRef.current);
      enqueue(() => saveMeasurement(db, m));
      notify('Measurements saved');
    },
    [db, date, now, notify, enqueue],
  );

  /** Saves today's steps and sleep on the day note; an empty box clears that value. */
  const saveStepsSleep = useCallback(
    (stepsText: string, sleepText: string) => {
      if (stepsText.trim() && !isNumber(stepsText)) return notify(STEPS_BAD);
      if (sleepText.trim() && !isNumber(sleepText)) return notify(SLEEP_BAD);
      const steps = stepsText.trim() ? Math.round(num(stepsText)) : null;
      const sleep = sleepText.trim() ? num(sleepText) : null;
      if (steps !== null && !(steps >= 0)) return notify(STEPS_BAD);
      if (sleep !== null && !(sleep >= 0 && sleep <= SLEEP_MAX_H)) return notify(SLEEP_BAD);
      const n: DayNote = { ...(notesRef.current.find((x) => x.date === date) ?? blankNote(date)), steps, sleep, updated_at: stamp(now()) };
      notesRef.current = [...notesRef.current.filter((x) => x.date !== date), n];
      setNotes(notesRef.current);
      enqueue(() => patchDayNote(db, date, { steps, sleep }, n.updated_at));
      notify('Saved');
    },
    [db, date, now, notify, enqueue],
  );

  return { date, ready, weights, tapes, notes, today: notes.find((n) => n.date === date) ?? null, saveWeightText, saveTape, saveStepsSleep };
}
