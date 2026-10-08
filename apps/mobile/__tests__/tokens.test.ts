import * as SecureStore from 'expo-secure-store';
import { clearTokens, loadTokens, saveTokens } from '../src/secure/tokens';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    setItemAsync: async (k: string, v: string) => void store.set(k, v),
    getItemAsync: async (k: string) => store.get(k) ?? null,
    deleteItemAsync: async (k: string) => void store.delete(k),
  };
});

describe('tokens', () => {
  it('round-trips and clears', async () => {
    expect(await loadTokens()).toBeNull();
    await saveTokens({ access: 'a', refresh: 'r' });
    expect(await loadTokens()).toEqual({ access: 'a', refresh: 'r' });
    await clearTokens();
    expect(await loadTokens()).toBeNull();
    expect(SecureStore.getItemAsync).toBeDefined();
  });
});
