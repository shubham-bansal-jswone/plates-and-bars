import type { ExType } from '@plate-and-bar/core';
import labels from '../../../../content/labels.json';
import { catalog, type ExerciseCard } from '../workout/catalog';
import { MUSCLE, TYPE_LABEL } from '../workout/copy';

type Labels = Record<string, string>;
const L = labels as unknown as { joints: Labels; families: Labels; patterns: Labels };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type Equipment = string;
export type Muscle = string;
export type { ExType };

export const equipmentLabel = (e: string): string => cap(e);
export const typeLabel = (t: ExType): string => TYPE_LABEL[t];
export const muscleLabel = (m: string): string => cap(MUSCLE[m] ?? m);
export const jointLabel = (j: string): string => L.joints[j] ?? j;

export interface LibraryExercise {
  name: string;
  equipment: Equipment;
  type: ExType;
  difficulty: number;
  primary: readonly Muscle[];
  secondary: readonly Muscle[];
  joints: readonly string[];
  movement: string;
  family: string;
  repLow: number;
  repHigh: number;
  card: ExerciseCard | null;
}

/** Every exercise in the content, A to Z. Built once. */
export const LIBRARY: readonly LibraryExercise[] = Object.keys(catalog.tags)
  .sort((a, b) => a.localeCompare(b))
  .map((name) => {
    const t = catalog.tags[name]!;
    const m = catalog.meta[name];
    return {
      name,
      equipment: t.equipment,
      type: (m?.type as ExType | undefined) ?? 'other',
      difficulty: t.difficulty,
      primary: t.primary,
      secondary: t.secondary,
      joints: t.joints,
      movement: L.patterns[t.pattern] ?? t.pattern,
      family: L.families[t.family] ?? t.family,
      repLow: m?.rep_low ?? 0,
      repHigh: m?.rep_high ?? 0,
      card: catalog.cards[name] ?? null,
    };
  });

/** Chip lists come from the data, in a fixed display order, so a chip never matches nothing. */
const used = <T extends string>(order: readonly T[], seen: Set<string>): T[] => order.filter((v) => seen.has(v));
export const EQUIPMENT: readonly string[] = used(['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'], new Set(LIBRARY.map((e) => e.equipment)));
export const MUSCLES: readonly string[] = used(Object.keys(MUSCLE), new Set(LIBRARY.flatMap((e) => e.primary)));
export const TYPES: readonly ExType[] = used(Object.keys(TYPE_LABEL) as ExType[], new Set(LIBRARY.map((e) => e.type)));

export interface LibraryFilter {
  query: string;
  equipment: Equipment | null;
  muscle: Muscle | null;
  type: ExType | null;
}

export const NO_FILTER: LibraryFilter = { query: '', equipment: null, muscle: null, type: null };

/** Name contains every typed word (any case); equipment, primary muscle and type each narrow the list when set. */
export function filterLibrary(list: readonly LibraryExercise[], f: LibraryFilter): LibraryExercise[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(
    (e) =>
      words.every((w) => e.name.toLowerCase().includes(w)) &&
      (!f.equipment || e.equipment === f.equipment) &&
      (!f.muscle || e.primary.includes(f.muscle)) &&
      (!f.type || e.type === f.type),
  );
}

export const isFiltered = (f: LibraryFilter): boolean => f.query.trim() !== '' || !!f.equipment || !!f.muscle || !!f.type;
