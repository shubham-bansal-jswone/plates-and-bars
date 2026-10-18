import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { INSTALL_ID_KEY } from '../secure/tokens';

// The install id's in-memory copy and its removal. Kept apart from errors.ts so that "Delete everything" does not pull in
// the Sentry SDK; errors.ts registers what has to happen to Sentry when the id is forgotten.
let current: string | null = null;
const listeners = new Set<() => void>();

export const getInstallId = (): string | null => current;
export const setInstallId = (id: string | null): void => void (current = id);
/** Called when the id is forgotten (error tracking drops its user then). */
export function onInstallIdForgotten(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * "Delete everything": the in-memory id and the error-tracking user go first (so no later event carries the old id),
 * then the keystore copy is deleted. Rejects if the keystore delete fails; the caller decides whether that matters.
 */
export async function forgetInstallId(): Promise<void> {
  current = null;
  listeners.forEach((l) => l());
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(INSTALL_ID_KEY);
}
