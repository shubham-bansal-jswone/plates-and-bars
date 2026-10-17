// Scrubs error events and breadcrumbs before they leave the device (#687, infra/OBSERVABILITY.md "Error tracking rules").
// Fails closed: the outgoing event is built from an allowlist of fields, so a field the SDK adds later is dropped until it is
// listed here. Exception values and messages are never sent (they can echo food names or weights, for example a JSON.parse
// error quotes its input); the exception type and the stack are kept. Pure functions on plain objects.
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

export const FILTERED = '[Filtered]';

/** Any key that could carry food, meal, weight, measurement, health, questionnaire answers, credentials or contact data. Second guard behind the allowlists. */
const SENSITIVE_KEY = /food|meal|weight|measure|health|answer|token|email|password|passwd|secret|authorization|cookie|profile|photo/i;
// "lab" is matched on word edges and camelCase (labs, labResults, bloodLabs), not inside words such as "label".
const LAB_KEY = /(^|[^A-Za-z])[Ll]abs?($|[^a-z])|[a-z]Labs?($|[^a-z])/;
const isSensitiveKey = (k: string): boolean => SENSITIVE_KEY.test(k) || LAB_KEY.test(k);

/**
 * Contexts that describe the device and the app, never the user, with the keys each may carry. Keys outside the list are
 * dropped. `react_native_context` and `expo_*` have no fixed key set, so they pass through the key filter instead.
 */
const CONTEXT_KEYS: Record<string, readonly string[]> = {
  app: ['app_identifier', 'app_name', 'app_version', 'app_build', 'app_start_time', 'in_foreground', 'build_type', 'device_app_hash'],
  device: ['family', 'model', 'model_id', 'manufacturer', 'brand', 'arch', 'archs', 'simulator', 'memory_size', 'free_memory', 'usable_memory', 'low_memory', 'storage_size', 'free_storage', 'processor_count', 'screen_width_pixels', 'screen_height_pixels', 'screen_density', 'screen_dpi', 'orientation'],
  os: ['name', 'version', 'build', 'kernel_version', 'rooted'],
  runtime: ['name', 'version'],
  culture: ['locale', 'timezone', 'calendar', 'is_24_hour_format'],
  trace: ['trace_id', 'span_id', 'parent_span_id', 'op', 'status'],
};
const FREE_CONTEXT = /^(react_native_context|expo_.*)$/;

/** Top-level event fields that are sent. Everything else (message, logentry, extra, tags, request, transaction, fingerprint, spans, threads, server_name...) is dropped. */
const EVENT_ALLOW = ['event_id', 'timestamp', 'platform', 'level', 'release', 'dist', 'environment', 'sdk', 'type', 'debug_meta', 'modules'] as const;
const FRAME_ALLOW = ['filename', 'function', 'module', 'lineno', 'colno', 'abs_path', 'in_app', 'platform', 'package', 'instruction_addr', 'image_addr', 'symbol_addr'] as const;

const stripQuery = (url: string): string => url.split(/[?#]/)[0]!;
type Rec = Record<string, unknown>;
const pick = (from: Rec, keys: readonly string[]): Rec => Object.fromEntries(keys.filter((k) => from[k] !== undefined).map((k) => [k, from[k]]));

function filterKeys(value: unknown, depth: number): unknown {
  if (depth > 8) return FILTERED;
  if (Array.isArray(value)) return value.map((v) => filterKeys(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isSensitiveKey(k) ? FILTERED : filterKeys(v, depth + 1)]));
  }
  return value;
}

function scrubFrame(f: Rec): Rec {
  const out = pick(f, FRAME_ALLOW);
  for (const k of ['filename', 'abs_path'] as const) if (typeof out[k] === 'string') out[k] = stripQuery(out[k]);
  return out;
}

/** Breadcrumbs are kept only as "something of this category happened": no message and no data. Console and network crumbs are dropped. */
const DROPPED_CRUMBS = new Set(['console', 'xhr', 'fetch', 'http']);
export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb | null {
  if (b.category && DROPPED_CRUMBS.has(b.category)) return null;
  return pick(b as Rec, ['type', 'category', 'level', 'timestamp']) as Breadcrumb;
}

/** Returns a new event holding only allowlisted fields, with an opaque install id as the only user data. */
export function scrubEvent<T extends ErrorEvent>(event: T, installId: string | null): T {
  const e = event as unknown as Rec;
  const out = pick(e, EVENT_ALLOW);
  if (out.modules) out.modules = filterKeys(out.modules, 0);
  if (installId) out.user = { id: installId };
  const contexts = (e.contexts ?? {}) as Rec;
  out.contexts = {};
  for (const [name, ctx] of Object.entries(contexts)) {
    const keys = CONTEXT_KEYS[name];
    if (keys && ctx && typeof ctx === 'object') (out.contexts as Rec)[name] = filterKeys(pick(ctx as Rec, keys), 0);
    else if (FREE_CONTEXT.test(name)) (out.contexts as Rec)[name] = filterKeys(ctx, 0);
  }
  out.breadcrumbs = ((e.breadcrumbs ?? []) as Breadcrumb[]).map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  const values = ((e.exception as { values?: Rec[] } | undefined)?.values ?? []) as Rec[];
  if (values.length) {
    out.exception = {
      values: values.map((v) => {
        const frames = (v.stacktrace as { frames?: Rec[] } | undefined)?.frames;
        return {
          ...pick(v, ['type', 'module', 'thread_id']),
          ...(v.mechanism && typeof v.mechanism === 'object' ? { mechanism: pick(v.mechanism as Rec, ['type', 'handled', 'synthetic']) } : {}), // not description, data or meta: they can carry values
          value: '', // blanked: may quote a food name or a weight
          ...(frames ? { stacktrace: { frames: frames.map(scrubFrame) } } : {}),
        };
      }),
    };
  }
  return out as unknown as T;
}
