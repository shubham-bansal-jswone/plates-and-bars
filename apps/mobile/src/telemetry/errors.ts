// Error tracking with the Sentry SDK (MIT) pointed at a self-hosted GlitchTip (#687). Off unless EXPO_PUBLIC_SENTRY_DSN is
// set: with no DSN the SDK is never initialised and nothing touches the network.
import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { errorRelease } from '../appVersion';
import { INSTALL_ID_KEY } from '../secure/tokens';
import { getInstallId, onInstallIdForgotten, setInstallId } from './installId';
import { scrubBreadcrumb, scrubEvent } from './scrub';

/** A random id created once per install and kept in the keystore. It is not tied to an account, email or device. */
async function loadInstallId(): Promise<string> {
  if (Platform.OS === 'web') return randomUUID(); // no keystore on web: one id per page load
  const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
  if (existing) return existing;
  const fresh = randomUUID();
  await SecureStore.setItemAsync(INSTALL_ID_KEY, fresh);
  return fresh;
}

let started = false;

/**
 * Starts error tracking at module load, with no user and no keystore read, so errors before the store is ready (module
 * load, database open, a hang) are still reported. The install id is attached later by `attachInstallId`. Runs the SDK's
 * init once, however often it is called (a provider remount). Returns false (and does nothing else) without a DSN.
 */
export function initErrorTracking(
  dsn: string | undefined = process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: string | undefined = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT,
): boolean {
  if (!dsn || !dsn.trim()) return false;
  if (started) return true;
  started = true;
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
    beforeSend: (event) => scrubEvent(event, getInstallId()),
  });
  onInstallIdForgotten(() => Sentry.setUser(null));
  return true;
}

/**
 * Reads (or makes) the install id and attaches it to later events. Only after the store is prepared: before a reinstall's
 * keystore clear the stored id would be a stale one. Does nothing when tracking is off. Never rejects.
 */
export async function attachInstallId(): Promise<void> {
  if (!started) return;
  try {
    const id = await loadInstallId();
    setInstallId(id);
    Sentry.setUser({ id });
  } catch {
    // events then carry no user id at all
  }
}

class KeystoreResetError extends Error {
  name = 'KeystoreResetError';
}
/** The first-launch keystore clear failed every attempt. Carries no id and no text: only the error name reaches the server. */
export function reportKeystoreResetFailed(): void {
  Sentry.captureException(new KeystoreResetError('keystore reset failed'));
}
