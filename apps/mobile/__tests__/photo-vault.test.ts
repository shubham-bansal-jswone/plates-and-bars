/** @jest-environment node */
// The vault (#429) with an in-memory file system and secure store, and real AES-256-GCM from Node standing in for
// expo-crypto, so the encryption, the file-name binding and tampering are tested for real.
type MockBuf = { subarray(a: number, b?: number): MockBuf; length: number; toString(e: string): string };
const mockFiles = new Map<string, Uint8Array>();
const mockSecure = new Map<string, string>();
const mockFail = { dirDelete: false, dirGone: false, secureGet: false };
const mockWrites: string[] = [];

jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => {
    if (mockFail.secureGet) throw new Error('keystore');
    return mockSecure.get(k) ?? null;
  },
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
  deleteItemAsync: async (k: string) => void mockSecure.delete(k),
}));

jest.mock('expo-file-system', () => {
  class Directory {
    path: string;
    constructor(parent: string, name: string) {
      this.path = `${parent}/${name}`;
    }
    get exists() {
      return [...mockFiles.keys()].some((p) => p.startsWith(`${this.path}/`)) || mockDirs.has(this.path);
    }
    create() {
      mockDirs.add(this.path);
    }
    delete() {
      if (mockFail.dirGone) {
        // another delete got there first: the folder vanished and this call fails
        for (const p of [...mockFiles.keys()]) if (p.startsWith(`${this.path}/`)) mockFiles.delete(p);
        mockDirs.delete(this.path);
        throw new Error('not found');
      }
      if (mockFail.dirDelete) throw new Error('busy');
      for (const p of [...mockFiles.keys()]) if (p.startsWith(`${this.path}/`)) mockFiles.delete(p);
      mockDirs.delete(this.path);
    }
    list() {
      return [...mockFiles.keys()].filter((p) => p.startsWith(`${this.path}/`)).map((p) => ({ name: p.slice(this.path.length + 1) }));
    }
  }
  const mockDirs = new Set<string>();
  class File {
    path: string;
    constructor(dir: { path: string }, name: string) {
      this.path = `${dir.path}/${name}`;
    }
    get exists() {
      return mockFiles.has(this.path);
    }
    create() {
      mockFiles.set(this.path, new Uint8Array());
    }
    write(b: Uint8Array) {
      mockWrites.push(this.path);
      mockFiles.set(this.path, b);
    }
    moveSync(dest: { path: string; exists: boolean }, o?: { overwrite?: boolean }) {
      if (dest.exists && !o?.overwrite) throw new Error('DestinationAlreadyExistsException'); // as on Android
      mockFiles.set(dest.path, mockFiles.get(this.path) as Uint8Array);
      mockFiles.delete(this.path);
    }
    async bytes() {
      return mockFiles.get(this.path) as Uint8Array;
    }
    delete() {
      mockFiles.delete(this.path);
    }
  }
  return { Directory, File, Paths: { document: 'doc', cache: 'cache' } };
});

jest.mock('expo-crypto', () => {
  const c = jest.requireActual('crypto');
  const B = jest.requireActual('buffer').Buffer;
  class AESEncryptionKey {
    b: MockBuf;
    constructor(k: MockBuf) {
      this.b = k;
    }
    static async generate() {
      return new AESEncryptionKey(c.randomBytes(32));
    }
    static async import(s: string) {
      return new AESEncryptionKey(B.from(s, 'base64'));
    }
    async encoded() {
      return this.b.toString('base64');
    }
  }
  class AESSealedData {
    buf: MockBuf;
    constructor(x: MockBuf) {
      this.buf = x;
    }
    static fromCombined(b: Uint8Array) {
      return new AESSealedData(B.from(b));
    }
    async combined() {
      return new Uint8Array(this.buf as unknown as ArrayBuffer);
    }
  }
  return {
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync: async (pt: string, key: AESEncryptionKey, o: { additionalData: string; nonce?: { length: number } }) => {
      if (o.nonce?.length !== 12) throw new Error('nonce length must be set to 12'); // not left to the provider's default
      const iv = c.randomBytes(12);
      const ci = c.createCipheriv('aes-256-gcm', key.b, iv);
      ci.setAAD(B.from(o.additionalData, 'base64'));
      const ct = B.concat([ci.update(B.from(pt, 'base64')), ci.final()]);
      return new AESSealedData(B.concat([iv, ct, ci.getAuthTag()]));
    },
    aesDecryptAsync: async (s: AESSealedData, key: AESEncryptionKey, o: { additionalData: string }) => {
      const b = s.buf;
      const d = c.createDecipheriv('aes-256-gcm', key.b, b.subarray(0, 12));
      d.setAAD(B.from(o.additionalData, 'base64'));
      d.setAuthTag(b.subarray(b.length - 16));
      return B.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString('base64');
    },
  };
});

