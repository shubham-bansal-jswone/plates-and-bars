import { Platform } from 'react-native';
import { clearTokens, loadTokens, saveTokens, type Tokens } from '../secure/tokens';

/** Where tokens live (expo-secure-store in the app; a fake in tests). */
export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(t: Tokens): Promise<void>;
  clear(): Promise<void>;
}

/** Tokens in memory only: gone on reload. */
export function memoryTokenStore(): TokenStore {
  let t: Tokens | null = null;
  return { load: async () => t, save: async (v) => void (t = v), clear: async () => void (t = null) };
}

/**
 * Web (ADR 006): the access token in memory only, never in web storage. The refresh token is not kept at all: it is an
 * httpOnly cookie that script cannot read, so `save` drops the (empty) one it is given and `load` returns an empty one.
 */
export function webTokenStore(): TokenStore {
  let access: string | null = null;
  return {
    load: async () => (access ? { access, refresh: '' } : null),
    save: async (t) => void (access = t.access),
    clear: async () => void (access = null),
  };
}

const nativeTokens: TokenStore = { load: loadTokens, save: saveTokens, clear: clearTokens };

/** Native: expo-secure-store. Web: the access token in memory and the refresh token in a cookie (ADR 006). */
export const secureTokens: TokenStore = Platform.OS === 'web' ? webTokenStore() : nativeTokens;
