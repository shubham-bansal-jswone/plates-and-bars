import { Platform } from 'react-native';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

// Progress photos (#429): device only, never synced or uploaded. Native: AES-256-GCM (expo-crypto) with a random key
// kept in expo-secure-store, one encrypted file per photo under <documents>/photos, the file name bound to the
// ciphertext as additional data so files cannot be swapped. Web has no secure key store, so photos live in memory for
// the session only (`persistent` is false and the screen says so). Photos go in and come out as base64 JPEG.

export const POSES = ['front', 'side', 'back'] as const;
export type Pose = (typeof POSES)[number];

const KEY = 'pb.photo_key';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const native = Platform.OS !== 'web';
/** False on web: photos are kept for this session only. */
export const persistent = native;

const memory = new Map<string, string>();

function fileName(date: string, pose: Pose): string {
  if (!DATE.test(date) || !POSES.includes(pose)) throw new Error('bad photo key');
  return `${date}_${pose}.bin`;
}

const folder = () => new Directory(Paths.document, 'photos');

let keyLoad: Promise<AESEncryptionKey> | null = null;
function vaultKey(): Promise<AESEncryptionKey> {
  keyLoad ??= (async () => {
    const stored = await SecureStore.getItemAsync(KEY);
    if (stored) return AESEncryptionKey.import(stored, 'base64');
    const key = await AESEncryptionKey.generate();
    await SecureStore.setItemAsync(KEY, await key.encoded('base64'));
    return key;
  })().catch((e: unknown) => {
    keyLoad = null;
    throw e;
  });
  return keyLoad;
}

/** Saves (or replaces) the photo for one pose on one day. */
export async function putPhoto(date: string, pose: Pose, jpegBase64: string): Promise<void> {
  const name = fileName(date, pose);
  if (!native) {
    memory.set(name, jpegBase64);
    return;
  }
  const sealed = await aesEncryptAsync(jpegBase64, await vaultKey(), { additionalData: btoa(name) });
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, name);
  if (!file.exists) file.create();
  file.write(await sealed.combined());
}

/** The photo as base64 JPEG, or null when there is none (or it cannot be decrypted). */
export async function getPhoto(date: string, pose: Pose): Promise<string | null> {
  const name = fileName(date, pose);
  if (!native) return memory.get(name) ?? null;
  const file = new File(folder(), name);
  if (!file.exists) return null;
  try {
    const sealed = AESSealedData.fromCombined(await file.bytes());
    return await aesDecryptAsync(sealed, await vaultKey(), { output: 'base64', additionalData: btoa(name) });
  } catch {
    return null;
  }
}

export async function deletePhoto(date: string, pose: Pose): Promise<void> {
  const name = fileName(date, pose);
  if (!native) {
    memory.delete(name);
    return;
  }
  const file = new File(folder(), name);
  if (file.exists) file.delete();
}

/** Days with at least one photo, oldest first. */
export async function photoDates(): Promise<string[]> {
  const names = native ? (folder().exists ? folder().list().map((f) => f.name) : []) : [...memory.keys()];
  const dates = names.map((n) => n.split('_')[0] ?? '').filter((d) => DATE.test(d));
  return [...new Set(dates)].sort();
}

/** Deletes every photo and the key (account switch, discard, delete everything: ADR 004, #251). */
export async function wipePhotos(): Promise<void> {
  memory.clear();
  if (!native) return;
  const dir = folder();
  if (dir.exists) dir.delete();
  keyLoad = null;
  await SecureStore.deleteItemAsync(KEY);
}
