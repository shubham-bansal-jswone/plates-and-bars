import { Platform } from 'react-native';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { WriteLock } from '../db/writeLock';

// Progress photos (#429): device only, never synced or uploaded. Native: AES-256-GCM (expo-crypto) with a random key
// kept in expo-secure-store, one encrypted file per photo under <documents>/photos, the file name bound to the
// ciphertext as additional data so files cannot be swapped. Web has no secure key store, so photos live in memory for
// the session only (`persistent` is false and the screen says so). Photos go in and come out as base64 JPEG.
// Every operation runs under one lock, so a wipe never interleaves with a put or a read.

export const POSES = ['front', 'side', 'back'] as const;
export type Pose = (typeof POSES)[number];

const KEY = 'pb.photo_key';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const native = Platform.OS !== 'web';
/** False on web: photos are kept for this session only. */
export const persistent = native;

const memory = new Map<string, string>();
const lock = new WriteLock();

function fileName(date: string, pose: Pose): string {
  if (!DATE.test(date) || !POSES.includes(pose)) throw new Error('bad photo key');
  return `${date}_${pose}.bin`;
}

const folder = () => new Directory(Paths.document, 'photos');

function deleteDir(make: () => Directory): void {
  const dir = make();
  try {
    if (dir.exists) dir.delete();
  } catch (e) {
    if (make().exists) throw e; // gone meanwhile is fine
  }
}
const deleteFolder = () => deleteDir(folder);
/** Where expo-image-picker and expo-image-manipulator leave their working copies (plaintext, possibly with EXIF). */
const CAPTURE_CACHES = ['ImagePicker', 'ImageManipulator'];

const wipeListeners = new Set<(ok: boolean) => void>();
/**
 * Called after every owed wipe (guard.ts `finishPhotoWipe`) with whether it fully succeeded, marker cleared included,
 * so a screen showing photos drops them at once. Returns the unsubscribe.
 */
export function onPhotosWiped(listener: (ok: boolean) => void): () => void {
  wipeListeners.add(listener);
  return () => void wipeListeners.delete(listener);
}
/** Tells the listeners an owed wipe ended. Only guard.ts calls this, after the wipe marker is cleared (or not). */
export function announceWipe(ok: boolean): void {
  wipeListeners.forEach((f) => f(ok));
}

let key: AESEncryptionKey | null = null;
/** Called under the lock. A new key makes any old files unreadable, so they are removed first. */
async function vaultKey(): Promise<AESEncryptionKey> {
  if (key) return key;
  const stored = await SecureStore.getItemAsync(KEY);
  if (stored) return (key = await AESEncryptionKey.import(stored, 'base64'));
  deleteFolder();
  const fresh = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(KEY, await fresh.encoded('base64'));
  return (key = fresh);
}

/** Saves (or replaces) the photo for one pose on one day. */
export function putPhoto(date: string, pose: Pose, jpegBase64: string): Promise<void> {
  return lock.run(async () => {
    const name = fileName(date, pose);
    if (!native) {
      memory.set(name, jpegBase64);
      return;
    }
    const sealed = await aesEncryptAsync(jpegBase64, await vaultKey(), { nonce: { length: 12 }, additionalData: btoa(name) });
    const dir = folder();
    dir.create({ intermediates: true, idempotent: true });
    // Written beside the old photo first, so a failed encrypt or write keeps the old one (the move itself replaces it).
    const tmp = new File(dir, `${name}.tmp`);
    tmp.write(await sealed.combined());
    tmp.moveSync(new File(dir, name), { overwrite: true });
  });
}

/** The photo as base64 JPEG, or null when there is none or it does not decrypt. Key store errors are thrown. */
export function getPhoto(date: string, pose: Pose): Promise<string | null> {
  return lock.run(async () => {
    const name = fileName(date, pose);
    if (!native) return memory.get(name) ?? null;
    const file = new File(folder(), name);
    if (!file.exists) return null;
    const k = await vaultKey();
    try {
      return await aesDecryptAsync(AESSealedData.fromCombined(await file.bytes()), k, { output: 'base64', additionalData: btoa(name) });
    } catch {
      return null; // altered or written under another key
    }
  });
}

export function deletePhoto(date: string, pose: Pose): Promise<void> {
  return lock.run(async () => {
    const name = fileName(date, pose);
    if (!native) {
      memory.delete(name);
      return;
    }
    const file = new File(folder(), name);
    if (file.exists) file.delete();
  });
}

/** Days with at least one photo, oldest first. */
export function photoDates(): Promise<string[]> {
  return lock.run(async () => {
    const names = native ? (folder().exists ? folder().list().map((f) => f.name) : []) : [...memory.keys()];
    const dates = names.filter((n) => n.endsWith('.bin')).map((n) => n.split('_')[0] ?? '').filter((d) => DATE.test(d));
    return [...new Set(dates)].sort();
  });
}

/**
 * Deletes every photo and the key (account switch, discard, delete everything: ADR 004, #251). The key goes first, so
 * whatever is left after a failure is unreadable. Callers keep a pending marker until this resolves (see guard.ts).
 */
export function wipePhotos(): Promise<void> {
  return lock.run(async () => {
    memory.clear();
    if (!native) return;
    key = null;
    await SecureStore.deleteItemAsync(KEY);
    deleteFolder();
    for (const name of CAPTURE_CACHES) deleteDir(() => new Directory(Paths.cache, name));
  });
}
