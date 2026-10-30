import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { IMPORT_MAX_CHARS } from '@plate-and-bar/core';

export type PickResult = { kind: 'text'; text: string } | { kind: 'cancelled' } | { kind: 'too_large' } | { kind: 'unreadable' };

/**
 * Lets the user choose a CSV and reads it as text, capped at core's `IMPORT_MAX_CHARS` bytes. The size is checked before the file is read.
 * On native the picker's cached copy is deleted when it has been read (or failed). The text is returned, never logged.
 */
export async function pickCsv(): Promise<PickResult> {
  let uri: string | null = null;
  try {
    const r = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: Platform.OS !== 'web' });
    const asset = r.canceled ? undefined : r.assets[0];
    if (!asset) return { kind: 'cancelled' };
    uri = Platform.OS === 'web' ? null : asset.uri;
    const web = Platform.OS === 'web' ? asset.file : undefined;
    const file = uri ? new File(uri) : null;
    const size = asset.size ?? web?.size ?? file?.size ?? null;
    if (size === null || size > IMPORT_MAX_CHARS) return size === null ? { kind: 'unreadable' } : { kind: 'too_large' };
    const text = web ? await web.text() : file ? await file.text() : null;
    return text === null ? { kind: 'unreadable' } : { kind: 'text', text };
  } catch {
    return { kind: 'unreadable' };
  } finally {
    try {
      if (uri) new File(uri).delete();
    } catch {
      // a cache file left behind is cleaned by the OS
    }
  }
}
