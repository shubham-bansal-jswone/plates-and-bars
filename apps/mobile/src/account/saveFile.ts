import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type SaveResult = 'saved' | 'shared' | 'unavailable';

/**
 * Web: downloads the text as a file. Native: writes it to the cache, opens the share sheet (the user picks where it
 * goes), then deletes the cache copy so health data does not linger there.
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
  try {
    file.create({ overwrite: true });
    file.write(text);
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
    return 'shared';
  } finally {
    try {
      file.delete();
    } catch {
      // already gone
    }
  }
}
