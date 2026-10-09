import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type SaveResult = 'saved' | 'shared' | 'unavailable';

const PREFIX = 'plate-and-bar-';

/** Native: deletes the files of earlier exports from the cache. Call once at the start of an export, so the files of the
 * current one stay until the next export (the share sheet may still be reading them). No-op on web. */
export function clearOldExports(): void {
  if (Platform.OS === 'web') return;
  try {
    for (const f of new Directory(Paths.cache).list()) if (f instanceof File && f.name.startsWith(PREFIX)) f.delete();
  } catch {
    // the cache is only a courtesy to clean
  }
}

/**
 * Web: downloads the text as a file. Native: writes it to the cache and opens the share sheet (the user picks where it
 * goes); the call returns when the sheet closes, so two files are shared one after the other. The cached copy stays
 * until the next export's `clearOldExports`.
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
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  return 'shared';
}
