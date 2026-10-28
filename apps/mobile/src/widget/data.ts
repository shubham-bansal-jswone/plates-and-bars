import { HAND_PICKED, planned, type WeekPlan } from '@plate-and-bar/core';
import { loadProfile } from '../db/records';
import { loadExclusions, loadSwaps } from '../db/rules';
import { loadSettings } from '../db/settings';
import { loadLifts, loadSessionLog, loadSets, loadWorkout, type WorkoutDb } from '../db/workouts';
import { localDate } from '../setup/logic';
import { buildSession } from '../workout/buildSession';
import { isCardioOnly } from '../workout/model';
import type { Workout, WorkoutSet } from '../workout/types';

/**
 * What the home-screen widget shows (#1181). Workout names and counts only: no weights, food, body or health data, so the
 * widget is safe on a shared screen. `empty` is a device with no profile yet (setup not done) or one whose database could not be read.
 */
export type WidgetData =
  | { kind: 'workout'; title: string; count: number; /** The first exercise with a work set still to do; null when all are done. */ next: string | null }
  | { kind: 'rest' }
  | { kind: 'empty' };

export interface WidgetInput {
  hasProfile: boolean;
  /** Core `planned(date)`: today's template, or null on a rest day. */
  plan: string | null;
  /** Today's stored workout (a deleted one counts as none). */
  stored: Workout | null;
  sets: readonly WorkoutSet[];
  /** The exercises the plan would build for today (from `buildSession`), used when nothing is stored yet. */
  planned: readonly string[];
}

const live = (w: Workout | null): w is Workout => !!w && !w.deleted_at;

/** Pure: the widget's content from today's state. A session already started wins over the plan (it may be a hand-picked one on a rest day); its title is the Workout tab heading (`template`, which carries the dumbbells variant and a second session). */
export function widgetData(i: WidgetInput): WidgetData {
  if (!i.hasProfile) return { kind: 'empty' };
  if (live(i.stored) && !isCardioOnly(i.stored) && i.stored.exercises.length) {
    const work = i.sets.filter((s) => s.kind === 'work' && !s.deleted_at);
    const names = i.stored.exercises.map((e) => e.name);
    // Finished: it has work sets and all are ticked. An exercise with no set rows yet is still to do.
    const finished = (n: string) => work.some((s) => s.exercise === n) && work.every((s) => s.exercise !== n || s.done);
    return { kind: 'workout', title: i.stored.template || HAND_PICKED, count: names.length, next: names.find((n) => !finished(n)) ?? null };
  }
  if (!i.plan) return { kind: 'rest' };
  return { kind: 'workout', title: i.plan, count: i.planned.length, next: i.planned[0] ?? null };
}

/**
 * Reads today's state from SQLite (no network) and maps it with `widgetData`. The rules are core's: `planned` picks the day,
 * `buildSession` the exercises, as the Workout tab does. Never throws: a database that cannot be read gives `null`, so the caller keeps what the widget already shows. The exercise catalogue is not loaded here: the app has loaded it at start, and the headless handler loads it when its runtime has not (`widgetTaskHandler`).
 */
export async function loadWidgetData(db: WorkoutDb, now: Date = new Date()): Promise<WidgetData | null> {
  try {
    const date = localDate(now);
    const profile = await loadProfile(db);
    if (!profile) return { kind: 'empty' };
    const [settings, sessions, stored, sets, lifts, exclusions, swaps] = await Promise.all([loadSettings(db), loadSessionLog(db), loadWorkout(db, date), loadSets(db, date), loadLifts(db), loadExclusions(db), loadSwaps(db)]);
    const adjustments = settings?.adjustments ?? {};
    const plan = planned(date, { profile, sessions, weekPlan: adjustments.weekPlan as WeekPlan | undefined, mode: adjustments.mode as string | undefined });
    const names = plan
      ? buildSession({ template: plan, date, profile, where: profile.where, sessions, lifts, ciChoice: null, checkin: {}, focus: settings?.focus ?? [], exclusions, swaps, adjustments }).exercises.map((e) => e.name)
      : [];
    return widgetData({ hasProfile: true, plan, stored, sets, planned: names });
  } catch {
    return null;
  }
}
