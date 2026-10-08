import { gateRedirect } from '../src/state/gateRedirect';

describe('gateRedirect', () => {
  const base = { status: 'ready' as const, hasProfile: false, pathname: '/', firstOpen: true };
  it('waits while loading', () => expect(gateRedirect({ ...base, status: 'loading' })).toBeNull());
  it('sends a user with no profile to setup', () => expect(gateRedirect(base)).toBe('/setup'));
  it('stays on setup without a profile', () => expect(gateRedirect({ ...base, pathname: '/setup' })).toBeNull());
  it('opens to targets when a profile exists', () => expect(gateRedirect({ ...base, hasProfile: true })).toBe('/targets'));
  it('leaves setup once a profile exists', () => expect(gateRedirect({ ...base, hasProfile: true, pathname: '/setup', firstOpen: false })).toBe('/targets'));
  it('does not pull the user back to targets later', () => expect(gateRedirect({ ...base, hasProfile: true, firstOpen: false })).toBeNull());
});
