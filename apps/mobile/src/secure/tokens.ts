import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { secureOptions } from './keys';

// expo-secure-store has no web implementation (its calls throw). On web these helpers are
// deliberate no-ops: nothing is stored and loadTokens returns null, so the web build never throws.
const supported = Platform.OS !== 'web';

// Token storage only; there is no auth flow yet. Never log these values.
/** Also read by the web migration that removes them from web storage. */
export const ACCESS_KEY = 'pb.access_token';
export const REFRESH_KEY = 'pb.refresh_token';
/** The random install id (telemetry/errors.ts). Deleted with everything else by "Delete everything". */
export const INSTALL_ID_KEY = 'pb.install_id';
const ACCESS = ACCESS_KEY;
const REFRESH = REFRESH_KEY;

export interface Tokens {
  access: string;
  refresh: string;
}

export async function saveTokens(t: Tokens): Promise<void> {
  if (!supported) return;
  await SecureStore.setItemAsync(ACCESS, t.access, secureOptions());
  await SecureStore.setItemAsync(REFRESH, t.refresh, secureOptions());
}

export async function loadTokens(): Promise<Tokens | null> {
  if (!supported) return null;
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS),
    SecureStore.getItemAsync(REFRESH),
  ]);
  return access && refresh ? { access, refresh } : null;
}

export async function clearTokens(): Promise<void> {
  if (!supported) return;
  await SecureStore.deleteItemAsync(ACCESS);
  await SecureStore.deleteItemAsync(REFRESH);
}
