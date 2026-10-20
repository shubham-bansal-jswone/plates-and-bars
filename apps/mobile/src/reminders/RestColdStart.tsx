import { useEffect } from 'react';
import { takeRestNotification } from './rest';

/**
 * Renders nothing. Once at app start, takes down any rest notification and its armed alarm left from before the process died:
 * the rest it refers to no longer exists in the app. AppState sends no change on a cold start, and the app may open on any tab,
 * so this sits at the root, not under the Workout tab. The echo is dropped: there is no rest for it to change.
 */
export function RestColdStart() {
  useEffect(() => void takeRestNotification(), []);
  return null;
}
