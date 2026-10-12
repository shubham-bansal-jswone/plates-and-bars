import { File } from 'expo-file-system';
import { clearOldExports, saveTextFile } from '../src/account/saveFile';

const mockFiles: { name: string; deleted: boolean; delete: () => void }[] = [];
let mockShare: () => Promise<void> = async () => undefined;
let mockListed: unknown[] = [];

jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: () => mockShare() }));
jest.mock('expo-file-system', () => {
  class File {
    name: string;
    uri: string;
    deleted = false;
    constructor(_dir: unknown, name?: string) {
      this.name = name ?? 'x';
      this.uri = `file:///cache/${this.name}`;
      mockFiles.push(this);
    }
    create() {}
    write() {}
    delete() {
      this.deleted = true;
    }
  }
  class Directory {
    list() {
      return mockListed;
    }
  }
  return { File, Directory, Paths: { cache: 'cache' } };
});
beforeEach(() => {
  mockFiles.length = 0;
  mockListed = [];
  mockShare = async () => undefined;
});

describe('export files in the cache (security review L10)', () => {
  it('deletes the file once the share sheet closes', async () => {
    expect(await saveTextFile('plate-and-bar-export.json', 'application/json', '{}')).toBe('shared');
    expect(mockFiles[0]?.deleted).toBe(true);
  });

  it('deletes the file even when sharing fails', async () => {
    mockShare = async () => {
      throw new Error('share failed');
    };
    await expect(saveTextFile('plate-and-bar-export.json', 'application/json', '{}')).rejects.toThrow('share failed');
    expect(mockFiles[0]?.deleted).toBe(true);
  });

  it('sweeps leftover export files, and only ours', () => {
    const mine = new File('cache', 'plate-and-bar-export-old.json');
    const other = new File('cache', 'something-else.txt');
    mockFiles.length = 0;
    mockListed = [mine, other];
    clearOldExports();
    expect((mine as unknown as { deleted: boolean }).deleted).toBe(true);
    expect((other as unknown as { deleted: boolean }).deleted).toBe(false);
  });
});
