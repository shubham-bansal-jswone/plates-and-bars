import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ApiClient } from '@plate-and-bar/api';
import { AiProvider, KEY_AI_CONSENT, useAi } from '../src/ai/AiProvider';
import { AiSection } from '../src/ai/AiSection';
import { SummaryCard } from '../src/ai/SummaryCard';
import { buildSummaryRequest } from '../src/ai/summaryRequest';
import { FoodScreen } from '../src/screens/FoodScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryTokenStore } from '../src/sync/tokens';
import { KEY_USER } from '../src/sync/store';
import { withSyncPaused } from '../src/sync/guard';
import { Pressable, StyleSheet, Text } from 'react-native';
import { WhyLink, WhySheet } from '../src/why/WhyLink';
import { memoryDb, withProfile } from './helpers';
import type { WeeklyCheckin } from '@plate-and-bar/core';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const blank = require('../../../packages/api/test-vectors/blank-text.json') as { must_fail: string[]; must_pass: string[] };
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

const SUMMARY_KEYS = ['avg_kcal', 'avg_protein_g', 'burn_kcal', 'goal', 'improved', 'logged_days', 'planned_sessions', 'prev_weight_avg_kg', 'protein_days', 'sessions', 'stalled', 'target_kcal', 'target_protein_g', 'weight_avg_kg'];

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

  it.each(blank.must_fail.map((t) => [JSON.stringify(t), t]))('never sends blank text %s or says to shorten it', async (_n, t) => {
    const { api, POST } = on();
    await food(optedIn(), api);
    await openSheet();
    await fireEvent.changeText(screen.getByLabelText('Describe your meal'), t);
    await fireEvent.press(screen.getByLabelText('Estimate'));
    expect(POST).not.toHaveBeenCalled();
    expect(screen.queryByText(/Shorten it/)).toBeNull();
  });

  it('shows suggestions for review and logs nothing until the user adds, with their edits', async () => {
    const { api, GET, POST } = on();
    POST.mockResolvedValue({ data: { items: [ROTI], quota: QUOTA }, response: res(200) });
    const db = await food(optedIn(), api);
    await openSheet();
    await fireEvent.changeText(screen.getByLabelText('Describe your meal'), '2 rotis');
    await fireEvent.press(screen.getByLabelText('Estimate'));
    const kcal = await screen.findByLabelText('Item 1 Roti calories (kcal)');
    expect(POST.mock.calls[0]).toEqual(['/ai/describe-meal', { body: { text: '2 rotis' }, signal: expect.anything() }]);
    expect(GET).toHaveBeenCalled();
    expect(logs(db)).toEqual([]);
    await fireEvent.changeText(kcal, '200');
    await fireEvent.press(screen.getByLabelText('Add 1 item to breakfast'));
    await waitFor(() => expect(logs(db)).toHaveLength(1));
    expect(logs(db)[0]).toMatchObject({ name: 'Roti (2 medium)', kcal: 200, protein_g: 7, meal: 'Breakfast', food_id: null });
  });

  describe('from the add sheet (#874)', () => {
    const openAdd = async (meal = 'breakfast') => fireEvent.press(await screen.findByLabelText(`+ Add to ${meal}`));
    const count = (n: unknown, type: string): number => {
      if (Array.isArray(n)) return n.reduce((t: number, x) => t + count(x, type), 0);
      if (!n || typeof n !== 'object') return 0;
      const o = n as { type?: string; children?: unknown };
      return (o.type === type ? 1 : 0) + count(o.children, type);
    };
    const modals = () => ({ length: count(screen.toJSON(), 'Modal') });

    it('has a Describe it tab that runs the same Describe flow in the same sheet and logs to that meal and the viewed day', async () => {
      const { api, POST } = on();
      POST.mockResolvedValue({ data: { items: [ROTI], quota: QUOTA }, response: res(200) });
      const db = await food(optedIn(), api);
      await fireEvent.press(await screen.findByRole('button', { name: 'Previous day' }));
      await openAdd('lunch');
      const before = modals().length;
      expect(before).toBe(1);
      await fireEvent.press(await screen.findByRole('tab', { name: 'Describe it' }));
      expect(screen.queryByLabelText('Search foods')).toBeNull();
      // One sheet, no second Modal presented (the iOS limitation): the count does not change.
      expect(modals()).toHaveLength(before);
      await fireEvent.changeText(await screen.findByLabelText('Describe your meal'), '2 rotis');
      await fireEvent.press(screen.getByLabelText('Estimate'));
      await fireEvent.press(await screen.findByLabelText('Add 1 item to lunch'));
      await waitFor(() => expect(logs(db)).toHaveLength(1));
      expect(logs(db)[0]).toMatchObject({ name: 'Roti (2 medium)', meal: 'Lunch', date: '2026-10-07' });
      expect(screen.queryByLabelText('+ Add to lunch')).toBeTruthy();
      expect(screen.queryByLabelText('Describe your meal')).toBeNull();
    });

    it('keeps the tab and shows the switched-off message when the server turns Describe off while on it', async () => {
      // The status read after the failure says the feature is off, so the gate closes while the tab is selected.
      const get = jest.fn().mockResolvedValueOnce({ data: status({ describe_meal: true }), response: res(200) }).mockResolvedValue({ data: status(), response: res(200) });
      const { api, POST, GET } = fakeApi({ get });
      POST.mockResolvedValue({ error: { code: 'feature_disabled', message: 'x' }, response: res(503) });
      await food(optedIn(), api);
      await openAdd();
      await fireEvent.press(await screen.findByRole('tab', { name: 'Describe it' }));
      await fireEvent.changeText(await screen.findByLabelText('Describe your meal'), '2 rotis');
      await fireEvent.press(screen.getByLabelText('Estimate'));
      expect(await screen.findByText(/AI features are switched off right now\./)).toBeTruthy();
      await waitFor(() => expect(GET.mock.calls.length).toBeGreaterThan(1));
      expect(screen.getByRole('tab', { name: 'Describe it' })).toBeTruthy();
      expect(screen.getByLabelText('Describe your meal')).toBeTruthy();
    });

    it('keeps the text and the estimate across tab switches and sends one request while one is pending', async () => {
      const { api, POST } = on();
      let done!: (v: unknown) => void;
      POST.mockReturnValue(new Promise((r) => (done = r)));
      await food(optedIn(), api);
      await openAdd();
      await fireEvent.press(await screen.findByRole('tab', { name: 'Describe it' }));
      await fireEvent.changeText(await screen.findByLabelText('Describe your meal'), '2 rotis');
      await fireEvent.press(screen.getByLabelText('Estimate'));
      await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
      await fireEvent.press(screen.getByRole('tab', { name: 'Food list' }));
      expect(screen.queryByLabelText('Describe your meal')).toBeNull();
      await fireEvent.press(screen.getByRole('tab', { name: 'Describe it' }));
      expect(screen.getByLabelText('Describe your meal').props.value).toBe('2 rotis');
      await fireEvent.press(screen.getByLabelText('Estimate'));
      expect(POST).toHaveBeenCalledTimes(1);
      await act(async () => done({ data: { items: [ROTI], quota: QUOTA }, response: res(200) }));
      expect(await screen.findByLabelText('Item 1 Roti calories (kcal)')).toBeTruthy();
      await fireEvent.press(screen.getByRole('tab', { name: 'Custom' }));
      await fireEvent.press(screen.getByRole('tab', { name: 'Describe it' }));
      expect(screen.getByLabelText('Item 1 Roti calories (kcal)').props.value).toBe('240');
      expect(POST).toHaveBeenCalledTimes(1);
    });

    it('hides the kept Describe body, but not from the tree, while another tab is shown', async () => {
      const { api } = on();
      await food(optedIn(), api);
      await openAdd();
      await fireEvent.press(await screen.findByRole('tab', { name: 'Describe it' }));
      expect(screen.getByLabelText('Describe your meal')).toBeVisible();
      await fireEvent.press(screen.getByRole('tab', { name: 'Food list' }));
      const kept = screen.getByLabelText('Describe your meal', { includeHiddenElements: true });
      expect(kept).not.toBeVisible();
      // Also on its own: not shown (display none) even for a viewer that ignores the accessibility-hiding props.
      let n = kept.parent;
      let none = false;
      while (n && !none) {
        none = StyleSheet.flatten(n.props.style)?.display === 'none';
        n = n.parent;
      }
      expect(none).toBe(true);
    });

    it('shows the quota message in the tab when the quota is used up', async () => {
      const { api, POST } = fakeApi({ get: jest.fn(async () => ({ data: status({ describe_meal: true }, { ...QUOTA, remaining: 0 }), response: res(200) })) });
      await food(optedIn(), api);
      await openAdd();
      await fireEvent.press(await screen.findByRole('tab', { name: 'Describe it' }));
      expect(screen.queryByLabelText('Estimate')).toBeNull();
      expect(POST).not.toHaveBeenCalled();
    });

    it('the tablist holds only tabs, and the no-match hint points at Describe', async () => {
      const { api } = on();
      await food(optedIn(), api);
      await openAdd();
      let list = screen.getByRole('tab', { name: 'Food list' }).parent;
      while (list && list.props.accessibilityRole !== 'tablist') list = list.parent;
      expect(list).toBeTruthy();
      expect(within(list!).getAllByRole('tab', { hidden: true })).toHaveLength(4);
      expect(within(list!).queryAllByRole('button', { hidden: true })).toHaveLength(0);
      await fireEvent.changeText(screen.getByLabelText('Search foods'), 'zzzz');
      expect(screen.getByText('No match. Use Custom to enter it yourself, or Describe to have AI estimate it.')).toBeTruthy();
    });

    it('with the feature off, the sheet has no tab and the hint does not mention Describe', async () => {
      const { api, GET } = fakeApi();
      await food(optedIn(), api);
      await waitFor(() => expect(GET).toHaveBeenCalledWith('/ai/status', expect.anything()));
      await openAdd();
      expect(screen.queryByRole('tab', { name: 'Describe it' })).toBeNull();
      await fireEvent.changeText(screen.getByLabelText('Search foods'), 'zzzz');
      expect(screen.getByText('No match. Use Custom to enter it yourself.')).toBeTruthy();
    });

    it('without consent, the sheet has no tab', async () => {
      const { api } = on();
      await food(kvDb({ [KEY_USER]: 'u1' }), api);
      await openAdd();
      expect(screen.queryByRole('tab', { name: 'Describe it' })).toBeNull();
    });

    it('signed out, the sheet has no tab and nothing is sent', async () => {
      const { api, GET, POST } = on();
      const db = memoryDb();
      await saveProfile(db, profile());
      const t = await tokens();
      await render(
        <AiProvider db={optedIn() as never} api={api} tokens={t} signedIn={false} now={NOW}>
          {withProfile(db, <FoodScreen db={db} now={NOW} />)}
        </AiProvider>,
      );
      await screen.findByRole('header', { name: 'Food' });
      await openAdd();
      expect(screen.queryByRole('tab', { name: 'Describe it' })).toBeNull();
      expect(GET).not.toHaveBeenCalled();
      expect(POST).not.toHaveBeenCalled();
    });
  });

  it('removing a suggestion keeps it out of the log', async () => {
    const { api, POST } = on();
    POST.mockResolvedValue({ data: { items: [ROTI, { ...ROTI, name: 'Dal' }], quota: QUOTA }, response: res(200) });
    const db = await food(optedIn(), api);
    await openSheet();
    await fireEvent.changeText(screen.getByLabelText('Describe your meal'), 'roti and dal');
    await fireEvent.press(screen.getByLabelText('Estimate'));
    await fireEvent.press(await screen.findByLabelText('Remove Item 1 Roti'));
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
    await fireEvent.changeText(await screen.findByLabelText('Item 1 Roti calories (kcal)'), '-5');
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
  it.each(blank.must_fail.map((t) => [JSON.stringify(t), t]))('never sends a blank question %s or says to shorten it', async (_n, t) => {
    const { api, POST } = fakeApi({ get: jest.fn(async () => ({ data: status({ ask_why: true }), response: res(200) })) });
    await ai(optedIn(), api, <AiSection />);
    await fireEvent.press(await screen.findByLabelText('Ask why about your targets'));
    await fireEvent.changeText(await screen.findByLabelText('Your question'), t);
    await fireEvent.press(screen.getByLabelText('Ask'));
    expect(POST).not.toHaveBeenCalled();
    expect(screen.queryByText(/Shorten it/)).toBeNull();
  });

  it('sends only the card id and the question, and shows the answer with its card', async () => {
    const { api, POST } = fakeApi({ get: jest.fn(async () => ({ data: status({ ask_why: true }), response: res(200) })) });
    POST.mockResolvedValue({ data: { answer: 'Because protein protects muscle.', card_id: 'protein', quota: QUOTA }, response: res(200) });
    await ai(optedIn(), api, <AiSection />);
    await fireEvent.press(await screen.findByLabelText('Ask why about your targets'));
    await fireEvent.changeText(await screen.findByLabelText('Your question'), 'Why so much protein?');
    await fireEvent.press(screen.getByLabelText('Ask'));
    expect(await screen.findByText('Because protein protects muscle.')).toBeTruthy();
    expect(POST.mock.calls[0]).toEqual(['/ai/ask-why', { body: { card_id: 'targets', question: 'Why so much protein?' }, signal: expect.anything() }]);
    expect(screen.getByText('Based on the card: Why so much protein?')).toBeTruthy();
  });

  it('shows its label as visible text that stays once the user types', async () => {
    const { api } = fakeApi({ get: jest.fn(async () => ({ data: status({ ask_why: true }), response: res(200) })) });
    await ai(optedIn(), api, <AiSection />);
    await fireEvent.press(await screen.findByLabelText('Ask why about your targets'));
    expect(await screen.findByText('Your question', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('Your question')).toBeNull(); // hidden from screen readers: the field speaks the label
    await fireEvent.changeText(screen.getByLabelText('Your question'), 'Why so much protein?');
    expect(screen.getByText('Your question', { includeHiddenElements: true })).toBeTruthy();
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
    expect(Object.keys(r).sort()).toEqual(SUMMARY_KEYS);
    expect(r).toEqual({ sessions: 3, planned_sessions: 4, logged_days: 5, avg_kcal: 2000, avg_protein_g: 120, protein_days: 4, weight_avg_kg: 81.5, prev_weight_avg_kg: 82, improved: [{ exercise: 'Goblet Squat', pct: 5 }, { exercise: 'custom exercise', pct: 3 }], stalled: ['custom exercise'], burn_kcal: null, target_kcal: 2000, target_protein_g: 150, goal: 'lose' });
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
    const sent = POST.mock.calls[0]![1].body as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(SUMMARY_KEYS);
    expect(sent).toEqual(buildSummaryRequest(week(), p.targets, 'lose'));
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

function Probe({ onResult }: { onResult: (r: unknown) => void }) {
  const a = useAi();
  return (
    <Pressable accessibilityLabel="probe" onPress={() => void a.describeMeal('2 rotis').then(onResult)}>
      <Text>probe</Text>
    </Pressable>
  );
}

describe('guards', () => {
  it('useAi().describeMeal with consent off sends nothing', async () => {
    const { api, GET, POST } = fakeApi();
    const out = jest.fn();
    await ai(kvDb({ [KEY_USER]: 'u1' }), api, <Probe onResult={out} />);
    await fireEvent.press(screen.getByLabelText('probe'));
    await waitFor(() => expect(out).toHaveBeenCalledWith({ kind: 'disabled' }));
    expect(POST).not.toHaveBeenCalled();
    expect(GET).not.toHaveBeenCalled();
  });

  it('with the quota known to be used up, the provider sends nothing', async () => {
    const used = { limit: 10, remaining: 0, resets_at: '2026-10-09T00:00:00Z' };
    const { api, POST } = fakeApi({ get: jest.fn(async () => ({ data: status({ describe_meal: true }, used), response: res(200) })) });
    const out = jest.fn();
    await ai(optedIn(), api, <Probe onResult={out} />);
    await waitFor(() => expect(api.GET).toHaveBeenCalled());
    await new Promise<void>((r) => setImmediate(r));
    await fireEvent.press(screen.getByLabelText('probe'));
    await waitFor(() => expect(out).toHaveBeenCalledWith({ kind: 'quota', quota: used }));
    expect(POST).not.toHaveBeenCalled();
  });
});

describe('quota in the sheets', () => {
  const on = (q = QUOTA) => fakeApi({ get: jest.fn(async () => ({ data: status({ describe_meal: true, ask_why: true }, q), response: res(200) })) });

  it('a second tap after the quota ran out sends nothing', async () => {
    const { api, POST } = on();
    const q = { limit: 10, remaining: 0, resets_at: '2026-10-09T00:00:00Z' };
    POST.mockResolvedValue({ error: { code: 'quota_exceeded', message: 'x', quota: q }, response: res(429) });
    await food(optedIn(), api);
    await fireEvent.press(await screen.findByLabelText('Describe your breakfast in words, AI estimate'));
    await fireEvent.changeText(await screen.findByLabelText('Describe your meal'), '2 rotis');
    const button = screen.getByLabelText('Estimate');
    await fireEvent.press(button);
    await screen.findByText(/You’ve used today’s AI answers/);
    expect(screen.queryByLabelText('Estimate')).toBeNull();
    await fireEvent.press(button);
    expect(POST).toHaveBeenCalledTimes(1);
  });

  it('already used up: the sheets offer no send button', async () => {
    const { api, POST } = on({ limit: 10, remaining: 0, resets_at: '2026-10-09T00:00:00Z' });
    await food(optedIn(), api);
    await waitFor(() => expect(api.GET).toHaveBeenCalled());
    await fireEvent.press(await screen.findByLabelText('Describe your breakfast in words, AI estimate'));
    await screen.findByLabelText('Describe your meal');
    expect(screen.queryByLabelText('Estimate')).toBeNull();
    expect(POST).not.toHaveBeenCalled();
  });
});

describe('account lock', () => {
  it('a slow AI call does not hold the account lock', async () => {
    let release: (v: unknown) => void = () => undefined;
    const { api, POST } = fakeApi();
    POST.mockImplementation(() => new Promise((r) => (release = r)));
    const out = jest.fn();
    await ai(optedIn(), api, <Probe onResult={out} />);
    await waitFor(() => expect(api.GET).toHaveBeenCalled());
    await fireEvent.press(screen.getByLabelText('probe'));
    await waitFor(() => expect(POST).toHaveBeenCalled());
    // What sign-in, sign-out, export and sync pausing all wait on. A free lock resolves within promise callbacks; one still held loses to the next macrotask, whatever the machine load:
    const got = await Promise.race([withSyncPaused(async () => 'free'), new Promise((r) => setImmediate(() => r('held')))]);
    expect(got).toBe('free');
    release({ data: { items: [], quota: QUOTA }, response: res(200) });
    await waitFor(() => expect(out).toHaveBeenCalledWith({ kind: 'ok', data: { items: [], quota: QUOTA } }));
  });

  it('a 401 with tokens already changed retries once without refreshing', async () => {
    const { api, POST } = fakeApi();
    const t = memoryTokenStore();
    await t.save({ access: 'a', refresh: 'r' });
    POST.mockImplementationOnce(async () => {
      await t.save({ access: 'a2', refresh: 'r2' });
      return { error: { code: 'token_expired', message: 'x' }, response: res(401) };
    }).mockResolvedValueOnce({ data: { items: [], quota: QUOTA }, response: res(200) });
    const out = jest.fn();
    await render(
      <AiProvider db={optedIn() as never} api={api} tokens={t} signedIn now={NOW}>
        <Probe onResult={out} />
      </AiProvider>,
    );
    await waitFor(() => expect(api.GET).toHaveBeenCalled());
    await fireEvent.press(screen.getByLabelText('probe'));
    await waitFor(() => expect(out).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok' })));
    expect(POST.mock.calls.map((c) => c[0])).toEqual(['/ai/describe-meal', '/ai/describe-meal']);
  });

  it('drops the answer when the signed-in user changed meanwhile', async () => {
    const kv = optedIn();
    const { api, POST } = fakeApi();
    POST.mockImplementation(async () => {
      kv.kv.set(KEY_USER, 'u2');
      return { data: { items: [ROTI], quota: QUOTA }, response: res(200) };
    });
    const out = jest.fn();
    await ai(kv, api, <Probe onResult={out} />);
    await fireEvent.press(screen.getByLabelText('probe'));
    await waitFor(() => expect(out).toHaveBeenCalledWith({ kind: 'signed_out' }));
  });
});

describe('cold start with an expired token', () => {
  it('the first status read refreshes the tokens once, so the feature appears even when sync never runs (no sync consent)', async () => {
    const GET = jest
      .fn()
      .mockResolvedValueOnce({ error: { code: 'token_expired', message: 'x' }, response: res(401) })
      .mockResolvedValue({ data: status({ describe_meal: true }), response: res(200) });
    const POST: jest.Mock = jest.fn(async () => ({ data: { token_type: 'Bearer', access_token: 'a2', refresh_token: 'r2', access_token_expires_at: 'x', refresh_token_expires_at: 'y', user: { id: 'u1' } }, response: res(200) }));
    const t = await tokens();
    await render(
      <AiProvider db={optedIn() as never} api={{ GET, POST } as unknown as ApiClient} tokens={t} signedIn now={NOW}>
        <AiSection />
      </AiProvider>,
    );
    expect(await screen.findByText('Available now: Describe a meal.')).toBeTruthy();
    expect(POST.mock.calls.map((c) => c[0])).toEqual(['/auth/refresh']);
    expect(await t.load()).toEqual({ access: 'a2', refresh: 'r2' });
  });

  it('reads the status again after a sync run succeeds, so the feature appears without a foreground', async () => {
    const GET = jest
      .fn()
      .mockResolvedValueOnce({ error: { code: 'token_expired', message: 'x' }, response: res(401) })
      .mockResolvedValue({ data: status({ describe_meal: true }), response: res(200) });
    const { api } = fakeApi({ get: GET });
    const t = await tokens();
    const kv = optedIn();
    const tree = (stamp: unknown) => (
      <AiProvider db={kv as never} api={api} tokens={t} signedIn syncStamp={stamp} now={NOW}>
        <AiSection />
      </AiProvider>
    );
    const view = await render(tree(null));
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(1));
    await screen.findByLabelText('Use AI features');
    expect(screen.queryByText(/Available now/)).toBeNull();
    await view.rerender(tree({ status: 'ok' }));
    expect(await screen.findByText('Available now: Describe a meal.')).toBeTruthy();
    expect(GET).toHaveBeenCalledTimes(2);
    // Once known, later sync runs do not ask again.
    await view.rerender(tree({ status: 'ok' }));
    expect(GET).toHaveBeenCalledTimes(2);
  });
});

describe('Why sheet follow-up', () => {
  const open = async () => {
    await fireEvent.press(await screen.findByLabelText(/^Why\? /));
  };
  const on = () => fakeApi({ get: jest.fn(async () => ({ data: status({ ask_why: true }), response: res(200) })) });

  it('is not shown without an AI provider, and the card still reads', async () => {
    await render(<WhyLink id="protein" />);
    await fireEvent.press(await screen.findByLabelText(/^Why\? /));
    expect(screen.getByText(/Source: /)).toBeTruthy();
    expect(screen.queryByLabelText('Ask a follow-up')).toBeNull();
  });

  it('puts Close after the source line and the follow-up, so the reading order ends on it (#1006)', async () => {
    const { api } = on();
    await ai(optedIn(), api, <WhyLink id="protein" />);
    await open();
    await screen.findByText('Ask a follow-up', { includeHiddenElements: true });
    const tree = JSON.stringify(screen.toJSON());
    const at = (needle: string) => tree.indexOf(needle);
    expect(at('Source: ')).toBeGreaterThan(-1);
    expect(at('"Ask a follow-up"')).toBeGreaterThan(at('Source: '));
    expect(at('"Close"')).toBeGreaterThan(at('"Ask a follow-up"'));
    expect(screen.getAllByLabelText('Close')).toHaveLength(1);
  });

  it('closes on the screen-reader escape gesture, since Close is at the bottom (#1006)', async () => {
    const onClose = jest.fn();
    await render(<WhySheet id="protein" onClose={onClose} />);
    await fireEvent(screen.getByLabelText('Close'), 'accessibilityEscape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows its label as visible text that stays once the user types', async () => {
    const { api } = on();
    await ai(optedIn(), api, <WhyLink id="protein" />);
    await open();
    expect(await screen.findByText('Ask a follow-up', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('Ask a follow-up')).toBeNull(); // hidden from screen readers: the field speaks the label
    await fireEvent.changeText(screen.getByLabelText('Ask a follow-up'), 'Is 150 g too much?');
    expect(screen.getByText('Ask a follow-up', { includeHiddenElements: true })).toBeTruthy();
  });

  it('is hidden when consent is not given, and nothing is sent', async () => {
    const { api, GET, POST } = on();
    await ai(kvDb({ [KEY_USER]: 'u1' }), api, <WhyLink id="protein" />);
    await open();
    expect(screen.queryByLabelText('Ask a follow-up')).toBeNull();
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  it('is hidden when the server has Ask why off', async () => {
    const { api, GET } = fakeApi();
    await ai(optedIn(), api, <WhyLink id="protein" />);
    await waitFor(() => expect(GET).toHaveBeenCalled());
    await open();
    expect(screen.queryByLabelText('Ask a follow-up')).toBeNull();
  });

  it.each(blank.must_fail.map((t) => [JSON.stringify(t), t]))('never sends a blank question %s', async (_n, t) => {
    const { api, POST } = on();
    await ai(optedIn(), api, <WhyLink id="protein" />);
    await open();
    await fireEvent.changeText(await screen.findByLabelText('Ask a follow-up'), t);
    await fireEvent.press(screen.getByLabelText('Ask'));
    expect(POST).not.toHaveBeenCalled();
    expect(screen.queryByText(/Shorten it/)).toBeNull();
  });

  it('sends the card id of the open card and shows the answer', async () => {
    const { api, POST } = on();
    POST.mockResolvedValue({ data: { answer: 'Because protein protects muscle.', card_id: 'protein', quota: QUOTA }, response: res(200) });
    await ai(optedIn(), api, <WhyLink id="protein" />);
    await open();
    await fireEvent.changeText(await screen.findByLabelText('Ask a follow-up'), 'Is 150 g too much?');
    await fireEvent.press(screen.getByLabelText('Ask'));
    expect(await screen.findByText('Because protein protects muscle.')).toBeTruthy();
    expect(POST.mock.calls[0]).toEqual(['/ai/ask-why', { body: { card_id: 'protein', question: 'Is 150 g too much?' }, signal: expect.anything() }]);
  });

  it('says so and keeps the card when the quota is used up', async () => {
    const { api, POST } = fakeApi({ get: jest.fn(async () => ({ data: status({ ask_why: true }, { ...QUOTA, remaining: 0 }), response: res(200) })) });
    await ai(optedIn(), api, <WhyLink id="protein" />);
    await open();
    expect(await screen.findByText(/You’ve used today’s AI answers/)).toBeTruthy();
    expect(screen.queryByLabelText('Ask')).toBeNull();
    expect(screen.getByText(/Source: /)).toBeTruthy();
    expect(POST).not.toHaveBeenCalled();
  });

  it('shows the failure message when the request fails, and keeps the box', async () => {
    const { api, POST } = on();
    POST.mockResolvedValue({ error: { code: 'internal', message: 'x' }, response: res(500) });
    await ai(optedIn(), api, <WhyLink id="protein" />);
    await open();
    await fireEvent.changeText(await screen.findByLabelText('Ask a follow-up'), 'Why?');
    await fireEvent.press(screen.getByLabelText('Ask'));
    expect(await screen.findByText(/Couldn’t get an answer, try again\. The cards in the app still explain it\./)).toBeTruthy();
    expect(screen.getByLabelText('Ask a follow-up')).toBeTruthy();
  });

  it('falls back to the cards when the server switches it off mid-use', async () => {
    const get = jest.fn().mockResolvedValueOnce({ data: status({ ask_why: true }), response: res(200) }).mockResolvedValue({ data: status(), response: res(200) });
    const { api, POST } = fakeApi({ get });
    POST.mockResolvedValue({ error: { code: 'feature_disabled', message: 'x' }, response: res(503) });
    await ai(optedIn(), api, <WhyLink id="protein" />);
    await open();
    await fireEvent.changeText(await screen.findByLabelText('Ask a follow-up'), 'Why?');
    await fireEvent.press(screen.getByLabelText('Ask'));
    await waitFor(() => expect(screen.queryByLabelText('Ask a follow-up')).toBeNull());
  });
});
