import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';
import { initErrorTracking } from '../src/telemetry/errors';
import { scrubBreadcrumb, scrubEvent } from '../src/telemetry/scrub';

const mockInit = jest.fn();
const mockSetUser = jest.fn();
jest.mock('@sentry/react-native', () => ({ init: (o: unknown) => mockInit(o), setUser: (u: unknown) => mockSetUser(u) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => 'install-1'), setItemAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'web-id' }));


const worst = {
  type: undefined,
  message: 'failed',
  user: { id: 'acct-1', email: 'me@example.com', username: 'me', ip_address: '1.2.3.4' },
  server_name: 'phone',
  request: {
    url: 'https://api.example.com/sync?email=me@example.com&weight=81#x',
    query_string: 'email=me@example.com',
    cookies: { a: 'b' },
    headers: { Authorization: 'Bearer abc' },
    data: { meals: [{ food: 'dal', kcal: 300 }] },
  },
  extra: { bodyWeightKg: 81.2, mealName: 'paneer', health_answers: { injury: 'knee' }, lastError: 'boom', measurements: [1] },
  contexts: { profile: { age: 30 }, app: { app_version: '1.0' } },
  tags: { refreshToken: 'r-tok', screen: 'Food' },
  breadcrumbs: [
    { category: 'console', message: 'logged 81 kg' },
    { category: 'fetch', data: { url: 'https://x/y?q=1' } },
    { category: 'navigation', data: { from: '/food/123', to: '/progress/81' } },
    { category: 'ui.click', message: 'Save', data: { foodId: 9, target: 'button' } },
  ],
  exception: { values: [{ type: 'Error', value: 'x', stacktrace: { frames: [{ function: 'f', vars: { weight: 81, other: 'z' } }] } }] },
} as unknown as ErrorEvent;

describe('scrubEvent', () => {
  const out = scrubEvent(worst, 'install-1');
  const json = JSON.stringify(out);

  it('keeps only the opaque install id as user data', () => {
    expect(out.user).toEqual({ id: 'install-1' });
    expect(scrubEvent(worst, null).user).toBeUndefined();
  });
  it('removes request bodies, cookies, headers and the query string', () => {
    expect(out.request).toEqual({ url: 'https://api.example.com/sync' });
    expect(out.server_name).toBeUndefined();
  });
  it('filters values under sensitive keys and keeps the rest', () => {
    for (const leaked of ['81', 'paneer', 'knee', 'r-tok', 'me@example.com', 'Bearer', 'dal', '1.2.3.4']) expect(json).not.toContain(leaked);
    expect(out.extra).toMatchObject({ bodyWeightKg: '[Filtered]', mealName: '[Filtered]', health_answers: '[Filtered]', measurements: '[Filtered]', lastError: 'boom' });
    expect(out.tags).toEqual({ refreshToken: '[Filtered]', screen: 'Food' });
    expect(out.contexts).toMatchObject({ profile: '[Filtered]', app: { app_version: '1.0' } });
  });
  it('drops console and network breadcrumbs and route values', () => {
    expect(out.breadcrumbs).toEqual([{ category: 'navigation' }, { category: 'ui.click', message: 'Save', data: { foodId: '[Filtered]', target: 'button' } }]);
  });
  it('drops stack frame variables', () => {
    expect(out.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({ function: 'f' });
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

  it('initialises with PII off, no screenshots and the scrubbers when a DSN is set', async () => {
    expect(initErrorTracking('https://key@glitchtip.example/1')).toBe(true);
    const o = mockInit.mock.calls[0]![0];
    expect(o).toMatchObject({ dsn: 'https://key@glitchtip.example/1', sendDefaultPii: false, attachScreenshot: false, attachViewHierarchy: false, tracesSampleRate: 0 });
    expect(o.integrations([{ name: 'Breadcrumbs' }, { name: 'Other' }])).toEqual([{ name: 'Other' }]);
    expect(o.beforeBreadcrumb({ category: 'console' })).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSetUser).toHaveBeenCalledWith({ id: 'install-1' });
    expect(o.beforeSend({ user: { email: 'a@b.c' } })).toMatchObject({ user: { id: 'install-1' } });
  });
});
