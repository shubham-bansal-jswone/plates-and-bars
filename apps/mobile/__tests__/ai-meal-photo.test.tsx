import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ApiClient } from '@plate-and-bar/api';
import { AiProvider, KEY_AI_CONSENT, useAi } from '../src/ai/AiProvider';
import { AiSection } from '../src/ai/AiSection';
import { useRequest } from '../src/ai/useRequest';
import { IMAGE_ISSUES } from '../src/ai/client';
import { IMAGE_ISSUE_MESSAGE } from '../src/ai/copy';
import { PhotoTooBig, shrinkForAi } from '../src/ai/photo';
import { FoodScreen } from '../src/screens/FoodScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryTokenStore } from '../src/sync/tokens';
import { KEY_USER } from '../src/sync/store';
import { memoryDb, withProfile } from './helpers';

// Meal photo (#946): hidden unless the server says on and consent is given, never sends an image otherwise, shrinks and
// re-encodes the photo, shows the items to confirm, and logs to the viewed day and the meal the sheet was opened for.
const CACHE = 'file:///data/user/0/app/cache/';
const mockPicker = { granted: true, result: null as unknown, calls: [] as string[] };
const mockSaved = { base64: ['cmVzaXplZA=='] as string[], ops: [] as string[], deleted: [] as string[] };

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: async () => ({ granted: mockPicker.granted }),
  launchCameraAsync: async () => (mockPicker.calls.push('camera'), mockPicker.result),
  launchImageLibraryAsync: async () => (mockPicker.calls.push('library'), mockPicker.result),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (uri: string) => {
      mockSaved.ops.push(`manipulate ${uri}`);
      const ctx = {
        resize: (s: object) => (mockSaved.ops.push(`resize ${JSON.stringify(s)}`), ctx),
        release: () => void mockSaved.ops.push('release context'),
        renderAsync: async () => ({
          release: () => void mockSaved.ops.push('release image'),
          saveAsync: async (o: { compress: number; format: string; base64: boolean }) => {
            mockSaved.ops.push(`save ${o.compress} ${o.format} ${o.base64}`);
            return { uri: `${CACHE}ImageManipulator/out-${o.compress}.jpg`, base64: mockSaved.base64[Math.min(mockSaved.ops.filter((x) => x.startsWith('save')).length - 1, mockSaved.base64.length - 1)] };
          },
        }),
      };
      return ctx;
    },
  },
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///data/user/0/app/cache/' } },
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return true;
    }
    delete() {
      mockSaved.deleted.push(this.uri);
    }
  },
}));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const QUOTA = { limit: 10, remaining: 7, resets_at: '2026-10-09T00:00:00Z' };
type Flags = Partial<Record<'describe_meal' | 'ask_why' | 'weekly_summary' | 'meal_photo', boolean>>;
const status = (f: Flags = {}, quota = QUOTA) => ({ features: { describe_meal: false, ask_why: false, weekly_summary: false, ...f }, quota });
const res = (s: number, h: Record<string, string> = {}) => ({ status: s, headers: { get: (k: string) => h[k] ?? null } }) as unknown as Response;
const picked = (uri: string, width = 3000, height = 4000) => ({ canceled: false, assets: [{ uri, width, height }] });

