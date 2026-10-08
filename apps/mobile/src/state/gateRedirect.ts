import type { Status } from './ProfileProvider';

/**
 * Where the app should be, or null to stay put. No profile means setup; a profile means the Targets
 * screen on first open (and never the setup route).
 */
export function gateRedirect(o: { status: Status; hasProfile: boolean; pathname: string; firstOpen: boolean }): string | null {
  if (o.status !== 'ready') return null;
  if (!o.hasProfile) return o.pathname === '/setup' ? null : '/setup';
  if (o.pathname === '/setup') return '/targets';
  if (o.firstOpen && o.pathname === '/') return '/targets';
  return null;
}
