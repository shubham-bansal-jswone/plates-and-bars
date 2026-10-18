import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/** Thrown when the user has turned camera access off. */
export class CameraDenied extends Error {}

/** Longest side and JPEG quality of a stored progress photo (prototype `compressPhoto`: 900 px, 0.72). */
export const PHOTO_MAX_PX = 900;
export const PHOTO_QUALITY = 0.72;

/** The size to resize to, or null when the photo is already small enough. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_PX): { width: number } | { height: number } | null {
  const scale = Math.min(1, max / Math.max(width, height));
  if (scale >= 1) return null;
  return width >= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) };
}

/** Takes or picks one photo and returns it as base64 JPEG, resized; null when the user cancels. */
export async function capturePhoto(source: 'camera' | 'library'): Promise<string | null> {
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new CameraDenied();
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  const picked = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return null;
  let saved: { uri: string; base64?: string | null } | null = null;
  try {
    const image = ImageManipulator.manipulate(asset.uri);
    const size = fitWithin(asset.width, asset.height);
    if (size) image.resize(size);
    // Re-encoding keeps only the pixels (upright: the decoder applies the EXIF orientation); the location is dropped.
    saved = await (await image.renderAsync()).saveAsync({ compress: PHOTO_QUALITY, format: SaveFormat.JPEG, base64: true });
    return saved.base64 ?? null;
  } finally {
    // The picker's copy (with EXIF) and the resized file are plaintext in the cache: only the vault may keep a photo.
    for (const uri of [asset.uri, saved?.uri]) discard(uri);
  }
}

/** Deletes a working copy, and only one inside this app's cache: never a photo in the user's own gallery. */
export function discard(uri: string | undefined): void {
  if (!uri || Platform.OS === 'web' || !uri.startsWith(Paths.cache.uri)) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // wipePhotos also clears these cache folders
  }
}
