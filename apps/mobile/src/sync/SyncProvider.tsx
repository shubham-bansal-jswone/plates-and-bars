import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { ApiClient } from '@plate-and-bar/api';
import { deleteEverything, exportFromServer, wipePending as readWipePending, type DeleteResult, type ServerExportResult } from '../account/server';
import { RECENT_EXPORT_MS, clearOldExports } from '../account/saveFile';
import { AiProvider } from '../ai/AiProvider';
import { onStoreWrite } from '../db/lockedDb';
import { pendingCount } from '../db/outbox';
import { API_URL, makeApi, startEmailSignIn, verifyEmailCode, type StartResult, type VerifyResult } from './auth';
import { refreshSession, syncOnce, type SyncDb, type SyncResult } from './engine';
import { completePhotoWipe, discardAll, signOut as guardedSignOut, withSyncPaused } from './guard';
import { discardQuarantined, quarantineCount, retryQuarantined } from './quarantine';
import { isAccountFull } from './held';
import { getUserId } from './store';
import { secureTokens, type TokenStore } from './tokens';
import { allowOneAttempt, cancelAttempt, clearSignInUnavailable, onSignInUnavailable, signInUnavailable as readSignInUnavailable, takeAttempt } from './cookieHealth';
import { cookieMode } from './transport';
import { dropLegacyWebTokens, markSignOutPending, onRemoteSignOut, revokeCookie, signOutPending } from './webSession';

/** How often a signed-in device syncs, besides on app start, on returning to the app and when the network is back. */
export const SYNC_INTERVAL_MS = 30_000;
/** While sign-in is flagged unavailable (#744), one refresh is tried this often, in case the site was fixed. */
export const SIGN_IN_RECHECK_MS = 600_000;
const MAX_BACKOFF_MS = 300_000;
/**
 * After a failed refresh request the retry is sent this long after the failure, by its own timer (#809). The server's 60 s grace
 * window (ADR 003) is counted from the first request, which may have waited the whole `REFRESH_TIMEOUT_MS` (20 s) before failing:
 * 20 s + 20 s = 40 s leaves 20 s of margin. The 30 s interval tick plus its 30 s hold would land 30 to 60 s after the failure.
 */
export const REFRESH_RETRY_MS = 20_000;

export interface SyncState {
  /** False when this build has no server address: the app is local-only and shows no sync UI. */
  configured: boolean;
  signedIn: boolean;
  /** This device's store belongs to an account (it was signed in before), whether or not a session exists now. */
  linked: boolean;
  /** The server already deleted this account and only this device's wipe is left (kept across restarts): never offer to sign in to delete. */
  wipePending: boolean;
  /** Set by a finished deletion, above the remount it causes, so the next screen can say so once. */
  lastDeletion: { server: boolean; linked: boolean } | null;
  clearLastDeletion(): void;
  /** Unsynced local changes (0 when everything is pushed). */
  pending: number;
  /** Of `pending`, the records the server refused (400): set aside so the rest keeps syncing; retry or discard them. */
  quarantined: number;
  /** The server said the account is full: new entries stay on this device and are not backed up (edits and deletes still sync). Kept across restarts; clears when a push of new records succeeds. */
  accountFull: boolean;
  /** Web only: sign-in and session refresh cannot work from this site (ADR 006, #744). Nothing retries by itself; a reload tries again. */
  signInUnavailable: boolean;
  syncing: boolean;
  /** Last run's outcome; null before the first run. */
  last: SyncResult | null;
  /** Bumps when the local store was wiped, so the screens reload from the empty store. */
  epoch: number;
  /** Bumps after a sync stored pulled records; stores reload from SQLite when it changes (no remount). */
  dataVersion: number;
  /** Sends the set-aside records again with the next run (and runs it). */
  retryQuarantined(): Promise<void>;
  /** Stops sending the set-aside records; they stay on this device. */
  discardQuarantined(): Promise<void>;
  /** True while a confirm dialog is open: the 30 s tick skips its run. */
  holdSchedule(hold: boolean): void;
  syncNow(): Promise<SyncResult | null>;
  startSignIn(email: string): Promise<StartResult>;
  verifyCode(email: string, code: string): Promise<VerifyResult>;
  /** Returns the number of unsynced changes that blocked it, or 0 when signed out. */
  signOut(opts?: { discard?: boolean }): Promise<number>;
  /** "Discard and sign out" after a refused account switch: wipes the previous user's store. */
  discardAndSignOut(): Promise<void>;
  /** `GET /me/export` for the signed-in account (#27). */
  exportFromServer(): Promise<ServerExportResult>;
  /** Delete everything (#27): `DELETE /me` first when signed in, then the local store; never reports deletion without a 204. */
  deleteEverything(opts?: { deviceOnly?: boolean }): Promise<DeleteResult>;
}

