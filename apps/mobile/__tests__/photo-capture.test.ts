import { CameraDenied, capturePhoto } from '../src/photos/capture';

// capturePhoto (#429) with the picker, the manipulator and the file system faked: the resize and quality follow the
// prototype (900 px, 0.72), and the plaintext working copies in the cache are deleted, never the user's own photo.
const CACHE = 'file:///data/user/0/app/cache/';
const mockPicker = { granted: true, result: null as unknown };
const mockOps: string[] = [];
const mockDeleted: string[] = [];

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: async () => ({ granted: mockPicker.granted }),
  launchCameraAsync: async () => (mockOps.push('camera'), mockPicker.result),
  launchImageLibraryAsync: async () => (mockOps.push('library'), mockPicker.result),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (uri: string) => {
      mockOps.push(`manipulate ${uri}`);
      const ctx = {
        resize: (s: object) => (mockOps.push(`resize ${JSON.stringify(s)}`), ctx),
        renderAsync: async () => ({
          saveAsync: async (o: { compress: number; format: string; base64: boolean }) => {
            mockOps.push(`save ${o.compress} ${o.format} ${o.base64}`);
            return { uri: 'file:///data/user/0/app/cache/ImageManipulator/out.jpg', base64: 'cmVzaXplZA==' };
          },
        }),
      };
      return ctx;
    },
  },
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///data/user/0/app/cache/' } },
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return true;
    }
    delete() {
      mockDeleted.push(this.uri);
    }
  },
}));

const picked = (uri: string, width: number, height: number) => ({ canceled: false, assets: [{ uri, width, height }] });

beforeEach(() => {
  mockPicker.granted = true;
  mockOps.length = 0;
  mockDeleted.length = 0;
});

it('resizes the long side to 900 px, saves JPEG at 0.72, returns base64 and deletes both cache copies', async () => {
  mockPicker.result = picked(`${CACHE}ImagePicker/a.jpg`, 3000, 4000);
  expect(await capturePhoto('camera')).toBe('cmVzaXplZA==');
  expect(mockOps).toEqual(['camera', `manipulate ${CACHE}ImagePicker/a.jpg`, 'resize {"height":900}', 'save 0.72 jpeg true']);
  expect(mockDeleted).toEqual([`${CACHE}ImagePicker/a.jpg`, `${CACHE}ImageManipulator/out.jpg`]);
});

it('a small photo is not resized', async () => {
  mockPicker.result = picked(`${CACHE}ImagePicker/b.jpg`, 800, 600);
  await capturePhoto('library');
  expect(mockOps.some((o) => o.startsWith('resize'))).toBe(false);
});

it('never deletes a photo outside the app cache (the user\'s own gallery file)', async () => {
  mockPicker.result = picked('file:///storage/emulated/0/DCIM/Camera/mine.jpg', 4000, 3000);
  await capturePhoto('library');
  expect(mockDeleted).toEqual([`${CACHE}ImageManipulator/out.jpg`]);
});

it('camera access off throws CameraDenied without opening the camera; a cancel returns null', async () => {
  mockPicker.granted = false;
  await expect(capturePhoto('camera')).rejects.toBeInstanceOf(CameraDenied);
  expect(mockOps).toEqual([]);
  mockPicker.result = { canceled: true, assets: null };
  expect(await capturePhoto('library')).toBeNull();
  expect(mockDeleted).toEqual([]);
});