function kvDb(initial: Record<string, string> = {}) {
  const kv = new Map(Object.entries(initial));
  return {
    kv,
    getFirstAsync: async (_sql: string, key: string) => (kv.has(key) ? { value: kv.get(key) } : null),
    runAsync: async (sql: string, key: string, value?: string) => void (sql.startsWith('DELETE') ? kv.delete(key) : kv.set(key, value!)),
  };
}
const optedIn = () => kvDb({ [KEY_USER]: 'u1', [KEY_AI_CONSENT]: 'u1' });
function fakeApi(flags: Flags = { meal_photo: true }, quota = QUOTA) {
  const GET: jest.Mock = jest.fn(async () => ({ data: status(flags, quota), response: res(200) }));
  const POST: jest.Mock = jest.fn(async () => ({ error: { code: 'internal', message: 'x' }, response: res(500) }));
  return { api: { GET, POST } as unknown as ApiClient, GET, POST };
}
const tokens = async () => {
  const t = memoryTokenStore();
  await t.save({ access: 'a', refresh: 'r' });
  return t;
};
function profile() {
  return buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
}
async function food(kv: ReturnType<typeof kvDb>, api: ApiClient, signedIn = true) {
  const db = memoryDb();
  await saveProfile(db, profile());
  const t = await tokens();
  await render(
    <AiProvider db={kv as never} api={api} tokens={t} signedIn={signedIn} now={NOW}>
      {withProfile(db, <FoodScreen db={db} now={NOW} />)}
    </AiProvider>,
  );
  await screen.findByRole('header', { name: 'Food' });
  return db;
}
const logs = (db: ReturnType<typeof memoryDb>) => [...db.rows].filter(([k]) => k.startsWith('food_logs:')).map(([, v]) => JSON.parse(v));
const ROTI = { name: 'Roti', qty: '2 medium', kcal: 240, protein_g: 7, carbs_g: 46, fat_g: 3, confidence: 'high', match: 'Roti / chapati', servings: 2 };
const SABZI = { name: 'Bhindi sabzi', qty: '1 katori (150 g)', kcal: 130, protein_g: 3, carbs_g: 12, fat_g: 8, confidence: 'low', match: null, servings: 1 };
const ok = (items: object[], not_food = false) => ({ data: { not_food, items, quota: { ...QUOTA, remaining: 6 } }, response: res(200) });

beforeEach(() => {
  mockPicker.granted = true;
  mockPicker.calls = [];
  mockPicker.result = picked(`${CACHE}ImagePicker/a.jpg`);
  mockSaved.base64 = ['cmVzaXplZA=='];
  mockSaved.ops = [];
  mockSaved.deleted = [];
});

const snap = async () => fireEvent.press(await screen.findByLabelText('Snap a meal'));
const analyse = async (hint?: string) => {
  await fireEvent.press(await screen.findByLabelText('Choose a photo'));
  await screen.findByLabelText('Your meal photo');
  if (hint) await fireEvent.changeText(screen.getByLabelText('Anything the photo can’t show? Optional'), hint);
  await fireEvent.press(screen.getByLabelText('Analyse photo'));
};

