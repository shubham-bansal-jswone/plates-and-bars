import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { ApiClient } from '@plate-and-bar/api';
import { deleteEverything, exportFromServer, type DeleteResult, type ServerExportResult } from '../account/server';
import { pendingCount } from '../db/outbox';
import { API_URL, makeApi, startEmailSignIn, verifyEmailCode, type StartResult, type VerifyResult } from './auth';
import { syncOnce, type SyncDb, type SyncResult } from './engine';
import { discardAll, signOut as guardedSignOut } from './guard';
import { getUserId } from './store';
import { secureTokens, type TokenStore } from './tokens';

/** How often a signed-in device syncs, besides on app start, on returning to the app and when the network is back. */
export const SYNC_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;

export interface SyncState {
  /** False when this build has no server address: the app is local-only and shows no sync UI. */
  configured: boolean;
  signedIn: boolean;
  /** This device's store belongs to an account (it was signed in before), whether or not a session exists now. */
  linked: boolean;
  /** Set by a finished deletion, above the remount it causes, so the next screen can say so once. */
  lastDeletion: { server: boolean } | null;
  clearLastDeletion(): void;
  /** Unsynced local changes (0 when everything is pushed). */
  pending: number;
  syncing: boolean;
  /** Last run's outcome; null before the first run. */
  last: SyncResult | null;
  /** Bumps when the local store was wiped, so the screens reload from the empty store. */
  epoch: number;
  /** Bumps after a sync stored pulled records; stores reload from SQLite when it changes (no remount). */
  dataVersion: number;
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
  const [lastDeletion, setLastDeletion] = useState<{ server: boolean } | null>(null);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [last, setLast] = useState<SyncResult | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const held = useRef(false);
  const holdUntil = useRef(0);
  const backoff = useRef(SYNC_INTERVAL_MS);

  const clearLastDeletion = useCallback(() => setLastDeletion(null), []);
  const refreshPending = useCallback(async () => setPending(await pendingCount(db)), [db]);

  const runSync = useCallback(async (force: boolean): Promise<SyncResult | null> => {
    if (!api || (!signedIn && !force)) return null;
    setSyncing(true);
    try {
      const r = await syncOnce({ db, api, tokens });
      setLast(r);
      if ((r.pulled ?? 0) > 0) setDataVersion((v) => v + 1);
      if (r.status === 'ok') backoff.current = SYNC_INTERVAL_MS;
      else if (r.status === 'rate_limited') holdUntil.current = Date.now() + (r.retryAfterSec ?? 60) * 1000;
      else if (r.status === 'unavailable' || r.status === 'rejected') {
        holdUntil.current = Date.now() + backoff.current;
        backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF_MS);
      } else if (r.status === 'signed_out') setSignedIn(false);
      return r;
    } finally {
      setSyncing(false);
      await refreshPending().catch(() => undefined);
    }
  }, [api, db, tokens, signedIn, refreshPending]);
  const syncNow = useCallback(() => runSync(false), [runSync]);

  // Load account state once, then keep the pending count fresh.
  useEffect(() => {
    let live = true;
    (async () => {
      const t = await tokens.load();
      if (!live) return;
      const user = await getUserId(db);
      setSignedIn(!!t && !!user);
      setLinked(!!user);
      await refreshPending();
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [db, tokens, refreshPending]);

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
    const app = AppState.addEventListener('change', (s) => s === 'active' && tick());
    const online = () => {
      holdUntil.current = 0;
      tick();
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', online);
    return () => {
      clearInterval(timer);
      app.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('online', online);
    };
  }, [configured, signedIn, syncNow, refreshPending]);

  const value = useMemo<SyncState>(
    () => ({
      configured,
      signedIn,
      linked,
      lastDeletion,
      clearLastDeletion,
      pending,
      syncing,
      last,
      epoch,
      dataVersion,
      holdSchedule: (hold) => void (held.current = hold),
      syncNow,
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
        setSignedIn(false);
        setLinked(false);
        setEpoch((e) => e + 1);
        await refreshPending();
      },
      exportFromServer: () => exportFromServer(db, api, tokens),
      deleteEverything: async (opts) => {
        const r = await deleteEverything({ db, api, tokens }, opts);
        if (r.kind === 'deleted') {
          setSignedIn(false);
          setLinked(false);
          setLastDeletion({ server: r.server });
          setEpoch((e) => e + 1);
          await refreshPending();
        } else if (r.kind === 'local_failed' || (r.kind === 'unconfirmed' && !(await tokens.load()))) setSignedIn(false);
        return r;
      },
    }),
    [configured, signedIn, linked, lastDeletion, clearLastDeletion, pending, syncing, last, epoch, dataVersion, syncNow, runSync, api, db, tokens, refreshPending],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
