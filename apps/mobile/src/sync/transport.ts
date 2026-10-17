import { Platform } from 'react-native';

/**
 * How the refresh token travels (ADR 006). Web: an httpOnly cookie that script never sees; the app sends
 * `X-Auth-Transport: cookie` with `credentials: 'include'` and an empty body. Native: the token is in the JSON body and in
 * SecureStore. Read at call time, so a test can switch platform.
 */
export const cookieMode = (): boolean => Platform.OS === 'web';

/** Fetch options for the four endpoints that need the cookie (sign-in by email, refresh, revoke). Never used on other calls. */
export function authInit(): { headers?: Record<string, string>; credentials?: 'include' } {
  return cookieMode() ? { headers: { 'X-Auth-Transport': 'cookie' }, credentials: 'include' } : {};
}

/** The refresh request body: the token on native, `{}` on web (a body that carries `refresh_token` is refused in cookie mode). */
export const refreshBody = (refresh: string): { refresh_token?: string } => (cookieMode() ? {} : { refresh_token: refresh });
