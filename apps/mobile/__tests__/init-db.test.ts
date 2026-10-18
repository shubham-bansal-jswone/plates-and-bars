/** @jest-environment node */
import type { SQLiteDatabase } from 'expo-sqlite';

// The order of startup work matters: error tracking starts at module load with no user, and the install id (read from the
// keystore) is attached only after a reinstall's keystore clear.
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

type Mods = { initDb: (db: SQLiteDatabase) => Promise<void>; initErrorTracking: () => boolean };
/** Fresh modules, as after an app start (error tracking keeps a "started" flag). */
function load(): Mods {
  let m: Mods | undefined;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    m = { initDb: (require('../src/db/initDb') as Mods).initDb, initErrorTracking: (require('../src/telemetry/errors') as Mods).initErrorTracking };
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  return m as Mods;
}

beforeEach(() => {
  mockLog.length = 0;
  mockFail.clear = false;
  mockFail.migrate = false;
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@glitchtip.example/1';
});
afterAll(() => delete process.env.EXPO_PUBLIC_SENTRY_DSN);

describe('initDb order', () => {
  it('a reinstall: tracking is already on (no user, no keystore read), then migrate, clear the four keys, and only then the install id is read', async () => {
    const { initDb, initErrorTracking } = load();
    initErrorTracking(); // as at module load of the layout
    expect(mockLog).toEqual(['sentry.init']);
    await initDb(newDb());
    const at = (l: string) => mockLog.indexOf(l);
    expect(at('sentry.init')).toBeLessThan(at('migrate'));
    expect(at('migrate')).toBeLessThan(at('delete pb.access_token'));
    for (const k of ['pb.access_token', 'pb.refresh_token', 'pb.photo_key', 'pb.install_id']) expect(at(`delete ${k}`)).toBeLessThan(at('read pb.install_id'));
    expect(at('read pb.install_id')).toBeLessThan(at('loadContent'));
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('every attempt at the clear failed: the stored id is never read, and the failure is reported without text or id', async () => {
    mockFail.clear = true;
    const { initDb, initErrorTracking } = load();
    initErrorTracking();
    await initDb(newDb());
    expect(installIdReads()).toBe(0);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0]![0]).toMatchObject({ name: 'KeystoreResetError' });
  });

  it('the store could not be prepared: the error is rethrown, tracking is on and no id was read', async () => {
    mockFail.migrate = true;
    const { initDb, initErrorTracking } = load();
    initErrorTracking();
    await expect(initDb(newDb())).rejects.toThrow('disk');
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(installIdReads()).toBe(0);
    expect(mockLog).not.toContain('loadContent');
  });

  it('a provider remount runs initDb again without starting the SDK again', async () => {
    const { initDb, initErrorTracking } = load();
    initErrorTracking();
    const db = newDb();
    await initDb(db);
    initErrorTracking();
    await initDb(db);
    expect(mockInit).toHaveBeenCalledTimes(1);
  });
});
