import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { CameraDenied, discard, fitWithin } from '../photos/capture';
import type { AiImage } from './client';

/** Longest side of a photo sent to an AI call (prototype `shrinkImage`: 1,600 px; the contract allows 4,096). */
export const AI_PHOTO_MAX_PX = 1600;
/** JPEG quality tried in turn until the base64 fits the contract's `AiImage.data` `maxLength` (prototype: 0.85). */
const QUALITIES = [0.85, 0.7, 0.5] as const;
/** `AiImage.data` `maxLength`: 1,200,000 decoded bytes as base64. */
export const AI_PHOTO_MAX_BASE64 = 1_600_000;

/** Thrown when no quality brings the photo under the limit. */
export class PhotoTooBig extends Error {}

/**
 * Takes or picks one photo for an AI call and returns it as a JPEG of at most 1,600 px, base64, or null when the user
 * cancels. Re-encoding keeps only the pixels, so the location, time and device in the EXIF are gone before anything is
 * sent. The result lives in memory only: the picker's copy and the resized file in the cache are deleted, and the photo is
 * never added to the progress photos.
 */
export async function pickPhotoForAi(source: 'camera' | 'library'): Promise<AiImage | null> {
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new CameraDenied();
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  const picked = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return null;
  return shrinkForAi(asset);
}

/** Re-encodes one picked asset as an in-memory JPEG; deletes the working copies in the app cache. */
export async function shrinkForAi(
  asset: { uri: string; width: number; height: number },
  { maxPx = AI_PHOTO_MAX_PX, maxBase64 = AI_PHOTO_MAX_BASE64, qualities = QUALITIES }: { maxPx?: number; maxBase64?: number; qualities?: readonly number[] } = {},
): Promise<AiImage> {
  const used: string[] = [asset.uri];
  try {
    const image = ImageManipulator.manipulate(asset.uri);
    const size = fitWithin(asset.width, asset.height, maxPx);
    if (size) image.resize(size);
    const rendered = await image.renderAsync();
    for (const compress of qualities) {
      const saved = await rendered.saveAsync({ compress, format: SaveFormat.JPEG, base64: true });
      used.push(saved.uri);
      if (saved.base64 && saved.base64.length <= maxBase64) return { media_type: 'image/jpeg', data: saved.base64 };
    }
    throw new PhotoTooBig();
  } finally {
    for (const uri of used) discard(uri);
  }
}
