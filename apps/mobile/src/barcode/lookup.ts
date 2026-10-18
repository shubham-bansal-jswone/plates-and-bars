import { offToUserFood, validateBarcode, type OffMapResult, type ScannerFormat } from '@plate-and-bar/core';
import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { REQUEST_TIMEOUT_MS, withTimeout } from '../sync/timeout';

export type OffProduct = Schemas['OffProduct'];

/** The mapped product: core's draft, flags and warnings, with the product for its credit link. */
export type Found = Omit<Extract<OffMapResult, { kind: 'ok' }>, 'kind'> & { product: OffProduct };

export type LookupResult =
  | ({ kind: 'found' } & Found)
  /** OFF has no such product, or none with nutrition values (404, or a 200 core maps to nothing). */
  | { kind: 'not_found' }
  /** No connection (the request threw). */
  | { kind: 'offline' }
  /** 503 `upstream_busy` (the server's shared limit to OFF): retry after `retryAfterSec`. */
  | { kind: 'busy'; retryAfterSec: number | null }
  /** 429: this device's address is over the per-minute limit. */
  | { kind: 'rate_limited'; retryAfterSec: number | null }
  /** 503 `upstream_unavailable`, a timeout, or any other failure. */
  | { kind: 'unavailable' }
  /** The code failed core's check (no request was made), or the server refused it (400). */
  | { kind: 'invalid' };

/** Seconds from a `Retry-After` header; null when absent or not a whole number of seconds (an HTTP date is not read). */
export function retryAfterSec(h: string | null): number | null {
  return h !== null && /^\d{1,6}$/.test(h.trim()) ? Number(h.trim()) : null;
}

/**
 * Looks a barcode up through the generated client (`GET /foods/barcode/{code}`, public: no token). The code is checked with
 * core's `validateBarcode` first, with the scanner's format hint; a code that fails never reaches the network. Never throws:
 * every failure is a result the screen has copy for.
 */
export async function lookupBarcode(api: ApiClient, raw: string, hint?: ScannerFormat, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<LookupResult> {
  const check = validateBarcode(raw, hint);
  if (!check.ok) return { kind: 'invalid' };
  let reply;
  try {
    const t = await withTimeout(timeoutMs, (signal) => api.GET('/foods/barcode/{code}', { params: { path: { code: check.code } }, signal }));
    if (t.timedOut) return { kind: 'unavailable' };
    reply = t.value;
  } catch (e) {
    // A JSON body that does not parse is a server fault; a thrown fetch (no connection, DNS, blocked) is offline.
    return { kind: e instanceof SyntaxError ? 'unavailable' : 'offline' };
  }
  const { response, data, error } = reply;
  if (response.status === 200 && data) {
    const mapped = offToUserFood(data);
    // The row is saved under the code that was looked up, whatever OFF stored.
    return mapped.kind === 'ok' ? { ...mapped, kind: 'found', draft: { ...mapped.draft, barcode: check.code }, product: data } : { kind: 'not_found' };
  }
  const after = retryAfterSec(response.headers.get('Retry-After'));
  if (response.status === 404) return { kind: 'not_found' };
  if (response.status === 400) return { kind: 'invalid' };
  if (response.status === 429) return { kind: 'rate_limited', retryAfterSec: after };
  if (response.status === 503) return (error as { code?: string } | undefined)?.code === 'upstream_busy' ? { kind: 'busy', retryAfterSec: after } : { kind: 'unavailable' };
  return { kind: 'unavailable' };
}
