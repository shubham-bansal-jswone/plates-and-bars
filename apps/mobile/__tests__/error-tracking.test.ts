import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';
import { initErrorTracking } from '../src/telemetry/errors';
import { scrubBreadcrumb, scrubEvent } from '../src/telemetry/scrub';

const mockInit = jest.fn();
const mockSetUser = jest.fn();
jest.mock('@sentry/react-native', () => ({ init: (o: unknown) => mockInit(o), setUser: (u: unknown) => mockSetUser(u) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => 'install-1'), setItemAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'web-id' }));

// One probe: food text and a weight in every field the SDK can carry. None of them may appear in the scrubbed event.
const FOOD = 'paneer tikka';
const WEIGHT = '81.4 kg';
const LEAKS = [FOOD, 'tikka', WEIGHT, '81.4', 'knee pain', 'me@example.com', 'Bearer', 'r-tok', '1.2.3.4', 'pw-secret', 'LABVALUE', 'DEEPLEAK'];
const deep = (n: number, leaf: unknown): unknown => (n === 0 ? leaf : { next: deep(n - 1, leaf) });

const probe = {
  event_id: 'e1',
  timestamp: 1,
  platform: 'javascript',
  level: 'error',
  release: '1.0.0',
  environment: 'production',
  type: undefined,
  message: `Could not save ${FOOD} ${WEIGHT}`,
  logentry: { message: `Could not save %s ${WEIGHT}`, params: [FOOD] },
  user: { id: 'acct', email: 'me@example.com', username: FOOD, ip_address: '1.2.3.4', segment: WEIGHT },
  server_name: `phone of ${FOOD}`,
  transaction: `/log/${FOOD}`,
  transaction_info: { source: 'url' },
  fingerprint: ['{{ default }}', FOOD],
  spans: [{ description: FOOD }],
  threads: { values: [{ name: FOOD }] },
  request: { url: `https://x/sync?q=${FOOD}#${WEIGHT}`, query_string: `q=${FOOD}`, cookies: { a: 'r-tok' }, headers: { Authorization: 'Bearer abc' }, data: { food: FOOD, weight: WEIGHT } },
  extra: { kcal: 300, protein_g: 20, name: FOOD, query: FOOD, note: 'knee pain', bodyFat: 18, height_cm: 180, phone: '999', last: WEIGHT },
  tags: { search: FOOD, screen: 'Food', refreshToken: 'r-tok' },
  contexts: {
    app: { app_version: '1.0', note: FOOD },
    device: { model: 'Pixel', note: FOOD, free_text: WEIGHT },
    react_native_context: { js_engine: 'hermes', foodName: FOOD, measurements: WEIGHT, profileGoal: WEIGHT, weightKg: WEIGHT, mealName: FOOD, health: 'knee pain', answers: 'knee pain', token: 'r-tok', email: 'me@example.com', password: 'pw-secret', passwd: 'pw-secret', secret: 'pw-secret', authorization: 'Bearer', cookie: 'r-tok', photo: FOOD, labResults: 'LABVALUE', lab: 'LABVALUE', bloodLabs: 'LABVALUE', label: 'kept', nested: deep(10, 'DEEPLEAK') },
    os: { name: 'Android' },
    profile: { age: 30, goal: WEIGHT },
    state: { value: FOOD },
    custom: { food: FOOD },
  },
  modules: { weight: WEIGHT, react: '19' },
  breadcrumbs: [
    { category: 'console', message: `logged ${WEIGHT}` },
    { category: 'fetch', data: { url: `https://x/y?q=${FOOD}` } },
    { category: 'xhr', data: { url: 'https://x' } },
    { category: 'http', data: { url: 'https://x' } },
    { category: 'navigation', message: `Navigated to /log/${FOOD}`, data: { from: `/food/${FOOD}`, to: `/progress/${WEIGHT}` } },
    { type: 'user', category: 'ui.click', level: 'info', timestamp: 2, message: `${FOOD} ${WEIGHT}`, data: { foodId: 9, target: FOOD } },
  ],
  exception: {
    values: [
      {
        type: 'SyntaxError',
        value: `Unexpected token 'p', "${FOOD}"... is not valid JSON`,
        mechanism: { type: 'generic', handled: false, synthetic: false, description: FOOD, data: { food: FOOD }, meta: { weight: WEIGHT } },
        stacktrace: { frames: [{ function: 'parseRow', filename: `app:///index.bundle?food=${FOOD}`, lineno: 10, colno: 3, in_app: true, vars: { weight: WEIGHT, other: FOOD }, pre_context: [FOOD], context_line: FOOD, post_context: [WEIGHT] }] },
      },
    ],
  },
} as unknown as ErrorEvent;

