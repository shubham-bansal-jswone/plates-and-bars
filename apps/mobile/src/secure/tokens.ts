import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// expo-secure-store has no web implementation (its calls throw). On web these helpers are
// deliberate no-ops: nothing is stored and loadTokens returns null, so the web build never throws.
const supported = Platform.OS !== 'web';

// Token storage only; there is no auth flow yet. Never log these values.
const ACCESS = 'pb.access_token';
const REFRESH = 'pb.refresh_token';

export interface Tokens {
  access: string;
  refresh: string;
}

export async function saveTokens(t: Tokens): Promise<void> {
  if (!supported) return;
  await SecureStore.setItemAsync(ACCESS, t.access);
  await SecureStore.setItemAsync(REFRESH, t.refresh);
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
