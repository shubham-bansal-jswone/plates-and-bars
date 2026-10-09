import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { ApiClient, Schemas } from '@plate-and-bar/api';
import type { PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';
import { getKv, getUserId, setKv } from '../sync/store';
import type { TokenStore } from '../sync/tokens';
import { askWhy, describeMeal, getAiStatus, weeklySummary, type AiDeps, type AiFeature, type AiQuota, type AiResult, type AiStatus } from './client';

/** Device-only. Holds the id of the user who opted in, so another account on this device starts off, and a wipe (`sync.%`) clears it. */
export const KEY_AI_CONSENT = 'sync.ai_consent';

export interface AiApi {
  /** This build has a server and the user is signed in: the consent toggle can show. */
  canConsent: boolean;
  consent: boolean;
  setConsent(on: boolean): Promise<void>;
  /** The entry point may show: server says on, the user opted in, signed in. */
  available(f: AiFeature): boolean;
  /** Server-reported daily quota, when known. */
  quota: AiQuota | null;
  /** True while the known quota is used up and has not reset yet. */
  quotaUsed(): boolean;
  describeMeal(text: string): Promise<AiResult<Schemas['DescribeMealResponse']>>;
  askWhy(cardId: string, question: string): Promise<AiResult<Schemas['AskWhyResponse']>>;
  weeklySummary(body: Schemas['WeeklySummaryRequest']): Promise<AiResult<Schemas['WeeklySummaryResponse']>>;
}

const OFF: AiApi = {
  canConsent: false,
  consent: false,
  setConsent: async () => undefined,
  available: () => false,
  quota: null,
  quotaUsed: () => false,
  describeMeal: async () => ({ kind: 'disabled' }),
  askWhy: async () => ({ kind: 'disabled' }),
  weeklySummary: async () => ({ kind: 'disabled' }),
};

const AiContext = createContext<AiApi>(OFF);
/** Without a provider (tests, a build with no server) every AI feature is off. */
export const useAi = (): AiApi => useContext(AiContext);

interface Props {
  db: StoreDb & PullDb;
  api: ApiClient | null;
  tokens: TokenStore;
  signedIn: boolean;
  /** Clock, injectable for tests. */
  now?: () => Date;
  children: ReactNode;
}

/**
 * AI is off until the user turns it on (`consent`) and the server says a feature is on (`GET /ai/status`). With consent
 * off nothing is sent at all, not even the status read. Nothing the user types or gets back is stored: the sheets hold it
 * in their own state. A failed status read keeps the last known answer, so a dropped connection does not hide a feature.
 */
export function AiProvider({ db, api, tokens, signedIn, now = () => new Date(), children }: Props) {
  const [consent, setConsentState] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const consentRef = useRef(false);
  const statusRef = useRef<AiStatus | null>(null);
  const keep = useCallback((next: AiStatus | null | ((s: AiStatus | null) => AiStatus | null)) => {
    statusRef.current = typeof next === 'function' ? next(statusRef.current) : next;
    setStatus(statusRef.current);
  }, []);
  const live = api !== null && signedIn;

  const apply = useCallback((on: boolean) => {
    consentRef.current = on;
    setConsentState(on);
    if (!on) keep(null);
  }, [keep]);

  // Consent counts only for the user who gave it.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [stored, user] = await Promise.all([getKv(db, KEY_AI_CONSENT), getUserId(db)]);
      if (alive) apply(live && stored !== null && stored === user);
    })().catch(() => alive && apply(false));
    return () => {
      alive = false;
    };
  }, [db, live, apply]);

  const refresh = useCallback(async () => {
    if (!api || !consentRef.current) return;
    const r = await getAiStatus({ db, api, tokens });
    if (r.kind === 'ok' && consentRef.current) keep(r.data);
  }, [api, db, tokens, keep]);

  useEffect(() => {
    if (!consent || !live) return;
    void refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => sub.remove();
  }, [consent, live, refresh]);

  const setConsent = useCallback(
    async (on: boolean) => {
      if (on) {
        const user = await getUserId(db);
        if (!live || !user) return;
        await setKv(db, KEY_AI_CONSENT, user);
      } else {
        await db.runAsync('DELETE FROM settings WHERE key = ?', KEY_AI_CONSENT);
      }
      apply(on);
    },
    [db, live, apply],
  );

  const value = useMemo<AiApi>(() => {
    const available = (f: AiFeature) => live && consent && status?.features[f] === true;
    const usedUp = (s: AiStatus | null) => !!s && s.quota.remaining <= 0 && now().getTime() < new Date(s.quota.resets_at).getTime();
    const quotaUsed = () => usedUp(statusRef.current);
    const guard = async <T extends { quota: AiQuota }>(f: AiFeature, call: (d: AiDeps) => Promise<AiResult<T>>): Promise<AiResult<T>> => {
      // Consent off, switched off or no server: nothing is sent.
      if (!api || !live || !consentRef.current) return { kind: 'disabled' };
      // The known quota is used up: no request until it resets.
      if (usedUp(statusRef.current)) return { kind: 'quota', quota: statusRef.current!.quota };
      const r = await call({ db, api, tokens });
      if (r.kind === 'ok') {
        const q = r.data.quota;
        keep((s) => (s ? { ...s, quota: q } : s));
      } else if (r.kind === 'quota' && r.quota) {
        const q = r.quota;
        keep((s) => (s ? { ...s, quota: q } : s));
      } else if (r.kind === 'disabled') {
        keep((s) => (s ? { ...s, features: { ...s.features, [f]: false } } : s));
        void refresh();
      }
      return r;
    };
    return {
      canConsent: live,
      consent: live && consent,
      setConsent,
      available,
      quota: status?.quota ?? null,
      quotaUsed,
      describeMeal: (text) => guard('describe_meal', (d) => describeMeal(d, text)),
      askWhy: (cardId, question) => guard('ask_why', (d) => askWhy(d, cardId, question)),
      weeklySummary: (body) => guard('weekly_summary', (d) => weeklySummary(d, body)),
    };
  }, [live, consent, status, setConsent, api, db, tokens, refresh, now, keep]);

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}
