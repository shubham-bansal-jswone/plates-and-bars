import { clearTokens, loadTokens, saveTokens, type Tokens } from '../secure/tokens';

/** Where tokens live (expo-secure-store in the app; a fake in tests). */
export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(t: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export const secureTokens: TokenStore = { load: loadTokens, save: saveTokens, clear: clearTokens };
