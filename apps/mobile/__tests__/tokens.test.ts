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
  });
});

describe('tokens on web', () => {
  it('are a no-op that never throws', async () => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
    jest.doMock('expo-secure-store', () => ({
      setItemAsync: () => { throw new Error('unsupported'); },
      getItemAsync: () => { throw new Error('unsupported'); },
      deleteItemAsync: () => { throw new Error('unsupported'); },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic import is unsupported in Jest CJS
    const web = require('../src/secure/tokens') as typeof import('../src/secure/tokens');
    await web.saveTokens({ access: 'a', refresh: 'r' });
    expect(await web.loadTokens()).toBeNull();
    await web.clearTokens();
  });
});
