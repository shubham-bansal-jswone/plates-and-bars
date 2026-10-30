import { HAND_PICKED, groupLabels, normalizeGroups, sessionVolume, type ExType, type PersonalRecord, type SessionLog, type WeightUnit } from '@plate-and-bar/core';
import type { WorkoutExercise, WorkoutSet } from '../../workout/types';
import { weightFieldText } from '../../workout/unitText';
import { e1rmPoints, sessionTimeLine } from '../e1rm';

export interface HistorySet {
  w: number | null;
  r: number | null;
  rate?: WorkoutSet['rate'];
}
export interface HistoryExercise {
  name: string;
  sets: HistorySet[];
  /** Core's `sessionVolume` of this exercise's done sets, kg. */
  volume: number;
  /** Superset letter ('A', 'B', ...) when the stored workout has this exercise in a valid group (core's `groupLabels`); absent otherwise. */
  label?: string;
}
export interface HistorySession {
  date: string;
  /** Template name, or core's "Session" for a hand-picked day (from `loadSessionLog`). */
  name: string;
  setsDone: number;
  /** Every work set of the day is ticked (the same bar as the completion panel); only then can the day be shared. */
  finished: boolean;
  volume: number;
  exercises: HistoryExercise[];
  /** Elapsed training time as text (core's `sessionElapsed`), null when any done set lacks a tick or there is no span. */
  elapsed: string | null;
  /** Cardio minutes stored for the day, null when none. */
  cardio: number | null;
}

/** How many of the latest sessions are read. */
export const HISTORY_LIMIT = 20;

/** The latest dates in the session log, newest first. */
export const recentDates = (log: SessionLog): string[] => Object.keys(log).sort().reverse().slice(0, HISTORY_LIMIT);

/** One session per logged day: its done work sets grouped by exercise, in the stored workout's exercise order (names the stored list lacks follow in row order). Volume is core's `sessionVolume`. */
export function buildSessions(log: SessionLog, setsByDate: Readonly<Record<string, readonly WorkoutSet[]>>, cardioByDate: Readonly<Record<string, number | null>> = {}, storedByDate: Readonly<Record<string, readonly Pick<WorkoutExercise, 'name' | 'group'>[]>> = {}): HistorySession[] {
  return recentDates(log).flatMap((date) => {
    const done = (setsByDate[date] ?? []).filter((s) => s.kind === 'work' && s.done && !s.deleted_at);
    if (!done.length) return [];
    const by = new Map<string, WorkoutSet[]>();
    for (const s of [...done].sort((a, b) => a.set_index - b.set_index)) by.set(s.exercise, [...(by.get(s.exercise) ?? []), s]);
    // Letters follow the STORED exercise order, never the order the set rows come back in. Group validity is core's `normalizeGroups` on the
    // stored list (as the workout screen reads it); then only the exercises listed for the day are labelled by core's `groupLabels`, so a group
    // with fewer than 2 listed members gets no label and the letters restart at A.
    const stored = storedByDate[date] ?? [];
    const valid = normalizeGroups(stored.map((e) => ({ name: e.name, sets: 1, group: e.group }))).map((e) => e.group ?? null);
    const listed = stored.flatMap((e, i) => (by.has(e.name) ? [{ name: e.name, sets: 1, group: valid[i] }] : []));
    const listedLetters = groupLabels(listed);
    const letters = new Map(listed.flatMap((e, i) => (listedLetters[i] ? [[e.name, listedLetters[i]!] as const] : [])));
    // Cards follow the stored exercise order too (rows have no order of their own: every first set is index 0, a re-saved set moves last);
    // names the stored list lacks keep row order, after the stored ones.
    const rank = new Map<string, number>();
    for (const [i, e] of stored.entries()) if (!rank.has(e.name)) rank.set(e.name, i); // a repeated name sits at its first stored position
    // `sort` is stable, so equal ranks (names the stored list lacks) keep row order.
    const ordered = [...by].sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || 0);
    const exercises = ordered.map(([name, sets]): HistoryExercise => {
      const mapped = sets.map((s) => ({ w: s.weight_kg, r: s.reps, rate: s.rate }));
      const l = letters.get(name);
      return { name, sets: mapped, volume: sessionVolume([{ sets: mapped.map((s) => ({ done: true, w: s.w, r: s.r })) }]), ...(l ? { label: l } : {}) };
    });
    // Time counts every ticked set of the day, ramp sets too: one without a tick makes the duration unknown, never a guess.
    const ticked = (setsByDate[date] ?? []).filter((s) => s.done && !s.deleted_at);
    return [{ date, name: log[date]?.t ?? HAND_PICKED, setsDone: done.length, finished: (setsByDate[date] ?? []).every((s) => s.kind !== 'work' || !!s.deleted_at || s.done), volume: exercises.reduce((n, e) => n + e.volume, 0), exercises, elapsed: sessionTimeLine(ticked), cardio: cardioByDate[date] || null }];
  });
}

export interface ExerciseTrend {
  /** Oldest first: the session volume of this exercise, kg. */
  points: { date: string; volume: number }[];
  /** Heaviest logged weight among those sessions, kg; null when none had a weight. */
  heaviest: number | null;
}

/** Recent sessions of one exercise from the stored sets. The personal-best badge is not here: it comes from core's `personalRecords` (`prLiftsOn`). */
export function exerciseTrend(sessions: readonly HistorySession[], name: string): ExerciseTrend {
  const mine = sessions.flatMap((s) => {
    const e = s.exercises.find((x) => x.name === name);
    return e ? [{ date: s.date, ex: e }] : [];
  }).reverse();
  const weights = mine.flatMap((m) => m.ex.sets.map((s) => s.w ?? 0)).filter((w) => w > 0);
  return { points: mine.map((m) => ({ date: m.date, volume: m.ex.volume })), heaviest: weights.length ? Math.max(...weights) : null };
}

/** Core's e1RM trend of one exercise over the read sessions, oldest first (`type` as the library knows it). */
export const exerciseE1rm = (sessions: readonly HistorySession[], name: string, type?: ExType) =>
  e1rmPoints(sessions.flatMap((s) => (s.exercises.find((x) => x.name === name)?.sets ?? []).map((x) => ({ date: s.date, kind: 'work' as const, weight_kg: x.w, reps: x.r, done: true, rate: x.rate ?? null }))), type);

/** "60 kg x 8" ("132.3 lb x 8" for an lb user), "12 reps" for a bodyweight set, "done" when neither was typed. The stored kg shows as stored in kg. */
export function setText(s: HistorySet, unit: WeightUnit = 'kg'): string {
  const w = s.w ? `${weightFieldText(String(s.w), unit)} ${unit}` : '';
  if (s.w && s.r) return `${w} x ${s.r}`;
  if (s.r) return `${s.r} reps`;
  if (s.w) return w;
  return 'done';
}

/** Lifts with a personal record on `date`: core's `personalRecords` over all stored sets, the rule of the toast and the Recent PRs list. */
export const prLiftsOn = (records: readonly PersonalRecord[], date: string): ReadonlySet<string> => new Set(records.filter((r) => r.date === date).map((r) => r.lift));