type Vault = typeof import('../src/photos/vault');
const JPEG = btoa('a fake jpeg, but private');
const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

function load(os: 'android' | 'web'): Vault {
  let v: Vault | undefined;
  jest.isolateModules(() => {
    (jest.requireActual('react-native') as typeof import('react-native')).Platform.OS = os;
    v = jest.requireActual('../src/photos/vault');
  });
  return v as Vault;
}

beforeEach(() => {
  mockFiles.clear();
  mockSecure.clear();
  mockFail.dirDelete = false;
  mockFail.dirGone = false;
  mockFail.secureGet = false;
  mockWrites.length = 0;
});

describe('photo vault on Android', () => {
  it('stores each photo encrypted under its own name and reads it back', async () => {
    const v = load('android');
    await v.putPhoto('2026-10-01', 'front', JPEG);
    const stored = mockFiles.get('doc/photos/2026-10-01_front.bin') as Uint8Array;
    expect(new TextDecoder().decode(stored)).not.toContain('private');
    expect(toBase64(stored)).not.toContain(JPEG);
    expect(mockSecure.get('pb.photo_key')).toBeTruthy();
    expect(await v.getPhoto('2026-10-01', 'front')).toBe(JPEG);
    expect(await v.getPhoto('2026-10-01', 'side')).toBeNull();
  });

  it('keeps the key across restarts and replaces a retaken photo', async () => {
    await load('android').putPhoto('2026-10-01', 'side', JPEG);
    const again = load('android'); // a fresh module, as after an app restart
    const retake = btoa('retaken');
    await again.putPhoto('2026-10-01', 'side', retake);
    expect(await again.getPhoto('2026-10-01', 'side')).toBe(retake);
  });

  it('a file copied under another name, or altered, does not decrypt', async () => {
    const v = load('android');
    await v.putPhoto('2026-10-01', 'front', JPEG);
    const bytes = mockFiles.get('doc/photos/2026-10-01_front.bin') as Uint8Array;
    mockFiles.set('doc/photos/2026-10-08_front.bin', bytes);
    expect(await v.getPhoto('2026-10-08', 'front')).toBeNull();
    const altered = Uint8Array.from(bytes);
    altered[20] = (altered[20] ?? 0) ^ 1;
    mockFiles.set('doc/photos/2026-10-01_front.bin', altered);
    expect(await v.getPhoto('2026-10-01', 'front')).toBeNull();
  });

  it('lists days oldest first, deletes one pose, and refuses a key that is not a date and pose', async () => {
    const v = load('android');
    await v.putPhoto('2026-10-08', 'back', JPEG);
    await v.putPhoto('2026-10-01', 'front', JPEG);
    await v.putPhoto('2026-10-01', 'side', JPEG);
    expect(await v.photoDates()).toEqual(['2026-10-01', '2026-10-08']);
    await v.deletePhoto('2026-10-08', 'back');
    expect(await v.photoDates()).toEqual(['2026-10-01']);
    await expect(v.putPhoto('../../x', 'front', JPEG)).rejects.toThrow('bad photo key');
    await expect(v.getPhoto('2026-10-01', 'top' as never)).rejects.toThrow('bad photo key');
  });

  it('wipe deletes every photo and the key; a new key is made afterwards', async () => {
    const v = load('android');
    await v.putPhoto('2026-10-01', 'front', JPEG);
    const oldKey = mockSecure.get('pb.photo_key');
    await v.wipePhotos();
    expect(mockFiles.size).toBe(0);
    expect(mockSecure.has('pb.photo_key')).toBe(false);
    expect(await v.photoDates()).toEqual([]);
    await v.putPhoto('2026-10-02', 'front', JPEG);
    expect(mockSecure.get('pb.photo_key')).not.toBe(oldKey);
  });
});

