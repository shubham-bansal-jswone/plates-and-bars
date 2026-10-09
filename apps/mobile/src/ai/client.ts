import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { authedCall } from '../account/server';
import type { PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';
import { withSyncPaused } from '../sync/guard';
import type { TokenStore } from '../sync/tokens';

export type AiFeature = 'describe_meal' | 'ask_why' | 'weekly_summary';
export type AiStatus = Schemas['AiStatus'];
export type AiQuota = Schemas['AiQuota'];

export type AiFailure =
  /** The feature is switched off on the server (503 `feature_disabled`). */
  | { kind: 'disabled' }
  /** The daily quota is used up until `quota.resets_at`; nothing should be sent before then. */
  | { kind: 'quota'; quota: AiQuota | null }
  | { kind: 'rate_limited'; retryAfterSec: number }
  | { kind: 'offline' | 'unavailable' | 'signed_out' | 'invalid' };
export type AiResult<T> = { kind: 'ok'; data: T } | AiFailure;

export interface AiDeps {
  db: StoreDb & PullDb;
  api: ApiClient;
  tokens: TokenStore;
  timeoutMs?: number;
}

type Reply<T> = { data?: T; error?: unknown; response: Response };

/**
 * One AI call through the generated client: the account lock, a timeout, and one token refresh on 401 (`authedCall`).
 * Maps every outcome to a result the screens can word honestly. Request and response bodies are never logged or kept
 * here; the caller shows them and lets go.
 */
async function run<T>(d: AiDeps, call: (signal: AbortSignal) => Promise<Reply<T>>): Promise<AiResult<T>> {
  return withSyncPaused(async () => {
    if (!(await d.tokens.load())) return { kind: 'signed_out' };
    let error: unknown;
    const r = await authedCall<T>(d, async (signal) => {
      const x = await call(signal);
      error = x.error;
      return x;
    });
    if (r.kind === 'session_ended') return { kind: 'signed_out' };
    if (r.kind !== 'response') return { kind: r.kind };
    if (r.data !== undefined) return { kind: 'ok', data: r.data };
    const s = r.response.status;
    const body = (error ?? {}) as Partial<Schemas['Error']>;
    if (s === 401) return { kind: 'signed_out' };
    if (s === 400) return { kind: 'invalid' };
    if (s === 429 && body.code === 'quota_exceeded') return { kind: 'quota', quota: body.quota ?? null };
    if (s === 429) return { kind: 'rate_limited', retryAfterSec: Number(r.response.headers.get('Retry-After')) || 60 };
    if (s === 503 && body.code === 'feature_disabled') return { kind: 'disabled' };
    return { kind: 'unavailable' };
  });
}

/** `GET /ai/status`: which features are on and the daily quota. Carries no user data. */
export const getAiStatus = (d: AiDeps) => run<AiStatus>(d, (signal) => d.api.GET('/ai/status', { signal }));

/** `POST /ai/describe-meal`: sends only the text the user typed. */
export const describeMeal = (d: AiDeps, text: string) => run<Schemas['DescribeMealResponse']>(d, (signal) => d.api.POST('/ai/describe-meal', { body: { text }, signal }));

/** `POST /ai/ask-why`: sends only the card id and the typed question. */
export const askWhy = (d: AiDeps, cardId: string, question: string) => run<Schemas['AskWhyResponse']>(d, (signal) => d.api.POST('/ai/ask-why', { body: { card_id: cardId, question }, signal }));

/** `POST /ai/weekly-summary`: sends the weekly check-in facts built by `buildSummaryRequest`. */
export const weeklySummary = (d: AiDeps, body: Schemas['WeeklySummaryRequest']) => run<Schemas['WeeklySummaryResponse']>(d, (signal) => d.api.POST('/ai/weekly-summary', { body, signal }));