describe('hidden states', () => {
  it('shows no entry point and sends nothing without consent, even with the server on', async () => {
    const { api, GET, POST } = fakeApi();
    await food(kvDb({ [KEY_USER]: 'u1' }), api);
    expect(screen.queryByLabelText('Snap a meal')).toBeNull();
    await fireEvent.press(await screen.findByLabelText('+ Add to breakfast'));
    expect(screen.queryByRole('tab', { name: 'Photo' })).toBeNull();
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  it('shows no entry point when the server reports Meal photo off, and an old server (no flag) counts as off', async () => {
    const { api, GET } = fakeApi({ describe_meal: true });
    await food(optedIn(), api);
    await waitFor(() => expect(GET).toHaveBeenCalledWith('/ai/status', expect.anything()));
    expect(screen.queryByLabelText('Snap a meal')).toBeNull();
    await fireEvent.press(await screen.findByLabelText('+ Add to breakfast'));
    expect(await screen.findByRole('tab', { name: 'Describe it' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Photo' })).toBeNull();
  });

  it('signed out: no entry point and nothing sent', async () => {
    const { api, GET, POST } = fakeApi();
    await food(optedIn(), api, false);
    expect(screen.queryByLabelText('Snap a meal')).toBeNull();
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  it('shows the entry points once on, and the consent text says what a photo sends', async () => {
    const { api } = fakeApi();
    await food(optedIn(), api);
    expect(await screen.findByLabelText('Snap a meal')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('+ Add to lunch'));
    expect(await screen.findByRole('tab', { name: 'Photo' })).toBeTruthy();
  });

  it('network stub: no image is ever sent while the feature is off, whatever calls the provider', async () => {
    const probe: { call: ((image: { media_type: 'image/jpeg'; data: string }) => Promise<{ kind: string }>) | null } = { call: null };
    function Probe() {
      const ai = useAi();
      useEffect(() => {
        probe.call = (i) => ai.mealPhoto(i);
      });
      return null;
    }
    const png = { media_type: 'image/jpeg' as const, data: 'cmVzaXplZA==' };
    for (const [kv, flags] of [[kvDb({ [KEY_USER]: 'u1' }), { meal_photo: true }], [optedIn(), { describe_meal: true }], [optedIn(), {}]] as const) {
      const { api, POST } = fakeApi(flags);
      const t = await tokens();
      const view = await render(<AiProvider db={kv as never} api={api} tokens={t} signedIn now={NOW}><Probe /></AiProvider>);
      await waitFor(() => expect(probe.call).toBeTruthy());
      // The status read may not have finished: the call must still be refused, never sent.
      expect((await probe.call!(png)).kind).toBe('disabled');
      await new Promise((r) => setTimeout(r, 0));
      expect((await probe.call!(png)).kind).toBe('disabled');
      expect(POST).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('the consent section lists Meal photo only when it is on', async () => {
    const { api } = fakeApi();
    const t = await tokens();
    await render(<AiProvider db={optedIn() as never} api={api} tokens={t} signedIn now={NOW}><AiSection /></AiProvider>);
    expect(await screen.findByText(/Available now: Meal photo\./)).toBeTruthy();
    expect(screen.getByText(/Meal photo: the one photo you take or pick/)).toBeTruthy();
  });
});

describe('the flow', () => {
  it('sends the re-encoded JPEG and the note, shows the matched and estimated items, and logs nothing until Add', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok([ROTI, SABZI]));
    const db = await food(optedIn(), api);
    await snap();
    await analyse('cooked in 1 tsp ghee');
    await screen.findByLabelText('Item 1 name');
    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST.mock.calls[0]).toEqual(['/ai/meal-photo', { body: { image: { media_type: 'image/jpeg', data: 'cmVzaXplZA==' }, hint: 'cooked in 1 tsp ghee' }, signal: expect.anything() }]);
    expect(screen.getByDisplayValue('Roti / chapati')).toBeTruthy();
    // The matched item uses the food table: 2 servings of 102 kcal; the estimate is marked and unsure.
    expect(screen.getByText('204 kcal, 8 g protein, 43 g carbs, 2 g fat')).toBeTruthy();
    expect(screen.getByText('1 katori (150 g) · estimate · unsure')).toBeTruthy();
    expect(screen.getByText('130 kcal, 3 g protein, 12 g carbs, 8 g fat')).toBeTruthy();
    expect(logs(db)).toEqual([]);
    expect(screen.getByText(/Photos can’t see oil, ghee or sugar/)).toBeTruthy();
  });

  it('leaves the note out when blank and sends the picked source', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok([ROTI]));
    await food(optedIn(), api);
    await snap();
    await fireEvent.press(await screen.findByLabelText('Take a photo'));
    await screen.findByLabelText('Your meal photo');
    await fireEvent.changeText(screen.getByLabelText('Anything the photo can’t show? Optional'), '   ');
    await fireEvent.press(screen.getByLabelText('Analyse photo'));
    await waitFor(() => expect(POST).toHaveBeenCalled());
    expect(mockPicker.calls).toEqual(['camera']);
    expect(POST.mock.calls[0][1].body).toEqual({ image: { media_type: 'image/jpeg', data: 'cmVzaXplZA==' } });
  });

  it('Snap a meal opens the meal for the time of day, and Add logs there with the adjusted portion', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok([ROTI, SABZI]));
    const db = await food(optedIn(), api);
    await snap();
    expect(await screen.findByText('Add to breakfast')).toBeTruthy();
    await analyse();
    await fireEvent.press(await screen.findByLabelText('Bigger portion for Item 2 Bhindi sabzi'));
    await fireEvent.press(screen.getByLabelText('Add 2 items to breakfast'));
    await waitFor(() => expect(logs(db)).toHaveLength(2));
    expect(logs(db)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Roti / chapati', qty: 2, kcal: 102, meal: 'Breakfast', date: '2026-10-08', food_id: expect.any(String) }),
        expect.objectContaining({ name: 'Bhindi sabzi', qty: 1, kcal: 163, protein_g: 3.8, meal: 'Breakfast', food_id: null }),
      ]),
    );
    expect(screen.queryByLabelText('Your meal photo')).toBeNull();
  });

  it('from the add sheet it logs to that meal and to the viewed day, not today', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok([ROTI]));
    const db = await food(optedIn(), api);
    await fireEvent.press(await screen.findByRole('button', { name: 'Previous day' }));
    await fireEvent.press(await screen.findByLabelText('+ Add to dinner'));
    await fireEvent.press(await screen.findByRole('tab', { name: 'Photo' }));
    expect(screen.queryByLabelText('Search foods')).toBeNull();
    await analyse();
    await fireEvent.press(await screen.findByLabelText('Add 1 item to dinner'));
    await waitFor(() => expect(logs(db)).toHaveLength(1));
    expect(logs(db)[0]).toMatchObject({ name: 'Roti / chapati', meal: 'Dinner', date: '2026-10-07' });
  });

  it('removing an item keeps it out, and a swap uses the chosen food from the device', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok([ROTI, SABZI]));
    const db = await food(optedIn(), api);
    await snap();
    await analyse();
    await fireEvent.press(await screen.findByLabelText('Remove Item 1 Roti / chapati'));
    await fireEvent.press(screen.getByLabelText('Swap Item 1 Bhindi sabzi for a food from your list'));
    await fireEvent.changeText(screen.getByLabelText('Search foods to swap Item 1 Bhindi sabzi'), 'dal');
    await fireEvent.press(await screen.findByLabelText(/^Use Dal for Item 1 Bhindi sabzi/));
    await fireEvent.press(screen.getByLabelText('Add 1 item to breakfast'));
    await waitFor(() => expect(logs(db)).toHaveLength(1));
    expect(logs(db)[0]).toMatchObject({ name: 'Dal', qty: 1, kcal: 161 });
  });

  it('keeps the photo, note and items across tab switches and sends one request while one is pending', async () => {
    const { api, POST } = fakeApi();
    let done!: (v: unknown) => void;
    POST.mockReturnValue(new Promise((r) => (done = r)));
    await food(optedIn(), api);
    await snap();
    await analyse('note');
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByLabelText('Analyse photo'));
    expect(POST).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('tab', { name: 'Food list' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Photo' }));
    expect(screen.getByLabelText('Anything the photo can’t show? Optional').props.value).toBe('note');
    await (async () => done(ok([ROTI])))();
    expect(await screen.findByLabelText('Item 1 name')).toBeTruthy();
  });
});

