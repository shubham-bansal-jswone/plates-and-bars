import type { Status } from './ProfileProvider';

/**
 * Where the app should be, or null to stay put. No profile means setup; a profile means the Targets
 * screen on first open. With a profile a bare `/setup` (a reload or restored URL) goes to Targets; setup stays
 * open only when the Targets screen asked for it (`redo`: `/setup?redo=1` or `?recalc=1`).
 */
export function gateRedirect(o: { status: Status; hasProfile: boolean; pathname: string; firstOpen: boolean; skipped?: boolean; redo?: boolean }): string | null {
  if (o.status !== 'ready') return null;
  // /sign-in stays reachable without a profile: a returning user can sign in to pull their records instead of doing setup.
  if (!o.hasProfile) return o.skipped || o.pathname === '/setup' || o.pathname === '/sign-in' ? null : '/setup';
  if (o.pathname === '/setup') return o.redo ? null : '/targets';
  if (o.firstOpen && o.pathname === '/') return '/targets';
  return null;
}
