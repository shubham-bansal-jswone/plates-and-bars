import { exInfo, milestones, type ExerciseOverride, type ExType, type Milestone, type MilestoneProfile, type PrSet, type SessionLog, type WeightUnit } from '@plate-and-bar/core';
import type { Weight } from './types';
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

/** What the Workout tab keeps between reloads so a tick reads nothing from the db: every done set and the session log without the viewed day, the weigh-ins and the shown ids. */
export interface MilestoneData {
  sets: PrSet[];
  sessions: SessionLog;
  weights: Weight[];
  shown: Set<string>;
}

type Shared = { profile: MilestoneProfile | null; overrides: Overrides; unit: WeightUnit; end: string };

const run = (d: Pick<MilestoneData, 'sets' | 'sessions' | 'weights'>, a: Shared): Milestone[] =>
  milestones(d.sets, d.sessions, d.weights, typesOf(d.sets.map((s) => s.exercise), a.overrides), a.unit, a.end, a.profile);

/**
 * One reload: reads all history (the only db read of milestones outside Progress) and marks every milestone earned without the viewed
 * day as shown, silently, whatever the cause of the reload (mount, a pull, a restore, an import, another device). Only a tick on the
 * viewed day (`takeNewMilestones`) may announce one. The viewed day is left out so a milestone its own ticks will earn is not swallowed.
 */
export async function loadMilestoneData(db: WorkoutDb, a: Shared, day: string): Promise<MilestoneData> {
  const [sets, sessions, weights, raw] = await Promise.all([loadDoneSets(db), loadSessionLog(db), loadWeights(db), getKv(db, KEY_MILESTONES_SHOWN)]);
  const before = sets.filter((s) => s.date !== day);
  const { [day]: _day, ...log } = sessions;
  const data = { sets: before, sessions: log as SessionLog, weights };
  const shown = parseShown(raw) ?? new Set<string>();
  const have = shown.size;
  for (const m of run(data, a)) shown.add(m.id);
  if (raw === null || shown.size !== have) await setKv(db, KEY_MILESTONES_SHOWN, JSON.stringify([...shown]));
  return { ...data, shown };
}

/** The most significant new milestone of the newest date: the highest step of each kind (two plates over one), then by id. */
export function toastPick(fresh: readonly Milestone[]): Milestone | undefined {
  const newest = fresh[0]?.date;
  const best = new Map<string, Milestone>();
  const step = (m: Milestone) => Number(/-(\d+)$/.exec(m.id)?.[1] ?? 0);
  for (const m of fresh) if (m.date === newest && (!best.get(m.kind) || step(m) > step(best.get(m.kind) as Milestone))) best.set(m.kind, m);
  return [...best.values()].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
}

/**
 * A tick on the viewed day: core `milestones` in memory over the cached data plus the day's own sets (`today`, with the day added to the
 * session log), diffed against the cached shown ids. New ones are marked shown (cache and one small `setKv`), newest first, as core orders
 * them. No history is read. Ids are only added: an untick never un-shows one.
 */
export async function takeNewMilestones(db: WorkoutDb, data: MilestoneData, today: { date: string; sets: PrSet[]; entry: { t: string; n: number } | null }, a: Shared): Promise<Milestone[]> {
  const list = run({ sets: [...data.sets, ...today.sets], sessions: today.entry ? { ...data.sessions, [today.date]: today.entry } : data.sessions, weights: data.weights }, a);
  const fresh = list.filter((m) => !data.shown.has(m.id));
  if (fresh.length > 0) {
    for (const m of fresh) data.shown.add(m.id);
    await setKv(db, KEY_MILESTONES_SHOWN, JSON.stringify([...data.shown]));
  }
  return fresh;
}
