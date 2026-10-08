import type { Status } from './ProfileProvider';

/**
 * Where the app should be, or null to stay put. No profile means setup; a profile means the Targets
 * screen on first open. With a profile the setup route stays reachable (redo and recalculate); the setup
 * screen itself moves on to Targets once it saves.
 */
export function gateRedirect(o: { status: Status; hasProfile: boolean; pathname: string; firstOpen: boolean; skipped?: boolean }): string | null {
  if (o.status !== 'ready') return null;
  if (!o.hasProfile) return o.skipped || o.pathname === '/setup' ? null : '/setup';
  if (o.firstOpen && o.pathname === '/') return '/targets';
  return null;
}
