import { useEffect } from 'react';
import { createClient } from '@plate-and-bar/api';
import { useDb } from '../db/lockedDb';
import { API_URL } from '../sync/auth';
import { refreshContent } from './refresh';

export const CONTENT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Renders nothing. Refreshes the stored server copies in the background at launch and then once a day while the app
 * stays open (the app start picks which copy is used: `loadContent`, called from the database init). Not tied to sign-in or consent.
 */
export function ContentRefresher() {
  const db = useDb();
  useEffect(() => {
    if (!API_URL) return;
    const api = createClient(API_URL, () => null);
    let live = true;
    const run = () => { if (live) void refreshContent({ db, api }); };
    run();
    const t = setInterval(run, CONTENT_REFRESH_INTERVAL_MS);
    return () => { live = false; clearInterval(t); };
  }, [db]);
  return null;
}
