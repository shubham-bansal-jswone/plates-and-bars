// Error tracking with the Sentry SDK (MIT) pointed at a self-hosted GlitchTip (#687). Off unless EXPO_PUBLIC_SENTRY_DSN is
// set: with no DSN the SDK is never initialised and nothing touches the network.
import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { scrubBreadcrumb, scrubEvent } from './scrub';

const INSTALL_ID_KEY = 'pb.install_id';
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

/** Initialises error tracking. Returns false (and does nothing else) without a DSN. */
export function initErrorTracking(dsn: string | undefined = process.env.EXPO_PUBLIC_SENTRY_DSN): boolean {
  if (!dsn || !dsn.trim()) return false;
  Sentry.init({
    dsn: dsn.trim(),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    tracesSampleRate: 0,
    // The default breadcrumbs integration records console and network calls; the scrubber drops those too, as a second guard.
    integrations: (defaults) => defaults.filter((i) => i.name !== 'Breadcrumbs'),
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: (event) => scrubEvent(event, installId),
  });
  loadInstallId()
    .then((id) => {
      installId = id;
      Sentry.setUser({ id });
    })
    .catch(() => undefined); // events then carry no user id at all
  return true;
}
