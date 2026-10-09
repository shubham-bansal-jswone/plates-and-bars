import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ApiClient } from '@plate-and-bar/api';
import { AiProvider, KEY_AI_CONSENT } from '../src/ai/AiProvider';
import { AiSection } from '../src/ai/AiSection';
import { SummaryCard } from '../src/ai/SummaryCard';
import { buildSummaryRequest } from '../src/ai/summaryRequest';
import { FoodScreen } from '../src/screens/FoodScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryTokenStore } from '../src/sync/tokens';
import { KEY_USER } from '../src/sync/store';
import { memoryDb, withProfile } from './helpers';
import type { WeeklyCheckin } from '@plate-and-bar/core';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const QUOTA = { limit: 10, remaining: 7, resets_at: '2026-10-09T00:00:00Z' };
const status = (f: Partial<Record<'describe_meal' | 'ask_why' | 'weekly_summary', boolean>> = {}, quota = QUOTA) => ({
  features: { describe_meal: false, ask_why: false, weekly_summary: false, ...f },
  quota,
});
const res = (s: number, h: Record<string, string> = {}) => ({ status: s, headers: { get: (k: string) => h[k] ?? null } }) as unknown as Response;

/** A key/value store with the two statements the AI provider uses (the `settings` table). */
function kvDb(initial: Record<string, string> = {}) {
  const kv = new Map(Object.entries(initial));
  return {
    kv,
    getFirstAsync: async (_sql: string, key: string) => (kv.has(key) ? { value: kv.get(key) } : null),
    runAsync: async (sql: string, key: string, value?: string) => void (sql.startsWith('DELETE') ? kv.delete(key) : kv.set(key, value!)),
  };
}

function fakeApi(over: { get?: jest.Mock; post?: jest.Mock } = {}) {
  const GET: jest.Mock = over.get ?? jest.fn(async () => ({ data: status(), response: res(200) }));
  const POST: jest.Mock = over.post ?? jest.fn(async () => ({ error: { code: 'internal', message: 'x' }, response: res(500) }));
  return { api: { GET, POST } as unknown as ApiClient, GET, POST };
}
const tokens = async () => {
  const t = memoryTokenStore();
  await t.save({ access: 'a', refresh: 'r' });
  return t;
};
const optedIn = () => kvDb({ [KEY_USER]: 'u1', [KEY_AI_CONSENT]: 'u1' });

async function ai(kv: ReturnType<typeof kvDb>, api: ApiClient, ui: ReactNode, signedIn = true) {
  const t = await tokens();
  return render(
    <AiProvider db={kv as never} api={api} tokens={t} signedIn={signedIn} now={NOW}>
      {ui}
    </AiProvider>,
  );
}

function profile() {
  return buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
}
async function food(kv: ReturnType<typeof kvDb>, api: ApiClient) {
  const db = memoryDb();
  await saveProfile(db, profile());
  const t = await tokens();
  await render(
    <AiProvider db={kv as never} api={api} tokens={t} signedIn now={NOW}>
      {withProfile(db, <FoodScreen db={db} now={NOW} />)}
    </AiProvider>,
  );
  await screen.findByRole('header', { name: 'Food' });
  return db;
}
const logs = (db: ReturnType<typeof memoryDb>) => [...db.rows].filter(([k]) => k.startsWith('food_logs:')).map(([, v]) => JSON.parse(v));
const ROTI = { name: 'Roti', qty: '2 medium', kcal: 240, protein_g: 7, carbs_g: 46, fat_g: 3 };

