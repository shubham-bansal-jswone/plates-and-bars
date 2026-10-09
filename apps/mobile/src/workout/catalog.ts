import type { ExerciseCatalog, LadderCatalog } from '@plate-and-bar/core';
import exercises from '../../../../content/exercises.json';

/** One exercise's how-to card (content/exercises.json `cards`, long keys). */
export interface ExerciseCard {
  where_to_feel: string;
  setup: string[];
  key_cues: string[];
  common_mistakes: string[];
  breathing?: string;
  easier_version?: string;
  harder_version?: string;
}

export type Catalog = ExerciseCatalog & Pick<LadderCatalog, 'ladders'> & {
  cards: Readonly<Record<string, ExerciseCard>>;
  /** The exercise library by group (prototype `LIB`), the "Add an exercise to avoid" picker's list. */
  library: Readonly<Record<string, readonly string[]>>;
};

/** The exercise content, passed to core as is. */
export const catalog = exercises as unknown as Catalog;
