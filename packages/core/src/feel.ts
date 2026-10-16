/** The part of a lift record learn mode reads (core's `LiftRecord` fits). */
export interface LiftCount {
  date: string;
  n?: number | undefined;
  prev?: unknown;
}

/**
 * Sessions done on an exercise before `date` (prototype `priorSessions`): the lift's session count, less today's
 * own session when it is already counted. An older record without `n` counts 3 if it has a `prev`, else 1.
 */
export function priorSessions(lift: LiftCount | undefined, date: string): number {
  if (!lift) return 0;
  const n = lift.n || (lift.prev ? 3 : 1);
  return lift.date === date ? n - 1 : n;
}

/** Learn mode (prototype `learning`): the exercise has a written guide card and fewer than 3 earlier sessions. */
export const isLearning = (hasCard: boolean, lift: LiftCount | undefined, date: string): boolean =>
  hasCard && priorSessions(lift, date) < 3;

/** Whether the "Where did you feel that set most?" step shows (prototype `feelHtml`): learn mode and at least one set done. */
export const showFeel = (learning: boolean, anyDone: boolean): boolean => learning && anyDone;

export type FeelResult =
  | { kind: 'ask' }
  | { kind: 'target' }
  | { kind: 'pain' }
  /** Felt it elsewhere; `fix` is the card's advice for that spot, or '' when it has none. */
  | { kind: 'elsewhere'; fix: string };

/**
 * What the feel step shows for a stored answer (prototype `feelHtml`). `feel` is null/'' (not answered), 'target', 'pain'
 * or the index of the guide card's `misplaced_feel` entry (prototype `c.w`); `misplaced` is that list of [area, fix].
 */
export function feelResult(feel: string | null | undefined, misplaced: readonly (readonly [string, string])[]): FeelResult {
  if (!feel) return { kind: 'ask' };
  if (feel === 'target') return { kind: 'target' };
  if (feel === 'pain') return { kind: 'pain' };
  const i = Number(feel);
  return { kind: 'elsewhere', fix: Number.isInteger(i) && i >= 0 && i < misplaced.length ? (misplaced[i]?.[1] ?? '') : '' };
}
