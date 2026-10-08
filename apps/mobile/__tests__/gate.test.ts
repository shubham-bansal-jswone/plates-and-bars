import { gateRedirect } from '../src/state/gateRedirect';

describe('gateRedirect', () => {
  const base = { status: 'ready' as const, hasProfile: false, pathname: '/', firstOpen: true };
  it('waits while loading', () => expect(gateRedirect({ ...base, status: 'loading' })).toBeNull());
  it('sends a user with no profile to setup', () => expect(gateRedirect(base)).toBe('/setup'));
  it('stays on setup without a profile', () => expect(gateRedirect({ ...base, pathname: '/setup' })).toBeNull());
  it('opens to targets when a profile exists', () => expect(gateRedirect({ ...base, hasProfile: true })).toBe('/targets'));
  it('lets a user with a profile stay on setup, to redo it', () => expect(gateRedirect({ ...base, hasProfile: true, pathname: '/setup', firstOpen: false })).toBeNull());
  it('does not pull the user back to targets later', () => expect(gateRedirect({ ...base, hasProfile: true, firstOpen: false })).toBeNull());
  it('stays out of setup after Skip for now', () => expect(gateRedirect({ ...base, skipped: true })).toBeNull());
});
