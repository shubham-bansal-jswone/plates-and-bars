import * as SecureStore from 'expo-secure-store';

// Token storage only; there is no auth flow yet. Never log these values.
const ACCESS = 'pb.access_token';
const REFRESH = 'pb.refresh_token';

export interface Tokens {
  access: string;
  refresh: string;
}

export async function saveTokens(t: Tokens): Promise<void> {
  await SecureStore.setItemAsync(ACCESS, t.access);
  await SecureStore.setItemAsync(REFRESH, t.refresh);
}

export async function loadTokens(): Promise<Tokens | null> {
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS),
    SecureStore.getItemAsync(REFRESH),
  ]);
  return access && refresh ? { access, refresh } : null;
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS);
  await SecureStore.deleteItemAsync(REFRESH);
}
