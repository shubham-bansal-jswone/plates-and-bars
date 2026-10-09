import content from '../../../../content/exercises.json';
import labels from '../../../../content/labels.json';

type Labels = Record<string, string>;
const L = labels as unknown as { muscles: Labels; joints: Labels; families: Labels; patterns: Labels };

/** Contract `ExerciseTags.equipment` values that appear in the content, in the contract's order. */
export const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/** Contract `Muscle` values, in the contract's order. */
export const MUSCLES = ['chest', 'front-delt', 'side-delt', 'rear-delt', 'triceps', 'lats', 'upper-back', 'biceps', 'forearms', 'quads', 'hams', 'glutes', 'calves', 'abs', 'lower-back'] as const;
export type Muscle = (typeof MUSCLES)[number];

/** Exercise types (content `meta.type`; the contract's `exercise_overrides` type values). */
export const TYPES = ['barbell', 'dumbbell', 'machine', 'cable', 'assisted', 'bodyweight', 'time', 'other'] as const;
export type ExType = (typeof TYPES)[number];

const TYPE_LABEL: Record<ExType, string> = { barbell: 'Barbell', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable', assisted: 'Assisted', bodyweight: 'Bodyweight', time: 'Timed', other: 'Other' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const equipmentLabel = (e: string): string => cap(e);
export const typeLabel = (t: ExType): string => TYPE_LABEL[t];
export const muscleLabel = (m: string): string => cap(L.muscles[m] ?? m);
export const jointLabel = (j: string): string => L.joints[j] ?? j;

interface RawTags { pattern: string; family: string; equipment: Equipment; difficulty: number; primary: Muscle[]; secondary: Muscle[]; joints: string[] }
interface RawCard { where_to_feel: string; setup: string[]; key_cues: string[]; common_mistakes: string[]; breathing?: string; easier_version?: string; harder_version?: string }
const raw = content as unknown as { tags: Record<string, RawTags>; meta: Record<string, { type: ExType; rep_low: number; rep_high: number }>; cards: Record<string, RawCard> };

export interface LibraryExercise {
  name: string;
  equipment: Equipment;
  type: ExType;
  difficulty: number;
  primary: Muscle[];
  secondary: Muscle[];
  joints: string[];
  movement: string;
  family: string;
  repLow: number;
  repHigh: number;
  card: RawCard | null;
}

/** Every exercise in the content, A to Z. Built once. */
export const LIBRARY: readonly LibraryExercise[] = Object.keys(raw.tags)
  .sort((a, b) => a.localeCompare(b))
  .map((name) => {
    const t = raw.tags[name]!;
    const m = raw.meta[name];
    return {
      name,
      equipment: t.equipment,
      type: m?.type ?? 'other',
      difficulty: t.difficulty,
      primary: t.primary,
      secondary: t.secondary,
      joints: t.joints,
      movement: L.patterns[t.pattern] ?? t.pattern,
      family: L.families[t.family] ?? t.family,
      repLow: m?.rep_low ?? 0,
      repHigh: m?.rep_high ?? 0,
      card: raw.cards[name] ?? null,
    };
  });

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
