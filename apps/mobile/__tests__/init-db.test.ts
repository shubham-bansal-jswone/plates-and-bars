/** @jest-environment node */
import type { SQLiteDatabase } from 'expo-sqlite';
import { initDb } from '../src/db/initDb';

// The order of startup work matters: error tracking reads pb.install_id, so it must not start before a reinstall's keystore clear.
const mockLog: string[] = [];
const mockFail = { clear: false, migrate: false };
const mockInit = jest.fn();
const mockCapture = jest.fn();
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@sentry/react-native', () => ({ init: (o: unknown) => (mockLog.push('sentry.init'), mockInit(o)), setUser: () => undefined, captureException: (e: unknown) => mockCapture(e) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'fresh-id' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.3', android: { versionCode: 1002003 } } } }));
jest.mock('../src/content/loader', () => ({ loadContent: async () => void mockLog.push('loadContent') }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => (mockLog.push(`read ${k}`), 'old-id'),
  setItemAsync: async () => undefined,
  deleteItemAsync: async (k: string) => {
    if (mockFail.clear) throw new Error('keychain');
    mockLog.push(`delete ${k}`);
  },
}));
jest.mock('../src/db/migrations', () => {
  const actual = jest.requireActual('../src/db/migrations');
  return { ...actual, migrate: async (db: unknown) => (mockLog.push('migrate'), mockFail.migrate ? Promise.reject(new Error('disk')) : actual.migrate(db)) };
});

function newDb(): SQLiteDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => { exec(s: string): void; prepare(s: string): { get(...p: unknown[]): unknown; run(...p: unknown[]): unknown } } };
  const raw = new DatabaseSync(':memory:');
  return {
    execAsync: async (s: string) => void raw.exec(s),
    getFirstAsync: async (sql: string, ...p: unknown[]) => raw.prepare(sql).get(...p) ?? null,
    runAsync: async (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...p),
  } as unknown as SQLiteDatabase;
}
const installIdReads = () => mockLog.filter((l) => l === 'read pb.install_id').length;

beforeEach(() => {
  mockLog.length = 0;
  mockFail.clear = false;
  mockFail.migrate = false;
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@glitchtip.example/1';
});
afterAll(() => delete process.env.EXPO_PUBLIC_SENTRY_DSN);

describe('initDb order', () => {
  it('a reinstall: migrate, clear the four keys, only then start error tracking, which then reads the (new) install id', async () => {
    await initDb(newDb());
    const at = (l: string) => mockLog.indexOf(l);
    expect(at('migrate')).toBeLessThan(at('delete pb.access_token'));
    for (const k of ['pb.access_token', 'pb.refresh_token', 'pb.photo_key', 'pb.install_id']) expect(at(`delete ${k}`)).toBeLessThan(at('sentry.init'));
    expect(at('sentry.init')).toBeLessThan(at('read pb.install_id'));
    expect(at('sentry.init')).toBeLessThan(at('loadContent'));
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('every attempt at the clear failed: tracking starts without reading the stored id, and the failure is reported without text or id', async () => {
    mockFail.clear = true;
    await initDb(newDb());
    await new Promise((r) => setTimeout(r, 10));
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(installIdReads()).toBe(0);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0]![0]).toMatchObject({ name: 'KeystoreResetError' });
  });

  it('the store could not be prepared: tracking starts without the stored id, the error is rethrown', async () => {
    mockFail.migrate = true;
    await expect(initDb(newDb())).rejects.toThrow('disk');
    await new Promise((r) => setTimeout(r, 10));
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(installIdReads()).toBe(0);
    expect(mockLog).not.toContain('loadContent');
  });
});