describe('AI is off by default', () => {
  it('without consent sends nothing and shows no entry point, even if the server has everything on', async () => {
    const { api, GET, POST } = fakeApi({ get: jest.fn(async () => ({ data: status({ describe_meal: true, ask_why: true, weekly_summary: true }), response: res(200) })) });
    await food(kvDb({ [KEY_USER]: 'u1' }), api);
    expect(screen.queryByLabelText(/Describe your breakfast/)).toBeNull();
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  it('with consent but the server reporting every feature off, shows no entry point', async () => {
    const { api, GET } = fakeApi();
    await food(optedIn(), api);
    await waitFor(() => expect(GET).toHaveBeenCalledWith('/ai/status', expect.anything()));
    expect(screen.queryByLabelText(/Describe your breakfast/)).toBeNull();
  });

  it('consent given by another account does not count', async () => {
    const { api, GET } = fakeApi();
    await food(kvDb({ [KEY_USER]: 'u2', [KEY_AI_CONSENT]: 'u1' }), api);
    expect(GET).not.toHaveBeenCalled();
  });

  it('signed out: no toggle and no calls', async () => {
    const { api, GET } = fakeApi();
    await ai(optedIn(), api, <AiSection />, false);
    expect(screen.queryByLabelText('Use AI features')).toBeNull();
    expect(GET).not.toHaveBeenCalled();
  });
});

describe('consent toggle', () => {
  it('starts off, turning it on stores it and reads the status, turning it off forgets it', async () => {
    const kv = kvDb({ [KEY_USER]: 'u1' });
    const { api, GET } = fakeApi();
    await ai(kv, api, <AiSection />);
    const sw = await screen.findByLabelText('Use AI features');
    expect(sw.props.value).toBe(false);
    expect(screen.getByText(/never your name, email, photos, cycle or lab data/i)).toBeTruthy();
    expect(GET).not.toHaveBeenCalled();
    await fireEvent(sw, 'valueChange', true);
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(1));
    expect(kv.kv.get(KEY_AI_CONSENT)).toBe('u1');
    expect(await screen.findByText(/None of the AI features are switched on yet/)).toBeTruthy();
    await fireEvent(screen.getByLabelText('Use AI features'), 'valueChange', false);
    await waitFor(() => expect(kv.kv.has(KEY_AI_CONSENT)).toBe(false));
  });
});

describe('Describe a meal', () => {
  const on = () => fakeApi({ get: jest.fn(async () => ({ data: status({ describe_meal: true }), response: res(200) })) });
  const openSheet = async () => {
    await fireEvent.press(await screen.findByLabelText('Describe your breakfast in words, AI estimate'));
    await screen.findByLabelText('Describe your meal');
  };

  it('shows suggestions for review and logs nothing until the user adds, with their edits', async () => {
    const { api, GET, POST } = on();
    POST.mockResolvedValue({ data: { items: [ROTI], quota: QUOTA }, response: res(200) });
    const db = await food(optedIn(), api);
    await openSheet();
    await fireEvent.changeText(screen.getByLabelText('Describe your meal'), '2 rotis');
    await fireEvent.press(screen.getByLabelText('Estimate'));
    const kcal = await screen.findByLabelText('Roti calories (kcal)');
    expect(POST).toHaveBeenCalledWith('/ai/describe-meal', expect.objectContaining({ body: { text: '2 rotis' } }));
    expect(GET).toHaveBeenCalled();
    expect(logs(db)).toEqual([]);
    await fireEvent.changeText(kcal, '200');
    await fireEvent.press(screen.getByLabelText('Add 1 item to breakfast'));
    await waitFor(() => expect(logs(db)).toHaveLength(1));
    expect(logs(db)[0]).toMatchObject({ name: 'Roti (2 medium)', kcal: 200, protein_g: 7, meal: 'Breakfast', food_id: null });
  });

  it('removing a suggestion keeps it out of the log', async () => {
    const { api, POST } = on();
    POST.mockResolvedValue({ data: { items: [ROTI, { ...ROTI, name: 'Dal' }], quota: QUOTA }, response: res(200) });
    const db = await food(optedIn(), api);
    await openSheet();
    await fireEvent.changeText(screen.getByLabelText('Describe your meal'), 'roti and dal');
    await fireEvent.press(screen.getByLabelText('Estimate'));
    await fireEvent.press(await screen.findByLabelText('Remove Roti'));
    await fireEvent.press(screen.getByLabelText('Add 1 item to breakfast'));
    await waitFor(() => expect(logs(db)).toHaveLength(1));
    expect(logs(db)[0].name).toBe('Dal (2 medium)');
  });

  it('a suggestion that fails core validation blocks the whole add', async () => {
    const { api, POST } = on();
    POST.mockResolvedValue({ data: { items: [ROTI], quota: QUOTA }, response: res(200) });
    const db = await food(optedIn(), api);
    await openSheet();
    await fireEvent.changeText(screen.getByLabelText('Describe your meal'), '2 rotis');
    await fireEvent.press(screen.getByLabelText('Estimate'));
    await fireEvent.changeText(await screen.findByLabelText('Roti calories (kcal)'), '-5');
    await fireEvent.press(screen.getByLabelText('Add 1 item to breakfast'));
    expect(await screen.findByText(/Roti: Calories, macros and servings can’t be negative/)).toBeTruthy();
    expect(logs(db)).toEqual([]);
  });

  it('says so when no food was recognised', async () => {
    const { api, POST } = on();
    POST.mockResolvedValue({ data: { items: [], quota: QUOTA }, response: res(200) });
    await food(optedIn(), api);
    await openSheet();
    await fireEvent.changeText(screen.getByLabelText('Describe your meal'), 'zzz');
    await fireEvent.press(screen.getByLabelText('Estimate'));
    expect(await screen.findByText('Couldn’t read that meal. Try listing items with amounts.')).toBeTruthy();
  });

  it('quota exceeded: shows the reset time and the non-AI way, and stops offering the call', async () => {
    const { api, POST } = on();
    const q = { limit: 10, remaining: 0, resets_at: '2026-10-09T00:00:00Z' };
    POST.mockResolvedValue({ error: { code: 'quota_exceeded', message: 'x', quota: q }, response: res(429, { 'Retry-After': '3600' }) });
    await food(optedIn(), api);
    await openSheet();
    await fireEvent.changeText(screen.getByLabelText('Describe your meal'), '2 rotis');
    await fireEvent.press(screen.getByLabelText('Estimate'));
    expect(await screen.findByText(/You’ve used today’s AI answers\. They come back at .* The food list and Custom still work\./)).toBeTruthy();
    expect(POST).toHaveBeenCalledTimes(1);
  });

  it('offline: says so and the food list still works', async () => {
    const { api, POST } = on();
    POST.mockRejectedValue(new TypeError('Network request failed'));
    await food(optedIn(), api);
    await openSheet();
    await fireEvent.changeText(screen.getByLabelText('Describe your meal'), '2 rotis');
    await fireEvent.press(screen.getByLabelText('Estimate'));
    expect(await screen.findByText('No connection. The food list and Custom still work.')).toBeTruthy();
  });

  it('server error: asks to try again; feature switched off meanwhile: says it is off', async () => {
    const { api, POST } = on();
    POST.mockResolvedValueOnce({ error: { code: 'unavailable', message: 'x' }, response: res(503) });
    await food(optedIn(), api);
    await openSheet();
    await fireEvent.changeText(screen.getByLabelText('Describe your meal'), '2 rotis');
    await fireEvent.press(screen.getByLabelText('Estimate'));
    expect(await screen.findByText(/Couldn’t get an answer, try again\./)).toBeTruthy();
    POST.mockResolvedValueOnce({ error: { code: 'feature_disabled', message: 'x' }, response: res(503) });
    await fireEvent.press(screen.getByLabelText('Estimate'));
    expect(await screen.findByText(/AI features are switched off right now\./)).toBeTruthy();
  });
});

describe('Ask why', () => {
  it('sends only the card id and the question, and shows the answer with its card', async () => {
    const { api, POST } = fakeApi({ get: jest.fn(async () => ({ data: status({ ask_why: true }), response: res(200) })) });
    POST.mockResolvedValue({ data: { answer: 'Because protein protects muscle.', card_id: 'protein', quota: QUOTA }, response: res(200) });
    await ai(optedIn(), api, <AiSection />);
    await fireEvent.press(await screen.findByLabelText('Ask why about your targets'));
    await fireEvent.changeText(await screen.findByLabelText('Your question'), 'Why so much protein?');
    await fireEvent.press(screen.getByLabelText('Ask'));
    expect(await screen.findByText('Because protein protects muscle.')).toBeTruthy();
    expect(POST).toHaveBeenCalledWith('/ai/ask-why', expect.objectContaining({ body: { card_id: 'targets', question: 'Why so much protein?' } }));
    expect(screen.getByText('Based on the card: Why so much protein?')).toBeTruthy();
  });

  it('is hidden when the server has it off', async () => {
    const { api, GET } = fakeApi();
    await ai(optedIn(), api, <AiSection />);
    await waitFor(() => expect(GET).toHaveBeenCalled());
    expect(screen.queryByLabelText('Ask why about your targets')).toBeNull();
  });
});

describe('Weekly summary', () => {
  const week = (over: Partial<WeeklyCheckin> = {}) =>
    ({ key: 'ci:2026-10-05', sessions: 3, plannedN: 4, logged: 5, avgK: 2000, avgP: 120, pDays: 4, w1: 81.5, w0: 82, weeklyChange: null, improved: [{ n: 'Goblet Squat', pct: 5 }, { n: 'My secret lift', pct: 3 }], stalled: ['Another custom one'], cardioMin: 0, steps: null, sleep: null, sleepShort: false, burn: { ready: false, needDays: 1, needW: 1 }, slopePerWeek: null, formula: 2300, suggestion: null, ...over }) as WeeklyCheckin;

  it('builds only contract fields and never sends a custom exercise name', () => {
    const r = buildSummaryRequest(week(), { kcal: 2000, protein_g: 150 }, 'lose')!;
    expect(r.improved).toEqual([{ exercise: 'Goblet Squat', pct: 5 }, { exercise: 'custom exercise', pct: 3 }]);
    expect(r.stalled).toEqual(['custom exercise']);
    expect(r).toMatchObject({ planned_sessions: 4, target_kcal: 2000, target_protein_g: 150, goal: 'lose', burn_kcal: null });
    expect(JSON.stringify(r)).not.toMatch(/secret|ci:2026/);
    expect(buildSummaryRequest(week({ plannedN: 0 }), { kcal: 1, protein_g: 1 }, null)).toBeNull();
  });

  it('is hidden unless on and opted in, writes on tap, and shows quota errors', async () => {
    const p = profile();
    const off = fakeApi();
    const view = await ai(optedIn(), off.api, <SummaryCard checkin={week()} profile={p} />);
    await waitFor(() => expect(off.GET).toHaveBeenCalled());
    expect(screen.queryByText('Your week in words')).toBeNull();
    view.unmount();

    const { api, POST } = fakeApi({ get: jest.fn(async () => ({ data: status({ weekly_summary: true }), response: res(200) })) });
    POST.mockResolvedValueOnce({ data: { text: 'A solid week.', quota: QUOTA }, response: res(200) });
    await ai(optedIn(), api, <SummaryCard checkin={week()} profile={p} />);
    await fireEvent.press(await screen.findByLabelText('Write my week in words'));
    expect(await screen.findByText('A solid week.')).toBeTruthy();
    expect(POST).toHaveBeenCalledWith('/ai/weekly-summary', expect.objectContaining({ body: expect.objectContaining({ sessions: 3, goal: 'lose' }) }));
    POST.mockResolvedValueOnce({ error: { code: 'rate_limited', message: 'x' }, response: res(429, { 'Retry-After': '30' }) });
    await fireEvent.press(screen.getByLabelText('Write it again'));
    expect(await screen.findByText('Too many requests right now. Wait a minute and try again.')).toBeTruthy();
  });

  it('consent off: the card is hidden and nothing is sent', async () => {
    const { api, GET, POST } = fakeApi();
    await ai(kvDb({ [KEY_USER]: 'u1' }), api, <SummaryCard checkin={week()} profile={profile()} />);
    expect(screen.queryByText('Your week in words')).toBeNull();
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });
});
