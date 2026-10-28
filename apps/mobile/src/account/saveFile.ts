import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type SaveResult = 'saved' | 'shared' | 'unavailable';

const PREFIX = 'plate-and-bar-';

/** App start skips files this young: a share target on Android may still be reading a file from the session before. */
export const RECENT_EXPORT_MS = 10 * 60 * 1000;

/** Native: deletes leftover export files, and the picker's copies of restore files, from the cache. Call at app start (with `minAgeMs`), at the start of an
 * export, and on sign-out, delete-everything and "Delete all reports" (no age limit, for privacy). No-op on web. */
export function clearOldExports(opts: { minAgeMs?: number; now?: number } = {}): void {
  if (Platform.OS === 'web') return;
  const now = opts.now ?? Date.now();
  try {
    for (const f of new Directory(Paths.cache).list()) {
      if (!(f instanceof File) || !f.name.startsWith(PREFIX)) continue;
      const changed = f.modificationTime;
      if (opts.minAgeMs && typeof changed === 'number' && now - changed < opts.minAgeMs) continue;
      f.delete();
    }
  } catch {
    // the cache is only a courtesy to clean
  }
  // expo-document-picker copies a picked file (a restore file: all the user's data) into this folder and is the only user of it.
  try {
    const picked = new Directory(Paths.cache, 'DocumentPicker');
    if (picked.exists) picked.delete();
  } catch {
    // as above
  }
}

/**
 * Web: downloads the text as a file. Native: writes it to the cache and opens the share sheet (the user picks where it
 * goes); the call returns when the sheet closes, so two files are shared one after the other. The cached copy is
 * deleted when sharing throws, and on iOS when the sheet closes. On Android the call can resolve before the receiving
 * app has read the file, so the copy stays until `clearOldExports` (next export, app start, sign-out, delete-everything, "Delete all reports").
 */
export async function saveTextFile(name: string, mimeType: string, text: string): Promise<SaveResult> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'saved';
  }
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(text);
  try {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  } catch (e) {
    removeQuietly(file);
    throw e;
  }
  if (Platform.OS === 'ios') removeQuietly(file);
  return 'shared';
}

function removeQuietly(file: File): void {
  try {
    file.delete();
  } catch {
    // clearOldExports sweeps it later
  }
}
