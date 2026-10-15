import { recoveryWeek, type AdjRange, type AdjState, type ReentryRange } from '@plate-and-bar/core';

// `Settings.adjustments` is an open object; these are the prototype's `settings.adj` fields the exercise cards use:
// `muted[type]` (the user turned the card type off), `dismissed[key]` (this card was answered) and `declines[type]`
// (how many times a card of that type was declined; after 3 the card offers "Stop suggesting this").

type Adjustments = Record<string, unknown>;
type Flags = Record<string, boolean>;

export const adjOf = (a: Adjustments): AdjState & { declines: Record<string, number> } => ({
  muted: (a.muted as Flags | undefined) ?? {},
  dismissed: (a.dismissed as Flags | undefined) ?? {},
  declines: (a.declines as Record<string, number> | undefined) ?? {},
});

/** The answer to a card: its key is dismissed, and "Not now" also counts a decline for the card type. */
export function answered(a: Adjustments, key: string, decline?: string): Adjustments {
  const adj = adjOf(a);
  return { ...a, dismissed: { ...adj.dismissed, [key]: true }, ...(decline ? { declines: { ...adj.declines, [decline]: (adj.declines[decline] ?? 0) + 1 } } : {}) };
}

/** "Stop suggesting this": the card type is muted. */
export const muted = (a: Adjustments, type: string): Adjustments => ({ ...a, muted: { ...adjOf(a).muted, [type]: true } });

const isRange = (r: unknown): r is AdjRange => !!r && typeof r === 'object' && typeof (r as AdjRange).until === 'string' && ((r as AdjRange).from === undefined || typeof (r as AdjRange).from === 'string');

/** The stored recovery week and re-entry period; a malformed (pulled) value counts as none. */
export function rangesOf(a: Adjustments): { deload: AdjRange | null; reentry: ReentryRange | null } {
  const re = a.reentry;
  return { deload: isRange(a.deload) ? a.deload : null, reentry: isRange(re) && typeof (re as ReentryRange).pct === 'number' ? (re as ReentryRange) : null };
}

/** "Start recovery week": 7 days from `date`, and this week's card key is answered. */
export const startDeload = (a: Adjustments, date: string, key: string): Adjustments => ({ ...answered(a, key), deload: recoveryWeek(date) });

/** "End it early" / "Back to normal" (prototype `adj-end`). */
export function endAdj(a: Adjustments, kind: 'deload' | 'reentry'): Adjustments {
  const { [kind]: _gone, ...rest } = a;
  return rest;
}
