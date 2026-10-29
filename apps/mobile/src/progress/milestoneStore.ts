import { exInfo, milestones, type ExerciseOverride, type ExType, type Milestone, type MilestoneProfile, type PrSet, type SessionLog, type WeightUnit } from '@plate-and-bar/core';
import { loadWeights } from '../db/progress';
import { loadDoneSets, loadSessionLog, type WorkoutDb } from '../db/workouts';
import { getCatalog } from '../workout/catalog';
import { KEY_MILESTONES_SHOWN, getKv, setKv } from '../sync/store';

type Overrides = Readonly<Record<string, ExerciseOverride>>;

/** The ids already shown, or null when this device never recorded any (first run). A damaged value reads as an empty set, not as a first run. */
export function parseShown(raw: string | null): Set<string> | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** `exInfo(...).type` per lift name, overrides included, as core's `milestones` reads it. */
export function typesOf(names: Iterable<string>, overrides: Overrides): Record<string, ExType> {
  const catalog = getCatalog();
  return Object.fromEntries([...new Set(names)].map((n) => [n, exInfo(n, catalog, overrides[n]).type] as const));
}

/** Everything core's `milestones` reads, from the device. `end` bounds the data (the viewed day, or today). */
export async function earnedNow(db: WorkoutDb, profile: MilestoneProfile | null, overrides: Overrides, unit: WeightUnit, end: string): Promise<{ list: Milestone[]; sets: PrSet[]; sessions: SessionLog }> {
  const [sets, sessions, weights] = await Promise.all([loadDoneSets(db), loadSessionLog(db), loadWeights(db)]);
  return { list: milestones(sets, sessions, weights, typesOf(sets.map((s) => s.exercise), overrides), unit, end, profile), sets, sessions };
}

/** First run: every milestone already earned counts as shown, so old history never toasts. Does nothing once the key exists. */
export async function seedShown(db: WorkoutDb, profile: MilestoneProfile | null, overrides: Overrides, unit: WeightUnit, end: string): Promise<void> {
  if (parseShown(await getKv(db, KEY_MILESTONES_SHOWN)) !== null) return;
  const { list } = await earnedNow(db, profile, overrides, unit, end);
  await setKv(db, KEY_MILESTONES_SHOWN, JSON.stringify(list.map((m) => m.id)));
}

/**
 * The milestones earned that were not shown before, each marked shown at once (all of them: one toast per tick shows at most one, the
 * rest go to the completion panel, and none is announced twice). Newest first, as `milestones` orders them. An untick earns nothing and
 * un-shows nothing: ids are only ever added. With no stored set yet (not seeded) it seeds and returns nothing.
 */
export async function takeNewMilestones(db: WorkoutDb, profile: MilestoneProfile | null, overrides: Overrides, unit: WeightUnit, end: string): Promise<Milestone[]> {
  const shown = parseShown(await getKv(db, KEY_MILESTONES_SHOWN));
  const { list } = await earnedNow(db, profile, overrides, unit, end);
  if (shown === null) {
    await setKv(db, KEY_MILESTONES_SHOWN, JSON.stringify(list.map((m) => m.id)));
    return [];
  }
  const fresh = list.filter((m) => !shown.has(m.id));
  if (fresh.length > 0) await setKv(db, KEY_MILESTONES_SHOWN, JSON.stringify([...shown, ...fresh.map((m) => m.id)]));
  return fresh;
}