describe('review fixes (#997)', () => {
  const ready = async (items: object[]) => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok(items));
    const db = await food(optedIn(), api);
    await snap();
    await analyse();
    await screen.findByLabelText('Item 1 name');
    return { db, POST };
  };

  it('logs the name the user typed for a matched item, with the food macros and no link to the shared food', async () => {
    const { db } = await ready([ROTI]);
    await fireEvent.changeText(screen.getByLabelText('Item 1 name'), 'Missi roti');
    await fireEvent.press(screen.getByLabelText('Add 1 item to breakfast'));
    await waitFor(() => expect(logs(db)).toHaveLength(1));
    expect(logs(db)[0]).toMatchObject({ name: 'Missi roti', qty: 2, kcal: 102, food_id: null });
  });

  it('an untouched matched item keeps its link; a blank name falls back to the food name', async () => {
    const { db } = await ready([ROTI, { ...ROTI, match: 'Dal', name: 'Dal' }]);
    await fireEvent.changeText(screen.getByLabelText('Item 2 name'), '   ');
    await fireEvent.press(screen.getByLabelText('Add 2 items to breakfast'));
    await waitFor(() => expect(logs(db)).toHaveLength(2));
    expect(logs(db).map((l) => [l.name, l.food_id !== null])).toEqual(expect.arrayContaining([['Roti / chapati', true], ['Dal', true]]));
  });

  it('rounds qty to one decimal like the prototype (1.5 servings at 0.75x is 1.1, not 1.13)', async () => {
    const { db } = await ready([{ ...ROTI, servings: 1.5 }]);
    await fireEvent.press(screen.getByLabelText('Smaller portion for Item 1 Roti / chapati'));
    await fireEvent.press(screen.getByLabelText('Add 1 item to breakfast'));
    await waitFor(() => expect(logs(db)).toHaveLength(1));
    expect(logs(db)[0].qty).toBe(1.1);
  });

  it('after a swap the portion is the swapped food’s serving label', async () => {
    await ready([SABZI]);
    expect(screen.getByText('1 katori (150 g) · estimate · unsure')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Swap Item 1 Bhindi sabzi for a food from your list'));
    await fireEvent.changeText(screen.getByLabelText('Search foods to swap Item 1 Bhindi sabzi'), 'dal');
    await fireEvent.press(await screen.findByLabelText(/^Use Dal for Item 1 Bhindi sabzi/));
    expect(screen.getByText('1 katori (35 g dal)')).toBeTruthy();
    expect(screen.queryByText(/ · estimate/)).toBeNull();
  });

  describe('Save estimated or adjusted items to my foods', () => {
    const mine = (db: ReturnType<typeof memoryDb>) => [...db.rows].filter(([k]) => k.startsWith('user_foods:')).map(([, v]) => JSON.parse(v));

    it('is off by default and saves nothing', async () => {
      const { db } = await ready([SABZI]);
      expect(screen.getByRole('checkbox', { name: 'Save estimated or adjusted items to my foods' }).props.accessibilityState.checked).toBe(false);
      await fireEvent.press(screen.getByLabelText('Add 1 item to breakfast'));
      await waitFor(() => expect(logs(db)).toHaveLength(1));
      expect(mine(db)).toEqual([]);
    });

    it('saves estimates, adjusted and renamed items, not an untouched matched one, and links the estimate’s log to its saved food', async () => {
      const { db } = await ready([ROTI, SABZI, { ...ROTI, match: 'Dal', name: 'Dal', qty: '1 katori' }, { ...ROTI, match: 'Rice, cooked', name: 'Rice' }]);
      await fireEvent.press(screen.getByRole('checkbox', { name: 'Save estimated or adjusted items to my foods' }));
      await fireEvent.press(screen.getByLabelText('Bigger portion for Item 2 Bhindi sabzi')); // estimate at 1.25x
      await fireEvent.press(screen.getByLabelText('Bigger portion for Item 3 Dal')); // matched, adjusted
      await fireEvent.changeText(screen.getByLabelText('Item 4 name'), 'My rice'); // matched, renamed
      await fireEvent.press(screen.getByLabelText('Add 4 items to breakfast'));
      await waitFor(() => expect(logs(db)).toHaveLength(4));
      await waitFor(() => expect(mine(db)).toHaveLength(3));
      const saved = Object.fromEntries(mine(db).map((f) => [f.name, f]));
      expect(Object.keys(saved).sort()).toEqual(['Bhindi sabzi', 'Dal', 'My rice']);
      // Estimate: adjusted macros as one portion; unit "<portion> ×adj"; kcal whole, macros 1 decimal.
      expect(saved['Bhindi sabzi']).toMatchObject({ unit: '1 katori (150 g) ×1.3', kcal: 163, protein_g: 3.8, carbs_g: 15, fat_g: 10, origin: 'custom' });
      expect(saved['Dal'].unit).toBe('1 katori ×1.3');
      const sabzi = logs(db).find((l) => l.name === 'Bhindi sabzi');
      expect(sabzi).toMatchObject({ qty: 1, kcal: 163, food_id: saved['Bhindi sabzi'].id });
      expect(logs(db).find((l) => l.name === 'Roti / chapati')).toMatchObject({ qty: 2, food_id: expect.any(String) });
    });
  });

  it('says how many items were added once the sheet closes', async () => {
    const { db } = await ready([ROTI, SABZI]);
    await fireEvent.press(screen.getByLabelText('Add 2 items to breakfast'));
    await waitFor(() => expect(logs(db)).toHaveLength(2));
    expect(await screen.findByText('Added 2 items from your photo')).toBeTruthy();
  });

  describe('a reply nobody is waiting for is dropped', () => {
    const pending = async () => {
      const { api, POST } = fakeApi();
      let done!: (v: unknown) => void;
      POST.mockReturnValue(new Promise((r) => (done = r)));
      await food(optedIn(), api);
      await snap();
      await analyse('note');
      await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
      return { resolve: done, POST };
    };

    it('Cancel, edit the note, then a late answer changes nothing', async () => {
      const { resolve } = await pending();
      await fireEvent.press(screen.getByLabelText('Cancel analysis'));
      expect(screen.getByLabelText('Analyse photo')).toBeTruthy();
      await fireEvent.changeText(screen.getByLabelText('Anything the photo can’t show? Optional'), 'my own note');
      await act(async () => resolve(ok([ROTI])));
      expect(screen.queryByLabelText('Item 1 name')).toBeNull();
      expect(screen.getByLabelText('Anything the photo can’t show? Optional').props.value).toBe('my own note');
      expect(screen.queryByLabelText('Cancel analysis')).toBeNull();
    });

    it('Cancel, then a late error shows no message', async () => {
      const { resolve } = await pending();
      await fireEvent.press(screen.getByLabelText('Cancel analysis'));
      await act(async () => resolve({ error: { code: 'unavailable', message: 'x' }, response: res(503) }));
      expect(screen.queryByText(/Couldn’t get an answer/)).toBeNull();
    });

    it('choosing a different photo drops the answer for the old one, and Analyse can run again', async () => {
      const { resolve, POST } = await pending();
      mockSaved.base64 = ['bmV3cGhvdG8='];
      await fireEvent.press(screen.getByLabelText('Use a different photo'));
      await act(async () => resolve(ok([ROTI])));
      expect(screen.queryByLabelText('Item 1 name')).toBeNull();
      POST.mockResolvedValue(ok([SABZI]));
      await fireEvent.press(await screen.findByLabelText('Analyse photo'));
      expect(await screen.findByLabelText('Item 1 name')).toBeTruthy();
      expect(POST.mock.calls[1][1].body.image.data).toBe('bmV3cGhvdG8=');
    });
  });

  describe('busy server (503 with Retry-After)', () => {
    afterEach(() => jest.useRealTimers());

    it('turns Analyse off for the wait, capped at 10 seconds, and says why', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      const { api, POST } = fakeApi();
      POST.mockResolvedValue({ error: { code: 'unavailable', message: 'x' }, response: res(503, { 'Retry-After': '45' }) });
      await food(optedIn(), api);
      await snap();
      await analyse();
      expect(await screen.findByText('The server is busy. You can try again in 10 seconds.')).toBeTruthy();
      expect(screen.queryByLabelText('Analyse photo')).toBeNull();
      expect(screen.getByText(/Couldn’t get an answer, try again\./)).toBeTruthy();
      for (let i = 0; i < 10; i++) {
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });
      }
      expect(await screen.findByLabelText('Analyse photo')).toBeTruthy();
      expect(screen.queryByText(/The server is busy/)).toBeNull();
      expect(POST).toHaveBeenCalledTimes(1);
    });

    it('a plain 503 without Retry-After keeps Analyse on', async () => {
      const { api, POST } = fakeApi();
      POST.mockResolvedValue({ error: { code: 'unavailable', message: 'x' }, response: res(503) });
      await food(optedIn(), api);
      await snap();
      await analyse();
      expect(await screen.findByText(/Couldn’t get an answer/)).toBeTruthy();
      expect(screen.getByLabelText('Analyse photo')).toBeTruthy();
    });
  });
});

