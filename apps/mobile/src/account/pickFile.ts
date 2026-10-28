import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { MAX_RESTORE_BYTES, RestoreError } from './restoreLocal';

/** Web: the platform file input. Resolves null when the dialog is cancelled. */
function pickWeb(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      if (f.size > MAX_RESTORE_BYTES) return reject(new RestoreError('too_large'));
      f.text().then(resolve, reject);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * The text of the export file the user picks, or null on cancel. The size is checked before the file is read. On a phone the
 * picker copies the file to the cache; that copy is deleted as soon as it is read.
 */
export async function pickExportText(): Promise<string | null> {
  if (Platform.OS === 'web') return pickWeb();
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true, multiple: false });
  const asset = r.canceled ? null : r.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size ?? 0) > MAX_RESTORE_BYTES) throw new RestoreError('too_large');
    return await file.text();
  } finally {
    try {
      file.delete();
    } catch {
      // a cache file; the next export sweep or the OS clears it
    }
  }
}
