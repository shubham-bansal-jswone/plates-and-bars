import * as ImagePicker from 'expo-image-picker';
import { CameraDenied, discard } from '../photos/capture';

export { CameraDenied };

/** A picked photo. Only the address is kept: the pixels stay with the picker, then the engine, and are never copied here. */
export type LabelPhoto = { uri: string; width: number; height: number };

/**
 * Takes or picks one still photo of a label (never video). Returns null when the user cancels. The picker may leave a copy in
 * the app cache: the caller hands the uri to `releasePhoto` when the scan is over.
 */
export async function takeLabelPhoto(source: 'camera' | 'library'): Promise<LabelPhoto | null> {
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new CameraDenied();
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  const picked = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const a = picked.canceled ? null : picked.assets[0];
  return a ? { uri: a.uri, width: a.width, height: a.height } : null;
}

/** Drops the working copy of a photo: deletes it if it is in this app's cache (never a gallery photo) and frees a web blob address. */
export function releasePhoto(uri: string | undefined): void {
  if (!uri) return;
  if (uri.startsWith('blob:') && typeof URL !== 'undefined') {
    try {
      URL.revokeObjectURL(uri);
    } catch {
      // already revoked
    }
    return;
  }
  discard(uri);
}