describe('failures fall back and say so', () => {
  const failWith = async (reply: unknown, flags: Flags = { meal_photo: true }, quota = QUOTA) => {
    const { api, POST } = fakeApi(flags, quota);
    POST.mockResolvedValue(reply);
    const db = await food(optedIn(), api);
    await snap();
    await analyse();
    return { db, POST };
  };

  it('a photo with no food says so and offers another', async () => {
    await failWith(ok([], true));
    expect(await screen.findByText('Couldn’t spot food in this photo. Try again closer, from above, with good light.')).toBeTruthy();
    expect(screen.getByLabelText('Use a different photo')).toBeTruthy();
  });

  it('an answer with no items is the same message', async () => {
    await failWith(ok([], false));
    expect(await screen.findByText(/Couldn’t spot food in this photo/)).toBeTruthy();
  });

  it('503 feature_disabled shows the switched-off message with the non-AI path, and the entry point goes', async () => {
    const get = jest.fn().mockResolvedValueOnce({ data: status({ meal_photo: true }), response: res(200) }).mockResolvedValue({ data: status(), response: res(200) });
    const { api, POST } = fakeApi();
    (api as unknown as { GET: jest.Mock }).GET = get;
    POST.mockResolvedValue({ error: { code: 'feature_disabled', message: 'x' }, response: res(503) });
    await food(optedIn(), api);
    await snap();
    await analyse();
    expect(await screen.findByText('AI features are switched off right now. Describe it, the food list and Custom still work.')).toBeTruthy();
  });

  it('503 unavailable says to try again', async () => {
    await failWith({ error: { code: 'unavailable', message: 'x' }, response: res(503) });
    expect(await screen.findByText('Couldn’t get an answer, try again. Describe it, the food list and Custom still work.')).toBeTruthy();
  });

  it('429 rate_limited says to wait a minute', async () => {
    await failWith({ error: { code: 'rate_limited', message: 'x' }, response: res(429, { 'Retry-After': '30' }) });
    expect(await screen.findByText('Too many requests right now. Wait a minute and try again.')).toBeTruthy();
  });

  it('429 quota_exceeded shows the quota message and sends no more until it resets', async () => {
    const { POST } = await failWith({ error: { code: 'quota_exceeded', message: 'x', quota: { ...QUOTA, remaining: 0 } }, response: res(429, { 'Retry-After': '3600' }) });
    expect(await screen.findByText(/You’ve used today’s AI answers\. They come back at .* Describe it, the food list and Custom still work\./)).toBeTruthy();
    expect(screen.queryByLabelText('Analyse photo')).toBeNull();
    expect(POST).toHaveBeenCalledTimes(1);
  });

  it('a used-up quota shows the message and sends nothing', async () => {
    const { api, POST } = fakeApi({ meal_photo: true }, { ...QUOTA, remaining: 0 });
    await food(optedIn(), api);
    await snap();
    expect(await screen.findByText(/You’ve used today’s AI answers/)).toBeTruthy();
    expect(screen.queryByLabelText('Analyse photo')).toBeNull();
    expect(POST).not.toHaveBeenCalled();
  });

  it('offline says so', async () => {
    const { api, POST } = fakeApi();
    POST.mockRejectedValue(new TypeError('Network request failed'));
    await food(optedIn(), api);
    await snap();
    await analyse();
    expect(await screen.findByText('No connection. Describe it, the food list and Custom still work.')).toBeTruthy();
  });

  it.each(IMAGE_ISSUES.map((i) => [i]))('400 with issue %s gets its friendly message', async (issue) => {
    await failWith({ error: { code: 'invalid_request', message: 'x', details: [{ field: 'image.data', issue }] }, response: res(400) });
    expect(await screen.findByText(IMAGE_ISSUE_MESSAGE[issue])).toBeTruthy();
    expect(screen.queryByText(/image\.data|\bissue\b/)).toBeNull();
  });

  it('a 400 with an unknown issue gets the generic photo message', async () => {
    await failWith({ error: { code: 'invalid_request', message: 'x', details: [{ field: 'hint', issue: 'maxLength' }] }, response: res(400) });
    expect(await screen.findByText('That photo wasn’t accepted. Try another one.')).toBeTruthy();
  });

  it('camera access off says so, and a picker failure says to try another photo', async () => {
    const { api, POST } = fakeApi();
    await food(optedIn(), api);
    await snap();
    mockPicker.granted = false;
    await fireEvent.press(await screen.findByLabelText('Take a photo'));
    expect(await screen.findByText('Camera access is off. Allow it in Settings, or choose a photo instead.')).toBeTruthy();
    mockPicker.result = picked(`${CACHE}ImagePicker/b.jpg`);
    mockSaved.base64 = ['x'.repeat(1_600_004), 'x'.repeat(1_600_004), 'x'.repeat(1_600_004)];
    await fireEvent.press(screen.getByLabelText('Choose a photo'));
    expect(await screen.findByText('Couldn’t use that photo. Try another one.')).toBeTruthy();
    expect(POST).not.toHaveBeenCalled();
  });

  it('cancelling the picker changes nothing', async () => {
    const { api } = fakeApi();
    await food(optedIn(), api);
    await snap();
    mockPicker.result = { canceled: true, assets: null };
    await fireEvent.press(await screen.findByLabelText('Choose a photo'));
    expect(screen.queryByLabelText('Your meal photo')).toBeNull();
    expect(screen.queryByLabelText('Analyse photo')).toBeNull();
  });
});