describe('photo vault failures and races (review on #430)', () => {
  it('a wipe deletes the key before the files, so a failed folder delete leaves nothing readable', async () => {
    const v = load('android');
    await v.putPhoto('2026-10-01', 'front', JPEG);
    mockFail.dirDelete = true;
    await expect(v.wipePhotos()).rejects.toThrow('busy');
    expect(mockSecure.has('pb.photo_key')).toBe(false);
    mockFail.dirDelete = false;
    expect(await load('android').getPhoto('2026-10-01', 'front')).toBeNull();
  });

  it('a lost key is replaced only after the unreadable files are removed', async () => {
    await load('android').putPhoto('2026-10-01', 'front', JPEG);
    mockSecure.clear(); // the key is gone, the files are not
    const v = load('android');
    await v.putPhoto('2026-10-08', 'front', JPEG);
    expect(await v.photoDates()).toEqual(['2026-10-08']);
    expect(await v.getPhoto('2026-10-08', 'front')).toBe(JPEG);
  });

  it('a wipe started while a put is running leaves no file behind', async () => {
    const v = load('android');
    const put = v.putPhoto('2026-10-01', 'front', JPEG);
    const wipe = v.wipePhotos();
    await Promise.all([put, wipe]);
    expect(mockFiles.size).toBe(0);
    expect(await v.photoDates()).toEqual([]);
  });

  it('a key store failure is thrown, not shown as a missing photo', async () => {
    await load('android').putPhoto('2026-10-01', 'front', JPEG);
    const v = load('android');
    mockFail.secureGet = true;
    await expect(v.getPhoto('2026-10-01', 'front')).rejects.toThrow('keystore');
  });

  it('a retake is written beside the old photo, then moved over it, and leaves no temporary file', async () => {
    const v = load('android');
    await v.putPhoto('2026-10-01', 'front', JPEG);
    await v.putPhoto('2026-10-01', 'front', btoa('again'));
    expect(mockWrites).toEqual(['doc/photos/2026-10-01_front.bin.tmp', 'doc/photos/2026-10-01_front.bin.tmp']);
    expect([...mockFiles.keys()]).toEqual(['doc/photos/2026-10-01_front.bin']);
    expect(await v.getPhoto('2026-10-01', 'front')).toBe(btoa('again'));
  });

  it('a wipe whose folder vanished meanwhile still succeeds', async () => {
    const v = load('android');
    await v.putPhoto('2026-10-01', 'front', JPEG);
    mockFail.dirGone = true;
    await expect(v.wipePhotos()).resolves.toBeUndefined();
    expect(mockSecure.has('pb.photo_key')).toBe(false);
  });
});

describe('photo vault wipe extras (#431)', () => {
  it('a wipe also clears the picker and manipulator working copies in the cache, and leaves other cache files', async () => {
    const v = load('android');
    mockFiles.set('cache/ImagePicker/raw.jpg', new Uint8Array([1]));
    mockFiles.set('cache/ImageManipulator/out.jpg', new Uint8Array([2]));
    mockFiles.set('cache/plate-and-bar-export.json', new Uint8Array([3]));
    await v.wipePhotos();
    expect([...mockFiles.keys()]).toEqual(['cache/plate-and-bar-export.json']);
  });

  it('a wipe itself tells no one; announceWipe tells every listener until it unsubscribes', async () => {
    const v = load('android');
    const heard = jest.fn();
    const off = v.onPhotosWiped(heard);
    await v.wipePhotos();
    expect(heard).not.toHaveBeenCalled(); // guard.ts announces, after the wipe marker is cleared
    v.announceWipe(true);
    v.announceWipe(false);
    expect(heard.mock.calls).toEqual([[true], [false]]);
    off();
    v.announceWipe(true);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('photo vault on web', () => {
  it('keeps photos in memory only: nothing is written and nothing is stored as a key', async () => {
    const v = load('web');
    expect(v.persistent).toBe(false);
    await v.putPhoto('2026-10-01', 'front', JPEG);
    expect(await v.getPhoto('2026-10-01', 'front')).toBe(JPEG);
    expect(await v.photoDates()).toEqual(['2026-10-01']);
    expect(mockFiles.size).toBe(0);
    expect(mockSecure.size).toBe(0);
    await v.wipePhotos();
    expect(await v.photoDates()).toEqual([]);
  });
});
