import type { Special } from './targets';

/** A health-check answer. Questions are keyed by index (0–5) as in the prototype. */
export type ScreenAnswer = 'yes' | 'no';

/** The profile fields the health check reads. */
export interface HealthProfile {
  special?: Special;
  /** Health-check answers keyed by question index. */
  screen?: Readonly<Record<string, ScreenAnswer>>;
  /** Set (to the date, `YYYY-MM-DD`) when the user taps "My doctor has cleared me". Any truthy value counts. */
  cleared?: string | null;
}

/**
 * True when any health-check question was answered "yes".
 *
 * Mirrors prototype `screenFlag(p)` (which returns a falsy non-boolean when there is no profile or no answers).
 */
export function screenFlag(p: HealthProfile | null | undefined): boolean {
  return !!(p && p.screen && Object.values(p.screen).includes('yes'));
}

/**
 * True when sessions must stay light (one fewer set, no weight increases) until the user confirms
 * a doctor has cleared them: any health-check "yes", or pregnancy, and not yet cleared.
 * Breastfeeding alone does not trigger it.
 *
 * Mirrors prototype `needsClearance()`, which reads `S.settings.profile`; here the profile is passed in.
 */
export function needsClearance(p: HealthProfile | null | undefined): boolean {
  return !!(p && ((screenFlag(p) && !p.cleared) || (p.special === 'pregnant' && !p.cleared)));
}
