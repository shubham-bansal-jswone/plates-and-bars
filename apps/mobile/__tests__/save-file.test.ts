import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { clearOldExports, saveTextFile } from '../src/account/saveFile';

type Fake = { name: string; deleted: boolean; modificationTime?: number; delete: () => void };
const mockFiles: Fake[] = [];
const mockEvents: string[] = [];
let mockShare: () => Promise<void> = async () => undefined;
let mockListed: unknown[] = [];

jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: () => (mockEvents.push('share'), mockShare()) }));
jest.mock('expo-file-system', () => {
  class File {
    name: string;
    uri: string;
    deleted = false;
    modificationTime?: number;
    constructor(_dir: unknown, name?: string) {
      this.name = name ?? 'x';
      this.uri = `file:///cache/${this.name}`;
      mockFiles.push(this);
    }
    create() {}
    write() {}
    delete() {
      this.deleted = true;
      mockEvents.push('delete');
    }
  }
  class Directory {
    list() {
      return mockListed;
    }
  }
  return { File, Directory, Paths: { cache: 'cache' } };
});

const original = Platform.OS;
afterAll(() => {
  Platform.OS = original;
});
beforeEach(() => {
  mockFiles.length = 0;
  mockEvents.length = 0;
  mockListed = [];
  mockShare = async () => undefined;
});

const save = () => saveTextFile('plate-and-bar-export.json', 'application/json', '{}');

describe('export files in the cache (security review L10)', () => {
  it('iOS: deletes the file after the share sheet closes, never before', async () => {
    Platform.OS = 'ios';
    expect(await save()).toBe('shared');
    expect(mockFiles[0]?.deleted).toBe(true);
    expect(mockEvents).toEqual(['share', 'delete']);
  });

  it('Android: keeps the file after sharing (the receiving app may still be reading it)', async () => {
    Platform.OS = 'android';
    expect(await save()).toBe('shared');
    expect(mockFiles[0]?.deleted).toBe(false);
    expect(mockEvents).toEqual(['share']);
  });

  it.each(['ios', 'android'] as const)('%s: deletes the file when sharing throws', async (os) => {
    Platform.OS = os;
    mockShare = async () => {
      throw new Error('share failed');
    };
    await expect(save()).rejects.toThrow('share failed');
    expect(mockFiles[0]?.deleted).toBe(true);
  });

  it('sweeps leftover export files, and only ours', () => {
    Platform.OS = 'android';
    const mine = new File('cache', 'plate-and-bar-export-old.json') as unknown as Fake;
    const other = new File('cache', 'something-else.txt') as unknown as Fake;
    mockListed = [mine, other];
    clearOldExports();
    expect(mine.deleted).toBe(true);
    expect(other.deleted).toBe(false);
  });

  it('with minAgeMs, skips files changed within that time and deletes older ones', () => {
    Platform.OS = 'android';
    const fresh = new File('cache', 'plate-and-bar-a.json') as unknown as Fake;
    const old = new File('cache', 'plate-and-bar-b.json') as unknown as Fake;
    fresh.modificationTime = 1_000_000 - 5 * 60_000;
    old.modificationTime = 1_000_000 - 11 * 60_000;
    mockListed = [fresh, old];
    clearOldExports({ minAgeMs: 10 * 60_000, now: 1_000_000 });
    expect(fresh.deleted).toBe(false);
    expect(old.deleted).toBe(true);
  });

  it('without minAgeMs, deletes even a fresh file', () => {
    Platform.OS = 'android';
    const fresh = new File('cache', 'plate-and-bar-a.json') as unknown as Fake;
    fresh.modificationTime = 1_000_000;
    mockListed = [fresh];
    clearOldExports({ now: 1_000_000 });
    expect(fresh.deleted).toBe(true);
  });
});
