// Scrubs error events and breadcrumbs before they leave the device (#687, infra/OBSERVABILITY.md "Error tracking rules").
// Pure functions on plain objects, so tests can assert on the whole serialized event.
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

export const FILTERED = '[Filtered]';

/** Any key that could carry food, meal, weight, measurement, health, questionnaire answers, credentials or contact data. */
const SENSITIVE_KEY = /food|meal|weight|measure|health|answer|token|email|password|passwd|secret|authorization|cookie|profile|photo|labs?(?![a-z])/i;

/** Breadcrumb categories that are dropped outright: console output and network calls can echo submitted values. */
const DROPPED_CRUMBS = new Set(['console', 'xhr', 'fetch', 'http']);

const stripQuery = (url: string): string => url.split(/[?#]/)[0]!;

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > 8) return FILTERED;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? FILTERED : scrubValue(v, depth + 1);
    return out;
  }
  return value;
}

const scrubObject = <T>(value: T): T => scrubValue(value, 0) as T;

/** Keeps the breadcrumb only if it is allowed; navigation keeps the category and message but no route values. */
export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb | null {
  if (b.category && DROPPED_CRUMBS.has(b.category)) return null;
  const { data: _data, ...rest } = b;
  void _data;
  return b.category === 'navigation' ? rest : { ...rest, ...(b.data ? { data: scrubObject(b.data) } : {}) };
}

/** Returns the event with only an opaque install id as user data, no request details and no sensitive keys. */
export function scrubEvent<T extends ErrorEvent>(event: T, installId: string | null): T {
  const e = scrubObject(event) as T & Record<string, unknown>;
  // User: an opaque install id only (never email, username, IP or segment).
  e.user = installId ? { id: installId } : undefined;
  // Request: the URL without query or fragment; no body, cookies, headers or query string.
  if (event.request?.url) e.request = { url: stripQuery(event.request.url) };
  else delete e.request;
  delete e.server_name;
  if (e.breadcrumbs) {
    e.breadcrumbs = (event.breadcrumbs ?? []).map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  }
  // Stack frame local variables can hold anything.
  for (const ex of e.exception?.values ?? []) {
    for (const f of ex.stacktrace?.frames ?? []) delete (f as { vars?: unknown }).vars;
  }
  return e;
}
