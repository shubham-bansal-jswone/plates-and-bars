import { CONDENSED, dismissKey, mondayOf, recoveryWeek, reentryRange, type AdjRange, type AdjState, type ReentryRange } from '@plate-and-bar/core';

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

/**
 * The answer to a card: its key is dismissed (core `dismissKey` also prunes old keys, so the object stays under its
 * size cap), and "Not now" also counts a decline for the card type. `today` is the real date, not the day being viewed.
 */
export function answered(a: Adjustments, key: string, today: string, decline?: string): Adjustments {
  const adj = adjOf(a);
  return { ...a, dismissed: dismissKey(adj.dismissed, key, today), ...(decline ? { declines: { ...adj.declines, [decline]: (adj.declines[decline] ?? 0) + 1 } } : {}) };
}

/** "Stop suggesting this": the card type is muted. */
export const muted = (a: Adjustments, type: string): Adjustments => ({ ...a, muted: { ...adjOf(a).muted, [type]: true } });

/** A date the app stores and compares as text (`YYYY-MM-DD`). */
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// `until` is what the prototype's `inRange` compares (`until >= date`), so a pulled value that is not a date would run
// for ever and read as "until Invalid Date". `from` matches the prototype's `(!r.from || r.from <= date)`: a falsy
// `from` (absent or null) has no lower bound, but a present, non-date one is refused.
const isRange = (r: unknown): r is AdjRange => !!r && typeof r === 'object' && isDate((r as AdjRange).until) && (!(r as AdjRange).from || isDate((r as AdjRange).from));

// The contract's `Workout.mods.reentry` is 0 to 1, and core's `applyMods` eases the suggested weight by `1 - pct`.
// A pulled fraction outside that (0, negative, above 1, NaN...) would fail `/sync` and suggest the wrong way, so it
// counts as no period at all: only a finite number with 0 < pct <= 1 is a re-entry.
const isPct = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1;

/** The stored recovery week and re-entry period; a malformed (pulled) value counts as none. */
export function rangesOf(a: Adjustments): { deload: AdjRange | null; reentry: ReentryRange | null } {
  const re = a.reentry;
  return { deload: isRange(a.deload) ? a.deload : null, reentry: isRange(re) && isPct((re as ReentryRange).pct) ? (re as ReentryRange) : null };
}

/** "Start recovery week": 7 days from `date`, and this week's card key is answered. */
export const startDeload = (a: Adjustments, date: string, key: string, today: string): Adjustments => ({ ...answered(a, key, today), deload: recoveryWeek(date) });

/** "Ease back in": 7 days at the card's 15%, 14 at its 30%, and the card's key is answered. */
export const startReentry = (a: Adjustments, date: string, key: string, pct: number, today: string): Adjustments => ({ ...answered(a, key, today), reentry: reentryRange(date, pct) });

/** "End it early" / "Back to normal" (prototype `adj-end`). */
export function endAdj(a: Adjustments, kind: 'deload' | 'reentry'): Adjustments {
  const { [kind]: _gone, ...rest } = a;
  return rest;
}

/** "Shift the week": the plan runs in order from here (prototype `adj-shift`); the card's key is answered and its declines reset. */
export const shiftWeek = (a: Adjustments, key: string, today: string): Adjustments => {
  const adj = answered(a, key, today);
  return { ...adj, mode: 'sequence', declines: { ...adjOf(a).declines, missed: 0 } };
};

/** "Go back to fixed weekdays" (prototype `adj-mode`). */
export const fixedWeekdays = (a: Adjustments): Adjustments => ({ ...a, mode: 'weekday' });

/** "N days" sets this week's condensed plan; 0 is "Back to the normal week" (prototype `adj-week`). */
export function weekPlanFor(a: Adjustments, date: string, n: 0 | 3 | 4 | 5): Adjustments {
  if (n === 0) {
    const { weekPlan: _gone, ...rest } = a;
    return rest;
  }
  return { ...a, weekPlan: { start: mondayOf(date), list: CONDENSED[n] } };
}