describe('scrubEvent', () => {
  const out = scrubEvent(probe, 'install-1') as unknown as Record<string, any>;
  const json = JSON.stringify(out);

  it('contains no probe value anywhere in the serialised event', () => {
    for (const leaked of LEAKS) expect(json).not.toContain(leaked);
  });
  it('drops every free-text and request field', () => {
    for (const k of ['message', 'logentry', 'extra', 'tags', 'request', 'transaction', 'transaction_info', 'fingerprint', 'spans', 'threads', 'server_name']) expect(out).not.toHaveProperty(k);
  });
  it('keeps only the opaque install id as user data', () => {
    expect(out.user).toEqual({ id: 'install-1' });
    expect(scrubEvent(probe, null).user).toBeUndefined();
  });
  it('keeps the exception type, mechanism and stack, and blanks the value', () => {
    const ex = out.exception.values[0];
    expect(ex).toMatchObject({ type: 'SyntaxError', value: '', mechanism: { type: 'generic', handled: false, synthetic: false } });
    expect(ex.stacktrace.frames).toEqual([{ function: 'parseRow', filename: 'app:///index.bundle', lineno: 10, colno: 3, in_app: true }]);
  });
  it('allows only device and app contexts, and filters sensitive keys inside them', () => {
    expect(Object.keys(out.contexts).sort()).toEqual(['app', 'device', 'os', 'react_native_context']);
    expect(out.contexts.app).toEqual({ app_version: '1.0' }); // unlisted keys are dropped
    expect(out.contexts.device).toEqual({ model: 'Pixel' });
    expect(out.contexts.os).toEqual({ name: 'Android' });
    const d = out.contexts.react_native_context;
    expect(d.js_engine).toBe('hermes');
    for (const k of ['foodName', 'measurements', 'profileGoal', 'weightKg', 'mealName', 'health', 'answers', 'token', 'email', 'password', 'passwd', 'secret', 'authorization', 'cookie', 'photo', 'labResults', 'lab', 'bloodLabs']) expect(d[k]).toBe('[Filtered]');
    expect(d.label).toBe('kept');
    expect(JSON.stringify(d.nested)).toContain('[Filtered]'); // deeper than the depth limit
  });
  it('filters module names and keeps the allowlisted event fields', () => {
    expect(out.modules).toEqual({ weight: '[Filtered]', react: '19' });
    expect(out).toMatchObject({ event_id: 'e1', timestamp: 1, platform: 'javascript', level: 'error', release: '1.0.0', environment: 'production' });
  });
  it('drops console and network breadcrumbs and keeps the rest without message or data', () => {
    expect(out.breadcrumbs).toEqual([{ category: 'navigation' }, { type: 'user', category: 'ui.click', level: 'info', timestamp: 2 }]);
  });
});

describe('scrubBreadcrumb', () => {
  it.each(['console', 'xhr', 'fetch', 'http'])('drops %s', (category) => {
    expect(scrubBreadcrumb({ category } as Breadcrumb)).toBeNull();
  });
});

describe('initErrorTracking', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not initialise the SDK without a DSN', () => {
    expect(initErrorTracking(undefined)).toBe(false);
    expect(initErrorTracking('')).toBe(false);
    expect(initErrorTracking('   ')).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it('initialises with PII off, no screenshots, no tracing and the scrubbers when a DSN is set', async () => {
    expect(initErrorTracking('https://key@glitchtip.example/1')).toBe(true);
    const o = mockInit.mock.calls[0]![0];
    expect(o).toMatchObject({ dsn: 'https://key@glitchtip.example/1', sendDefaultPii: false, attachScreenshot: false, attachViewHierarchy: false, enableAutoPerformanceTracing: false, tracePropagationTargets: [] });
    // Any number here turns tracing on in the SDK (and adds sentry-trace and baggage headers to every request).
    expect(o.tracesSampleRate).toBeUndefined();
    expect(o.tracesSampler).toBeUndefined();
    expect(o.beforeSendTransaction({ type: 'transaction' })).toBeNull();
    expect(o.integrations([{ name: 'Breadcrumbs' }, { name: 'Other' }])).toEqual([{ name: 'Other' }]);
    expect(o.beforeBreadcrumb({ category: 'console' })).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSetUser).toHaveBeenCalledWith({ id: 'install-1' });
    expect(o.beforeSend({ message: FOOD, user: { email: 'a@b.c' } })).toEqual({ user: { id: 'install-1' }, contexts: {}, breadcrumbs: [] });
  });
});
