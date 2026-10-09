import type { ApiClient, Schemas } from '@plate-and-bar/api';
import type { PullDb } from '../db/outbox';
import type { StoreDb } from '../db/records';
import { refreshSession, syncIdle } from '../sync/engine';
import { withSyncPaused } from '../sync/guard';
import { getUserId } from '../sync/store';
import { REQUEST_TIMEOUT_MS, withTimeout } from '../sync/timeout';
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

const sameTokens = (a: { access: string; refresh: string } | null, b: { access: string; refresh: string } | null) => !!a && !!b && a.access === b.access && a.refresh === b.refresh;

/**
 * One AI call through the generated client, with a timeout. The request itself runs without the account lock, so a slow
 * answer never holds up sync, sign-in, sign-out or export. Only on a 401 is the lock taken, for the token refresh alone
 * (skipped when another refresh already changed the stored tokens since this request was sent); the retry is outside
 * it. The answer is dropped when the signed-in user changed while the request was out. `refresh: false` (the status
 * read) never takes the lock: a 401 there just means no answer. Bodies are never logged or kept here.
 */
async function run<T>(d: AiDeps, call: (signal: AbortSignal) => Promise<Reply<T>>, opts: { refresh?: boolean } = {}): Promise<AiResult<T>> {
  const owner = await getUserId(d.db);
  for (let attempt = 0; attempt < 2; attempt++) {
    const used = await d.tokens.load();
    if (!used) return { kind: 'signed_out' };
    let reply: Reply<T>;
    try {
      const t = await withTimeout(d.timeoutMs ?? REQUEST_TIMEOUT_MS, call);
      if (t.timedOut) return { kind: 'unavailable' };
      reply = t.value;
    } catch (e) {
      return { kind: e instanceof SyntaxError ? 'unavailable' : 'offline' };
    }
    // Signed out (tokens cleared) or another user signed in while the request was out: the answer is not shown.
    if ((await getUserId(d.db)) !== owner || !(await d.tokens.load())) return { kind: 'signed_out' };
    if (reply.response.status === 401 && attempt === 0 && opts.refresh !== false) {
      // A sync run that got the same 401 refreshes on its own: let it finish and save its rotated pair first (#287), then
      // the check below sees the changed tokens and this call just retries. What prevents the clash is the ordering: the
      // lock is requested right after syncIdle() resolves, with no other await in between, so a new run cannot slip in and
      // start its own refresh. The token-pair compare below only catches a refresh that finished earlier.
      await syncIdle();
      const out = await withSyncPaused(async () => {
        const now = await d.tokens.load();
        if (!now) return 'ended' as const;
        if (!sameTokens(used, now)) return 'ok' as const;
        return refreshSession(d);
      });
      if (out === 'ended') return { kind: 'signed_out' };
      if (out !== 'ok') return { kind: out };
      continue;
    }
    return answer(reply);
  }
  return { kind: 'unavailable' };
}

function answer<T>(r: Reply<T>): AiResult<T> {
  if (r.data !== undefined) return { kind: 'ok', data: r.data };
  const s = r.response.status;
  const body = (r.error ?? {}) as Partial<Schemas['Error']>;
  if (s === 401) return { kind: 'signed_out' };
  if (s === 400) return { kind: 'invalid' };
  if (s === 429 && body.code === 'quota_exceeded') return { kind: 'quota', quota: body.quota ?? null };
  if (s === 429) return { kind: 'rate_limited', retryAfterSec: Number(r.response.headers.get('Retry-After')) || 60 };
  if (s === 503 && body.code === 'feature_disabled') return { kind: 'disabled' };
  return { kind: 'unavailable' };
}

/**
 * `GET /ai/status`: which features are on and the daily quota. Carries no user data. A 401 refreshes the tokens only when
 * `refresh` is true (the first read, while the status is still unknown); the later foreground reads never take the lock.
 */
export const getAiStatus = (d: AiDeps, refresh = false) => run<AiStatus>(d, (signal) => d.api.GET('/ai/status', { signal }), { refresh });

/** `POST /ai/describe-meal`: sends only the text the user typed. */
export const describeMeal = (d: AiDeps, text: string) => run<Schemas['DescribeMealResponse']>(d, (signal) => d.api.POST('/ai/describe-meal', { body: { text }, signal }));

/** `POST /ai/ask-why`: sends only the card id and the typed question. */
export const askWhy = (d: AiDeps, cardId: string, question: string) => run<Schemas['AskWhyResponse']>(d, (signal) => d.api.POST('/ai/ask-why', { body: { card_id: cardId, question }, signal }));

/** `POST /ai/weekly-summary`: sends the weekly check-in facts built by `buildSummaryRequest`. */
export const weeklySummary = (d: AiDeps, body: Schemas['WeeklySummaryRequest']) => run<Schemas['WeeklySummaryResponse']>(d, (signal) => d.api.POST('/ai/weekly-summary', { body, signal }));
