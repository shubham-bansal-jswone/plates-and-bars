import * as ImagePicker from 'expo-image-picker';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { FRAME_COUNT, frameTimesMs } from '@plate-and-bar/core';
import { CameraDenied, discard } from '../photos/capture';
import type { AiFrame } from './client';
import { shrinkForAi } from './photo';

/** A form-check frame: at most 640 px a side (the prototype's `videoFrames`) and 350,000 bytes, which is 466,668 base64 characters (`AiFrame.data`). */
export const FRAME_MAX_PX = 640;
export const FRAME_MAX_BASE64 = 466_668;
/** JPEG quality of a frame (prototype 0.75), lowered in turn if a frame is over the limit. */
const FRAME_QUALITIES = [0.75, 0.6, 0.45] as const;
export const FRAMES_MIN = 2;
/** Most frames a form check takes (and cuts from a clip): core's `FRAME_COUNT`. */
export const FRAMES_MAX = FRAME_COUNT;
const frame = (asset: { uri: string; width: number; height: number }): Promise<AiFrame> => shrinkForAi(asset, { maxPx: FRAME_MAX_PX, maxBase64: FRAME_MAX_BASE64, qualities: FRAME_QUALITIES });

/** Thrown when frames could not be cut from the chosen video. */
export class VideoUnreadable extends Error {}

/**
 * Chooses a short video and cuts `FRAMES_MAX` frames from it on the device, one at a time, so only one full-size frame is in
 * memory. The video is never read into the app or sent: only the frames are, re-encoded as small JPEGs; the picker's copy of
 * the video and each cut are deleted from the cache. Null when the user cancels.
 */
export async function framesFromVideo(): Promise<AiFrame[] | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], videoMaxDuration: 60, quality: 1 });
  const video = picked.canceled ? null : picked.assets[0];
  if (!video) return null;
  try {
    const out: AiFrame[] = [];
    for (const time of frameTimesMs(video.duration, FRAMES_MAX)) {
      const cut = await getThumbnailAsync(video.uri, { time, quality: 1 });
      out.push(await frame(cut));
    }
    return out;
  } catch {
    throw new VideoUnreadable();
  } finally {
    discard(video.uri);
  }
}

/** Chooses 2 to 4 photos, in the order picked, as frames (the first four when more come back). Null when the user cancels. */
export async function framesFromPhotos(): Promise<AiFrame[] | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: FRAMES_MAX, orderedSelection: true, quality: 1, exif: false });
  if (picked.canceled || !picked.assets.length) return null;
  try {
    const out: AiFrame[] = [];
    for (const a of picked.assets.slice(0, FRAMES_MAX)) out.push(await frame(a));
    return out;
  } finally {
    // Every picked copy in the cache goes, whether or not a frame failed and including any past the fourth.
    for (const a of picked.assets) discard(a.uri);
  }
}

/** Takes one photo as a frame; null when the user cancels. */
export async function frameFromCamera(): Promise<AiFrame | null> {
  if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new CameraDenied();
  const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  const a = picked.canceled ? null : picked.assets[0];
  return a ? frame(a) : null;
}
