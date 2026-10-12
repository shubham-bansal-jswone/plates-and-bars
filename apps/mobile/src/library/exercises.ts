import type { Schemas } from '@plate-and-bar/api';
import type { ExType } from '@plate-and-bar/core';
import { EQUIPMENT_CODES, getCatalog, type ExerciseCard } from '../workout/catalog';
import { getLabels, muscleName, TYPE_LABEL } from '../workout/copy';
import { ownOr } from '../content/own';
import { perLoad } from '../content/reader';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type Equipment = string;
export type Muscle = Schemas['Muscle'];
export type { ExType };

export const equipmentLabel = (e: string): string => cap(e);
export const typeLabel = (t: ExType): string => TYPE_LABEL[t];
export const muscleLabel = (m: string): string => cap(muscleName(m));
export const jointLabel = (j: string): string => ownOr(getLabels().joints, j);

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

/** Every exercise in the content, A to Z. Built once per content load; call it where it is used, not at module level. */
export const getLibrary: () => readonly LibraryExercise[] = perLoad(() => {
  const catalog = getCatalog();
  const L = getLabels();
  return Object.keys(catalog.tags)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const t = catalog.tags[name]!;
      const m = catalog.meta[name];
      return {
        name,
        equipment: t.equipment,
        type: (m?.type as ExType | undefined) ?? 'other',
        difficulty: t.difficulty,
        primary: t.primary as readonly Muscle[],
        secondary: t.secondary as readonly Muscle[],
        joints: t.joints,
        movement: ownOr(L.patterns, t.pattern),
        family: ownOr(L.families, t.family),
        repLow: m?.rep_low ?? 0,
        repHigh: m?.rep_high ?? 0,
        card: catalog.cards[name] ?? null,
      };
    });
});

/** Chip lists come from the data, in a fixed display order, so a chip never matches nothing. */
const used = <T extends string>(order: readonly T[], seen: Set<string>): T[] => order.filter((v) => seen.has(v));
export const getEquipment: () => readonly string[] = perLoad(() => used(EQUIPMENT_CODES, new Set(getLibrary().map((e) => e.equipment))));
export const getMuscles: () => readonly Muscle[] = perLoad(() => used(Object.keys(getLabels().muscles) as Muscle[], new Set<string>(getLibrary().flatMap((e) => e.primary))));
export const getTypes: () => readonly ExType[] = perLoad(() => used(Object.keys(TYPE_LABEL) as ExType[], new Set(getLibrary().map((e) => e.type))));

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
