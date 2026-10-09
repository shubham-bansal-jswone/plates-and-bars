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

const nativeTokens: TokenStore = { load: loadTokens, save: saveTokens, clear: clearTokens };

/**
 * Native: expo-secure-store. Web: memory only for v1 (sign in again after a reload), because the browser has no secure
 * store and the long-term choice needs a contract change (see the spec question on web token storage).
 */
export const secureTokens: TokenStore = Platform.OS === 'web' ? memoryTokenStore() : nativeTokens;