export const SyncContext = createContext<SyncState | null>(null);


export function useSync(): SyncState {
  const v = useContext(SyncContext);
  if (!v) throw new Error('useSync needs a SyncProvider');
  return v;
}

/**
 * Owns the sync schedule. Nothing here blocks the UI: edits are already in SQLite, a run happens in the background, and
 * failures only change the badge. Without an account (or without a server address) nothing runs.
 */
export function SyncProvider({ db, children, tokens = secureTokens, api: apiOverride }: { db: SyncDb; children: ReactNode; tokens?: TokenStore; api?: ApiClient }) {
  const api = useMemo(() => apiOverride ?? (API_URL ? makeApi(API_URL, tokens) : null), [apiOverride, tokens]);
  const configured = api !== null;
  const [signedIn, setSignedIn] = useState(false);
  const [linked, setLinked] = useState(false);
  const [wipePending, setWipePending] = useState(false);
  const [lastDeletion, setLastDeletion] = useState<{ server: boolean; linked: boolean } | null>(null);
  const [pending, setPending] = useState(0);
  const [quarantined, setQuarantined] = useState(0);
  const [accountFull, setAccountFull] = useState(false);
  const [signInUnavailable, setSignInUnavailable] = useState(readSignInUnavailable);
  const [syncing, setSyncing] = useState(false);
  const [last, setLast] = useState<SyncResult | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const held = useRef(false);
  const holdUntil = useRef(0);
  const backoff = useRef(SYNC_INTERVAL_MS);
  const refreshFails = useRef(0); // refresh failures in a row (ambiguous ones): the fast retry is used for the first only
  const lastCounted = useRef<SyncResult | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef<(force: boolean) => Promise<SyncResult | null>>(async () => null);
  const clearRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const clearLastDeletion = useCallback(() => setLastDeletion(null), []);
  /** State changes after a delete attempt; shared by the screen's call and the finish-on-launch run. */
  const afterDelete = useCallback(
    async (r: DeleteResult): Promise<DeleteResult> => {
      if (r.kind === 'deleted') {
        setSignedIn(false);
        setLinked(false);
        setWipePending(false);
        setLastDeletion({ server: r.server, linked: r.linked });
        // Web: the account is gone, but the cookie is still in the browser; the revoke call only clears it.
        if (r.server && api && cookieMode()) {
          markSignOutPending();
          void revokeCookie(api);
        }
        setEpoch((e) => e + 1);
        setPending(await pendingCount(db));
      } else if (r.kind === 'local_failed') {
        setSignedIn(false);
        setWipePending(true);
      } else if (r.kind === 'unconfirmed' && !(await tokens.load())) setSignedIn(false);
      return r;
    },
    [db, tokens, api],
  );
  const refreshPending = useCallback(async () => {
    setPending(await pendingCount(db));
    setQuarantined(await quarantineCount(db));
    setAccountFull(await isAccountFull(db));
  }, [db]);

  const runSync = useCallback(async (force: boolean): Promise<SyncResult | null> => {
    if (!api || (!signedIn && !force)) return null;
    clearRetry(); // this run is the retry (or supersedes it): at most one is scheduled, and a failure below schedules the next
    setSyncing(true);
    try {
      const r = await syncOnce({ db, api, tokens });
      setLast(r);
      if ((r.pulled ?? 0) > 0) setDataVersion((v) => v + 1);
      if (r.status !== 'unavailable' && r.status !== 'rejected' && r.status !== 'offline') refreshFails.current = 0;
      if (r.status === 'ok') backoff.current = SYNC_INTERVAL_MS;
      else if (r.status === 'rate_limited') holdUntil.current = Date.now() + (r.retryAfterSec ?? 60) * 1000;
      else if (r.status === 'unavailable' || r.status === 'rejected' || r.status === 'offline') {
        // Offline backs off like a server problem (30 s, 1 min, 2 min, up to 5 min) so a long outage is not retried every 30 s.
        // A failed refresh request is the exception: the server may have rotated the token, and a retry must land inside its 60 s
        // grace window or it is read as reuse and ends the session, so retry after REFRESH_RETRY_MS and do not escalate (#762, #809).
        // Only the first failure in a row: after the second the window can no longer be counted on, so a phone that stays offline
        // falls back to the normal backoff instead of retrying every 20 s for hours.
        // Runs that joined one sync get the same result object: it counts once.
        if (r !== lastCounted.current) {
          lastCounted.current = r;
          refreshFails.current = r.viaRefresh ? refreshFails.current + 1 : 0;
        }
        if (r.viaRefresh && refreshFails.current < 2) {
          holdUntil.current = Date.now() + REFRESH_RETRY_MS;
          clearRetry(); // a joined run may have scheduled one already: keep a single tracked timer
          // An explicit one-shot timer, not the next interval tick (#809). The run is single-flight and takes the cross-tab lock in the engine.
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            if (!held.current) void runRef.current(false);
          }, REFRESH_RETRY_MS);
        }
        else {
          holdUntil.current = Date.now() + backoff.current;
          backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
        }
      } else if (r.status === 'signed_out') setSignedIn(false);
      return r;
    } finally {
      setSyncing(false);
      await refreshPending().catch(() => undefined);
    }
  }, [api, db, tokens, signedIn, refreshPending, clearRetry]);
  useEffect(() => {
    runRef.current = runSync;
  }, [runSync]);
  const syncNow = useCallback(() => runSync(false), [runSync]);

  // Load account state once, then keep the pending count fresh.
  useEffect(() => {
    let live = true;
    clearOldExports({ minAgeMs: RECENT_EXPORT_MS });
    (async () => {
      const t = await tokens.load();
      if (!live) return;
      const user = await getUserId(db);
      let session = !!t && !!user;
      if (cookieMode() && api) {
        // Web (ADR 006): the access token is in memory, so after a reload it comes back from the cookie. Only a 401 ends the
        // session; offline or 503 keeps it and the scheduler retries. While a sign-out is pending the cookie is not used.
        await dropLegacyWebTokens(api);
        if (signOutPending()) await revokeCookie(api);
        else if (!t && user) session = (await withSyncPaused(() => refreshSession({ db, api, tokens }))) !== 'ended';
        if (!live) return;
      }
      setSignedIn(session);
      setLinked(!!user);
      // An account deletion that did not finish clearing this device (app closed, wipe failed): finish it now.
      if (await readWipePending(db)) {
        setWipePending(true);
        if (live) await afterDelete(await deleteEverything({ db, api, tokens }));
      }
      await completePhotoWipe(db).catch(() => undefined); // still owed after a failure: retried at sign-in and on the photos screen
      await refreshPending();
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [db, tokens, api, refreshPending, afterDelete]);

  // A store write queues a change at once: show it without waiting for the next tick.
  useEffect(() => onStoreWrite(() => void refreshPending().catch(() => undefined)), [refreshPending]);

  // Schedule: now, every 30 s, when the app comes back to the foreground, and when the browser reports it is online.
  useEffect(() => {
    if (!configured || !signedIn) return;
    const tick = () => {
      if (held.current) return;
      if (Date.now() >= holdUntil.current) void syncNow();
      else void refreshPending().catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, SYNC_INTERVAL_MS);
    const app = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      // Back in the app (native has no `online` event): the user is here now, so start from the short wait again.
      holdUntil.current = 0;
      backoff.current = SYNC_INTERVAL_MS;
      refreshFails.current = 0;
      clearRetry();
      tick();
    });
    const online = () => {
      holdUntil.current = 0;
      backoff.current = SYNC_INTERVAL_MS; // the network is back: start again from the short wait
      refreshFails.current = 0;
      clearRetry();
      tick();
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', online);
    return () => {
      clearInterval(timer);
      clearRetry();
      app.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('online', online);
    };
  }, [configured, signedIn, syncNow, refreshPending, clearRetry]);

  // Web: another tab signed out (all tabs share one cookie). Drop this tab's access token and show signed out at once, instead
  // of keeping it until it expires (#762). Local data stays.
  useEffect(() => {
    if (!cookieMode()) return;
    return onRemoteSignOut(() => {
      void tokens.clear();
      setSignedIn(false);
    });
  }, [tokens]);

  // Web: cookie-mode calls fail while the API answers (#744): say so. The runs themselves send nothing meanwhile (the engine
  // ends them `sign_in_unavailable` before any request), and carry on by themselves once a cookie-mode call gets through.
  useEffect(() => onSignInUnavailable(setSignInUnavailable), []);
  // The browser coming back online forgets the verdict (the cause may have been the network); a slow timer lets one refresh
  // through in case the site was fixed while the page stayed open.
  useEffect(() => {
    if (!cookieMode()) return;
    const online = () => clearSignInUnavailable();
    if (typeof window !== 'undefined') window.addEventListener('online', online);
    const timer = setInterval(allowOneAttempt, SIGN_IN_RECHECK_MS);
    return () => {
      clearInterval(timer);
      if (typeof window !== 'undefined') window.removeEventListener('online', online);
    };
  }, []);

  // Web: a sign-out that did not reach the server is retried until it does (the cookie would otherwise sign the user back in),
  // unless sign-in is known to be unavailable from this site: the call cannot work and is not retried in a loop.
  useEffect(() => {
    if (!api || !cookieMode()) return;
    const timer = setInterval(() => signOutPending() && (!readSignInUnavailable() || takeAttempt()) && void revokeCookie(api), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [api]);

  const value = useMemo<SyncState>(
    () => ({
      configured,
      signedIn,
      linked,
      wipePending,
      lastDeletion,
      clearLastDeletion,
      pending,
      quarantined,
      accountFull,
      signInUnavailable,
      syncing,
      last,
      epoch,
      dataVersion,
      holdSchedule: (hold) => void (held.current = hold),
      retryQuarantined: async () => {
        await retryQuarantined(db);
        holdUntil.current = 0;
        await runSync(false);
        await refreshPending();
      },
      discardQuarantined: async () => {
        await discardQuarantined(db);
        await refreshPending();
      },
      // A user pressed Sync now: while sign-in is flagged unavailable this may try one refresh (the scheduler's runs may not).
      syncNow: async () => {
        allowOneAttempt();
        try {
          return await runSync(false);
        } finally {
          cancelAttempt();
        }
      },
      startSignIn: async (email) => (api ? startEmailSignIn(api, email) : { ok: false, reason: 'unavailable' }),
      verifyCode: async (email, code) => {
        if (!api) return { kind: 'error', reason: 'unavailable' };
        const r = await verifyEmailCode(db, api, tokens, email, code);
        if (r.kind === 'signed_in') {
          holdUntil.current = 0;
          if (r.wiped) setEpoch((e) => e + 1);
          setSignedIn(true);
          setLinked(true);
          // Pull right away (the user just asked to sign in): a returning user's records arrive before the screen closes.
          await runSync(true);
          await refreshPending();
        }
        return r;
      },
      signOut: async (opts) => {
        const blocked = await guardedSignOut(db, tokens, opts);
        if (blocked === 0) {
          if (api) void revokeCookie(api); // web: clears the cookie, or leaves the pending flag to retry; no-op on native
          clearOldExports();
          setSignedIn(false);
          if (opts?.discard) {
            setLinked(false);
            setEpoch((e) => e + 1);
          }
          await refreshPending();
        }
        return blocked;
      },
      discardAndSignOut: async () => {
        await discardAll(db, tokens);
        if (api) void revokeCookie(api);
        clearOldExports();
        setSignedIn(false);
        setLinked(false);
        setEpoch((e) => e + 1);
        await refreshPending();
      },
      exportFromServer: () => exportFromServer(db, api, tokens),
      deleteEverything: async (opts) => {
        const r = await deleteEverything({ db, api, tokens }, opts);
        clearOldExports();
        return afterDelete(r);
      },
    }),
    [configured, signedIn, linked, wipePending, afterDelete, lastDeletion, clearLastDeletion, pending, quarantined, accountFull, signInUnavailable, syncing, last, epoch, dataVersion, runSync, api, db, tokens, refreshPending],
  );
  // AI features sit inside the sync provider: they reuse its client and tokens (kept inside) and its signed-in state.
  return (
    <SyncContext.Provider value={value}>
      <AiProvider db={db} api={api} tokens={tokens} signedIn={signedIn} syncStamp={last?.status === 'ok' ? last : null}>
        {children}
      </AiProvider>
    </SyncContext.Provider>
  );
}