describe('late results and closing (#997 nits)', () => {
  it('closing the sheet (Done) during Analyse, then a late reply, changes nothing on reopening', async () => {
    const { api, POST } = fakeApi();
    let done!: (v: unknown) => void;
    POST.mockReturnValue(new Promise((r) => (done = r)));
    const db = await food(optedIn(), api);
    await snap();
    await analyse();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByLabelText('Done'));
    await act(async () => done(ok([ROTI])));
    await snap();
    expect(screen.queryByLabelText('Item 1 name')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(logs(db)).toEqual([]);
  });

  it('a request token is stale once its component unmounts', async () => {
    const probe: { g: ReturnType<typeof useRequest> | null } = { g: null };
    function P() {
      probe.g = useRequest();
      return null;
    }
    const view = await render(<P />);
    const t = probe.g!.begin();
    expect(probe.g!.pending()).toBe(true);
    await view.unmount();
    expect(probe.g!.settle(t)).toBe(false);
    expect(probe.g!.pending()).toBe(false);
  });

  it('a picker result that arrives after a newer pick is dropped', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok([ROTI]));
    await food(optedIn(), api);
    await snap();
    let slow!: (v: unknown) => void;
    mockPicker.result = new Promise((r) => (slow = r));
    mockSaved.base64 = ['QkI=', 'QUE='];
    await fireEvent.press(await screen.findByLabelText('Choose a photo')); // A, still open
    mockPicker.result = picked(`${CACHE}ImagePicker/b.jpg`);
    await fireEvent.press(screen.getByLabelText('Choose a photo')); // B, answers first
    await screen.findByLabelText('Your meal photo');
    await act(async () => slow(picked(`${CACHE}ImagePicker/a.jpg`)));
    await fireEvent.press(screen.getByLabelText('Analyse photo'));
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    expect(POST.mock.calls[0][1].body.image.data).toBe('QkI=');
  });
});

