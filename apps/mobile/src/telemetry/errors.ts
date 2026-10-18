// Error tracking with the Sentry SDK (MIT) pointed at a self-hosted GlitchTip (#687). Off unless EXPO_PUBLIC_SENTRY_DSN is
// set: with no DSN the SDK is never initialised and nothing touches the network.
import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { errorRelease } from '../appVersion';
import { INSTALL_ID_KEY } from '../secure/tokens';
import { scrubBreadcrumb, scrubEvent } from './scrub';

let installId: string | null = null;

/** A random id created once per install and kept in the keystore. It is not tied to an account, email or device. */
async function loadInstallId(): Promise<string> {
  if (Platform.OS === 'web') return randomUUID(); // no keystore on web: one id per page load
  const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
  if (existing) return existing;
  const fresh = randomUUID();
  await SecureStore.setItemAsync(INSTALL_ID_KEY, fresh);
  return fresh;
}

/**
 * "Delete everything": the in-memory id and the Sentry user go first (so no later event carries the old id), then the
 * keystore copy is deleted. Rejects if the keystore delete fails; the caller decides whether that matters.
 */
export async function forgetInstallId(): Promise<void> {
  installId = null;
  Sentry.setUser(null);
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(INSTALL_ID_KEY);
}

/** Initialises error tracking. Returns false (and does nothing else) without a DSN. */
export function initErrorTracking(
  dsn: string | undefined = process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: string | undefined = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
  /** `withoutInstallId`: do not read the keystore this launch (its id may be a stale one from before a reinstall). */
  opts: { withoutInstallId?: boolean } = {},
): boolean {
  if (!dsn || !dsn.trim()) return false;
  Sentry.init({
    dsn: dsn.trim(),
    environment: environment?.trim() || 'development',
    release: errorRelease(),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    // Tracing is off for real: with no tracesSampleRate or tracesSampler the SDK adds no tracing integrations, and no
    // sentry-trace or baggage header is added to outgoing requests (the empty list matches no URL).
    enableAutoPerformanceTracing: false,
    tracePropagationTargets: [],
    beforeSendTransaction: () => null,
    // The default breadcrumbs integration records console and network calls; the scrubber drops those too, as a second guard.
    integrations: (defaults) => defaults.filter((i) => i.name !== 'Breadcrumbs'),
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: (event) => scrubEvent(event, installId),
  });
  if (opts.withoutInstallId) return true;
  loadInstallId()
    .then((id) => {
      installId = id;
      Sentry.setUser({ id });
    })
    .catch(() => undefined); // events then carry no user id at all
  return true;
}

class KeystoreResetError extends Error {
  name = 'KeystoreResetError';
}
/** The first-launch keystore clear failed every attempt. Carries no id and no text: only the error name reaches the server. */
export function reportKeystoreResetFailed(): void {
  Sentry.captureException(new KeystoreResetError('keystore reset failed'));
}
