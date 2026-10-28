import { IMPORT_MAX_CHARS } from '@plate-and-bar/core';
import { pickCsv } from '../src/import/pickCsv';

const mockGet = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a: unknown[]) => mockGet(...a) }));
const mockText = jest.fn(async () => 'a,b');
const mockDelete = jest.fn();
let mockFileSize: number | null = 10;
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(u: string) {
      this.uri = u;
    }
    get size() {
      return mockFileSize;
    }
    text() {
      return mockText();
    }
    delete() {
      mockDelete(this.uri);
    }
  },
}));

beforeEach(() => {
  mockGet.mockReset();
  mockText.mockClear();
  mockDelete.mockClear();
  mockFileSize = 10;
});

describe('pickCsv', () => {
  it('reads the chosen file and deletes the cached copy', async () => {
    mockGet.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///c/x.csv', size: 10, name: 'x.csv' }] });
    expect(await pickCsv()).toEqual({ kind: 'text', text: 'a,b' });
    expect(mockDelete).toHaveBeenCalledWith('file:///c/x.csv');
  });
  it('refuses a file over the cap without reading it, and still deletes the copy', async () => {
    mockGet.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///c/x.csv', size: IMPORT_MAX_CHARS + 1, name: 'x.csv' }] });
    expect(await pickCsv()).toEqual({ kind: 'too_large' });
    expect(mockText).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalled();
  });
  it('falls back to the file size when the picker gives none, and refuses when the size is unknown', async () => {
    mockGet.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///c/x.csv', name: 'x.csv' }] });
    mockFileSize = IMPORT_MAX_CHARS + 5;
    expect(await pickCsv()).toEqual({ kind: 'too_large' });
    mockFileSize = null;
    expect(await pickCsv()).toEqual({ kind: 'unreadable' });
  });
  it('reports a cancel and a failure', async () => {
    mockGet.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickCsv()).toEqual({ kind: 'cancelled' });
    mockGet.mockRejectedValue(new Error('x'));
    expect(await pickCsv()).toEqual({ kind: 'unreadable' });
  });
});
