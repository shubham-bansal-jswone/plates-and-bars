import { Platform } from 'react-native';

/**
 * Registers /sw.js (apps/mobile/public/sw.js) on the production web build so the app starts offline (#718).
 * No-op on Android, iOS, the dev server and browsers without service workers. Never blocks or throws.
 * A new deploy needs no prompt: the worker builds the new cache in the background, the next load uses it.
 */
export function registerServiceWorker(): void {
  if (Platform.OS !== 'web' || process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch(() => {}); // offline start is an extra; the app works without it
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