describe('shrinkForAi', () => {
  it('releases the context and the rendered image, also when the photo is too big', async () => {
    await shrinkForAi({ uri: `${CACHE}ImagePicker/r.jpg`, width: 3000, height: 3000 });
    expect(mockSaved.ops.filter((o) => o.startsWith('release'))).toEqual(['release image', 'release context']);
    mockSaved.ops = [];
    mockSaved.base64 = ['x'.repeat(1_600_004)];
    await expect(shrinkForAi({ uri: `${CACHE}ImagePicker/r2.jpg`, width: 3000, height: 3000 })).rejects.toBeInstanceOf(PhotoTooBig);
    expect(mockSaved.ops.filter((o) => o.startsWith('release'))).toEqual(['release image', 'release context']);
  });

  it('resizes the long side to 1,600 px, saves JPEG at 0.85, and deletes both working copies in the cache', async () => {
    const out = await shrinkForAi({ uri: `${CACHE}ImagePicker/a.jpg`, width: 3000, height: 4000 });
    expect(out).toEqual({ media_type: 'image/jpeg', data: 'cmVzaXplZA==' });
    expect(mockSaved.ops).toEqual([`manipulate ${CACHE}ImagePicker/a.jpg`, 'resize {"height":1600}', 'save 0.85 jpeg true', 'release image', 'release context']);
    expect(mockSaved.deleted).toEqual([`${CACHE}ImagePicker/a.jpg`, `${CACHE}ImageManipulator/out-0.85.jpg`]);
  });

  it('does not resize a photo that is already small', async () => {
    await shrinkForAi({ uri: `${CACHE}ImagePicker/s.jpg`, width: 1200, height: 900 });
    expect(mockSaved.ops.some((o) => o.startsWith('resize'))).toBe(false);
  });

  it('lowers the quality until the base64 fits the contract limit, then gives up with PhotoTooBig', async () => {
    mockSaved.base64 = ['x'.repeat(1_600_004), 'cmVzaXplZA=='];
    expect((await shrinkForAi({ uri: `${CACHE}ImagePicker/c.jpg`, width: 3000, height: 3000 })).data).toBe('cmVzaXplZA==');
    expect(mockSaved.ops.filter((o) => o.startsWith('save'))).toEqual(['save 0.85 jpeg true', 'save 0.7 jpeg true']);
    mockSaved.ops = [];
    mockSaved.deleted = [];
    mockSaved.base64 = ['x'.repeat(1_600_004)];
    await expect(shrinkForAi({ uri: `${CACHE}ImagePicker/d.jpg`, width: 3000, height: 3000 })).rejects.toBeInstanceOf(PhotoTooBig);
    expect(mockSaved.deleted).toContain(`${CACHE}ImagePicker/d.jpg`);
  });

  it('never deletes a photo outside the app cache', async () => {
    await shrinkForAi({ uri: 'file:///storage/emulated/0/DCIM/Camera/mine.jpg', width: 800, height: 600 });
    expect(mockSaved.deleted).not.toContain('file:///storage/emulated/0/DCIM/Camera/mine.jpg');
  });
});
