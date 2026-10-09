import type { ApiClient } from '@plate-and-bar/api';
import { createClient } from '@plate-and-bar/api';
import type { StoreDb } from '../db/records';
import type { PullDb } from '../db/outbox';
import { acceptTokenPair, type SignInOutcome } from './guard';
import type { TokenStore } from './tokens';

/** Server root with the version path, e.g. https://host/api/v1. Unset means this build has no server: the app stays offline. */
export const API_URL: string | undefined = process.env.EXPO_PUBLIC_API_URL || undefined;

/** The typed client; the access token is read from `tokens` before every request. */
export function makeApi(baseUrl: string, tokens: TokenStore): ApiClient {
  return createClient(baseUrl, async () => (await tokens.load())?.access ?? null);
}

export type StartResult = { ok: true; resendAfterSec: number } | { ok: false; reason: 'invalid_email' | 'rate_limited' | 'unavailable'; retryAfterSec?: number };
export type VerifyResult = SignInOutcome | { kind: 'error'; reason: 'invalid_code' | 'rate_limited' | 'unavailable' | 'offline'; retryAfterSec?: number };

/** Asks the server to email a one-time code. Never logs the address. */
export async function startEmailSignIn(api: ApiClient, email: string): Promise<StartResult> {
  try {
    const { data, response } = await api.POST('/auth/email/start', { body: { email } });
    if (data) return { ok: true, resendAfterSec: data.resend_after_seconds };
    if (response.status === 400) return { ok: false, reason: 'invalid_email' };
    if (response.status === 429) return { ok: false, reason: 'rate_limited', retryAfterSec: Number(response.headers.get('Retry-After')) || 60 };
  } catch {
    // fall through: no connection
  }
  return { ok: false, reason: 'unavailable' };
}

/** Exchanges the emailed code, then applies the device-ownership guard before the tokens are kept. */
export async function verifyEmailCode(db: StoreDb & PullDb, api: ApiClient, tokens: TokenStore, email: string, code: string): Promise<VerifyResult> {
  try {
    const { data, response } = await api.POST('/auth/email/verify', { body: { email, code } });
    if (data) return await acceptTokenPair(db, tokens, data);
    if (response.status === 401 || response.status === 400) return { kind: 'error', reason: 'invalid_code' };
    if (response.status === 429) return { kind: 'error', reason: 'rate_limited', retryAfterSec: Number(response.headers.get('Retry-After')) || 60 };
    return { kind: 'error', reason: 'unavailable' };
  } catch {
    return { kind: 'error', reason: 'offline' };
  }
}
