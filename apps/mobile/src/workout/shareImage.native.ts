import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import type { SaveResult } from '../account/saveFile';
import type { ShareCardModel } from './shareModel';
import { CARD_H, CARD_W } from './shareModel';

/** Same prefix as the other exports, so `clearOldExports` sweeps it at app start, sign-out and delete-everything. */
const NAME = 'plate-and-bar-workout-summary.png';

/**
 * Native: captures the off-screen card to a 1080x1350 PNG in the cache and opens the OS share sheet. Nothing is uploaded; the
 * user picks the target. The cached copy is deleted when sharing throws, and on iOS when the sheet closes (on Android the
 * receiving app may still be reading it, so `clearOldExports` removes it later).
 */
export async function shareWorkoutImage(_model: ShareCardModel, card: RefObject<ComponentRef<typeof View> | null>): Promise<SaveResult> {
  if (!(await Sharing.isAvailableAsync()) || !card.current) return 'unavailable';
  const shot = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile', width: CARD_W * 3, height: CARD_H * 3 });
  const tmp = new File(shot);
  const file = new File(Paths.cache, NAME);
  try {
    if (file.exists) file.delete();
    tmp.copy(file);
  } finally {
    try { tmp.delete(); } catch { /* the cache is swept later */ }
  }
  try {
    await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: 'Share workout', UTI: 'public.png' });
  } catch (e) {
    removeQuietly(file);
    throw e;
  }
  if (Platform.OS === 'ios') removeQuietly(file);
  return 'shared';
}

function removeQuietly(file: File): void {
  try { file.delete(); } catch { /* swept later */ }
}
