import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ApiClient } from '@plate-and-bar/api';
import { AiProvider, KEY_AI_CONSENT, useAi } from '../src/ai/AiProvider';
import { IMAGE_ISSUES } from '../src/ai/client';
import { IMAGE_ISSUE_MESSAGE } from '../src/ai/copy';
import { RecipesScreen } from '../src/screens/RecipesScreen';
import { memoryTokenStore } from '../src/sync/tokens';
import { KEY_USER } from '../src/sync/store';
import { loadRecipes } from '../src/db/recipes';
import { memoryDb, withProfile } from './helpers';

// Import recipe (#946): hidden unless the server says on and consent is given, never sends text or a photo otherwise, opens the
// draft in the recipe builder with unmatched ingredients flagged, and maps every failure to the fallback copy.
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
        release: () => undefined,
        renderAsync: async () => ({
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
type Flags = Partial<Record<'describe_meal' | 'ask_why' | 'weekly_summary' | 'import_recipe', boolean>>;
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
function fakeApi(flags: Flags = { import_recipe: true }, quota = QUOTA) {
  const GET: jest.Mock = jest.fn(async () => ({ data: status(flags, quota), response: res(200) }));
  const POST: jest.Mock = jest.fn(async () => ({ error: { code: 'internal', message: 'x' }, response: res(500) }));
  return { api: { GET, POST } as unknown as ApiClient, GET, POST };
}
const tokens = async () => {
  const t = memoryTokenStore();
  await t.save({ access: 'a', refresh: 'r' });
  return t;
};

async function recipes(kv: ReturnType<typeof kvDb>, api: ApiClient, signedIn = true) {
  const db = memoryDb();
  const t = await tokens();
  await render(
    <AiProvider db={kv as never} api={api} tokens={t} signedIn={signedIn} now={NOW}>
      {withProfile(db, <RecipesScreen db={db} onBack={jest.fn()} onKitchen={jest.fn()} now={NOW} />)}
    </AiProvider>,
  );
  await screen.findByRole('header', { name: 'Recipes' });
  return db;
}
const DAL = {
  name: 'Dal tadka',
  katoris: 6,
  ingredients: [
    { ingredient: 'Toor dal (dry)', amount: 200, unit: 'g' },
    { ingredient: 'Ghee', amount: 10.04, unit: 'g' },
  ],
  steps: ['Pressure cook the dal with turmeric for 15 min.', 'Temper with ghee and jeera and pour over the dal.'],
  unmatched: ['salt', 'jeera'],
};
const ok = (over: object = {}) => ({ data: { ...DAL, quota: { ...QUOTA, remaining: 6 }, ...over }, response: res(200) });

beforeEach(() => {
  mockPicker.granted = true;
  mockPicker.calls = [];
  mockPicker.result = picked(`${CACHE}ImagePicker/a.jpg`);
  mockSaved.base64 = ['cmVzaXplZA=='];
  mockSaved.ops = [];
  mockSaved.deleted = [];
});

const open = async () => fireEvent.press(await screen.findByLabelText('Import a recipe from text or a photo'));
const typeRecipe = async (t = 'Dal tadka (serves 4). 1 cup toor dal, 2 tsp ghee, salt.') => fireEvent.changeText(await screen.findByLabelText('Recipe text'), t);
const importIt = async () => fireEvent.press(screen.getByLabelText('Import'));

describe('hidden states', () => {
  it('shows no entry point and sends nothing without consent, even with the server on', async () => {
    const { api, GET, POST } = fakeApi();
    await recipes(kvDb({ [KEY_USER]: 'u1' }), api);
    expect(screen.queryByLabelText('Import a recipe from text or a photo')).toBeNull();
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  it('shows no entry point when the server reports Import recipe off or does not send the flag', async () => {
    const { api, GET } = fakeApi({ describe_meal: true });
    await recipes(optedIn(), api);
    await waitFor(() => expect(GET).toHaveBeenCalledWith('/ai/status', expect.anything()));
    expect(screen.queryByLabelText('Import a recipe from text or a photo')).toBeNull();
  });

  it('signed out: no entry point and nothing sent', async () => {
    const { api, GET, POST } = fakeApi();
    await recipes(optedIn(), api, false);
    expect(screen.queryByLabelText('Import a recipe from text or a photo')).toBeNull();
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  it('shows the entry point once on', async () => {
    const { api } = fakeApi();
    await recipes(optedIn(), api);
    expect(await screen.findByLabelText('Import a recipe from text or a photo')).toBeTruthy();
  });

  it('network stub: neither text nor an image is sent while the feature is off, whatever calls the provider', async () => {
    const probe: { call: ((b: { text?: string; image?: { media_type: 'image/jpeg'; data: string } }) => Promise<{ kind: string }>) | null } = { call: null };
    function Probe() {
      const ai = useAi();
      useEffect(() => {
        probe.call = (b) => ai.importRecipe(b);
      });
      return null;
    }
    const body = { text: 'dal', image: { media_type: 'image/jpeg' as const, data: 'cmVzaXplZA==' } };
    for (const [kv, flags] of [[kvDb({ [KEY_USER]: 'u1' }), { import_recipe: true }], [optedIn(), { describe_meal: true }], [optedIn(), {}]] as const) {
      const { api, POST } = fakeApi(flags);
      const t = await tokens();
      const view = await render(<AiProvider db={kv as never} api={api} tokens={t} signedIn now={NOW}><Probe /></AiProvider>);
      await waitFor(() => expect(probe.call).toBeTruthy());
      expect((await probe.call!(body)).kind).toBe('disabled');
      await new Promise((r) => setTimeout(r, 0));
      expect((await probe.call!(body)).kind).toBe('disabled');
      expect(POST).not.toHaveBeenCalled();
      view.unmount();
    }
  });
});

describe('the flow', () => {
  it('text only: sends just the text and opens the draft in the builder with unmatched ingredients flagged', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok());
    await recipes(optedIn(), api);
    await open();
    await typeRecipe();
    await importIt();
    await waitFor(() => expect(screen.queryByLabelText('Recipe text')).toBeNull());
    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST.mock.calls[0]).toEqual(['/ai/import-recipe', { body: { text: 'Dal tadka (serves 4). 1 cup toor dal, 2 tsp ghee, salt.' }, signal: expect.anything() }]);
    expect(screen.getByDisplayValue('Dal tadka')).toBeTruthy();
    expect(screen.getByDisplayValue('200')).toBeTruthy();
    expect(screen.getByDisplayValue('10')).toBeTruthy();
    expect(screen.getByLabelText('Number of katoris').props.value).toBe('6');
    expect(screen.getByLabelText('Ingredient 1: Toor dal (dry). Tap to change')).toBeTruthy();
    expect(screen.getByText('Not matched, so left out: salt, jeera. Add them by hand if they matter.')).toBeTruthy();
    expect(screen.getByText('1. Pressure cook the dal with turmeric for 15 min.')).toBeTruthy();
    expect(screen.getByText(/^Per katori \(about 150 g cooked\)/)).toBeTruthy();
    expect(screen.getByText('Recipe imported. Check the amounts before saving.')).toBeTruthy();
  });

  it('photo only, and photo with text, send the re-encoded JPEG', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok());
    await recipes(optedIn(), api);
    await open();
    await fireEvent.press(await screen.findByLabelText('Add a photo of the recipe from your gallery'));
    await screen.findByLabelText('Your recipe photo');
    await importIt();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    expect(POST.mock.calls[0][1].body).toEqual({ image: { media_type: 'image/jpeg', data: 'cmVzaXplZA==' } });
    expect(mockPicker.calls).toEqual(['library']);
    expect(mockSaved.ops).toContain('resize {"height":1600}');
    // The picker's copy and the re-encoded copy are deleted from the cache.
    expect(mockSaved.deleted).toEqual([`${CACHE}ImagePicker/a.jpg`, expect.stringContaining(`${CACHE}ImageManipulator/`)]);
    // Both.
    await open();
    await typeRecipe('1 cup dal');
    await fireEvent.press(screen.getByLabelText('Take a photo of the recipe'));
    await screen.findByLabelText('Your recipe photo');
    await importIt();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(2));
    expect(POST.mock.calls[1][1].body).toEqual({ text: '1 cup dal', image: { media_type: 'image/jpeg', data: 'cmVzaXplZA==' } });
  });

  it('with nothing pasted and no photo, sends nothing and says what to do', async () => {
    const { api, POST } = fakeApi();
    await recipes(optedIn(), api);
    await open();
    await typeRecipe('   ');
    await importIt();
    expect(await screen.findByText('Paste a recipe or add a photo of one.')).toBeTruthy();
    expect(POST).not.toHaveBeenCalled();
  });

  it('a matched ingredient this device does not know goes to the unmatched note, not into a row that cannot save', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok({ ingredients: [...DAL.ingredients, { ingredient: 'Dragon fruit powder', amount: 25, unit: 'g' }] }));
    await recipes(optedIn(), api);
    await open();
    await typeRecipe();
    await importIt();
    expect(await screen.findByText('Not matched, so left out: salt, jeera, Dragon fruit powder (25 g). Add them by hand if they matter.')).toBeTruthy();
    expect(screen.queryByLabelText(/^Ingredient 3/)).toBeNull();
  });

  it('nothing matched says to paste the ingredient list and leaves the builder as it was', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok({ ingredients: [], unmatched: ['salt'] }));
    await recipes(optedIn(), api);
    await open();
    await typeRecipe();
    await importIt();
    expect(await screen.findByText('Couldn’t read that recipe. Try pasting the ingredient list.')).toBeTruthy();
    expect(screen.queryByDisplayValue('Dal tadka')).toBeNull();
    expect(screen.getByLabelText('Recipe text')).toBeTruthy();
  });

  it('Cancel closes the panel and forgets the text', async () => {
    const { api, POST } = fakeApi();
    await recipes(optedIn(), api);
    await open();
    await typeRecipe();
    await fireEvent.press(screen.getByLabelText('Cancel'));
    await open();
    expect(screen.getByLabelText('Recipe text').props.value).toBe('');
    expect(POST).not.toHaveBeenCalled();
  });

  it('sends one request while one is pending', async () => {
    const { api, POST } = fakeApi();
    let done!: (v: unknown) => void;
    POST.mockReturnValue(new Promise((r) => (done = r)));
    await recipes(optedIn(), api);
    await open();
    await typeRecipe();
    await importIt();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    await importIt();
    expect(POST).toHaveBeenCalledTimes(1);
    await (async () => done(ok()))();
    expect(await screen.findByDisplayValue('Dal tadka')).toBeTruthy();
  });

  it('the imported draft saves as a recipe like any other', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok());
    const db = await recipes(optedIn(), api);
    await open();
    await typeRecipe();
    await importIt();
    await screen.findByDisplayValue('Dal tadka');
    await fireEvent.press(screen.getByLabelText('Save only'));
    await waitFor(async () => expect(await loadRecipes(db)).toHaveLength(1));
    expect((await loadRecipes(db))[0]).toMatchObject({ name: 'Dal tadka', katoris: 6, yield_mode: 'katori' });
  });
});

describe('a reply nobody is waiting for is dropped', () => {
  const pending = async () => {
    const { api, POST } = fakeApi();
    let done!: (v: unknown) => void;
    POST.mockReturnValue(new Promise((r) => (done = r)));
    await recipes(optedIn(), api);
    await open();
    await typeRecipe();
    await importIt();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    return { resolve: done, POST };
  };

  it('Cancel, type a name of your own, then a late answer changes nothing', async () => {
    const { resolve } = await pending();
    await fireEvent.press(screen.getByLabelText('Cancel'));
    await fireEvent.changeText(screen.getByLabelText('Recipe name'), 'My own dal');
    await act(async () => resolve(ok()));
    expect(screen.getByLabelText('Recipe name').props.value).toBe('My own dal');
    expect(screen.queryByDisplayValue('Dal tadka')).toBeNull();
    expect(screen.queryByText('Recipe imported. Check the amounts before saving.')).toBeNull();
    expect(screen.queryByText(/Not matched, so left out/)).toBeNull();
  });

  it('Cancel, then a late error leaves no message when the panel opens again', async () => {
    const { resolve } = await pending();
    await fireEvent.press(screen.getByLabelText('Cancel'));
    await act(async () => resolve({ error: { code: 'unavailable', message: 'x' }, response: res(503) }));
    await open();
    expect(screen.queryByText(/Couldn’t get an answer/)).toBeNull();
    expect(screen.getByLabelText('Import')).toBeTruthy();
  });

  it('a change made to the builder while it was reading is not rolled back by the answer', async () => {
    const { resolve } = await pending();
    await fireEvent.press(screen.getByLabelText('Dinner'));
    await act(async () => resolve(ok()));
    expect(await screen.findByDisplayValue('Dal tadka')).toBeTruthy();
    expect(screen.getByLabelText('Save and add to dinner')).toBeTruthy();
  });
});

describe('amounts', () => {
  it('imported grams are whole grams like the prototype (236.588 g is 237) and katoris keep one decimal', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok({ katoris: 5.46, ingredients: [{ ingredient: 'Toor dal (dry)', amount: 236.588, unit: 'g' }] }));
    await recipes(optedIn(), api);
    await open();
    await typeRecipe();
    await importIt();
    expect(await screen.findByDisplayValue('237')).toBeTruthy();
    expect(screen.getByLabelText('Number of katoris').props.value).toBe('5.5');
  });
});

describe('failures fall back and say so', () => {
  const failWith = async (reply: unknown, quota = QUOTA, withPhoto = false) => {
    const { api, POST } = fakeApi({ import_recipe: true }, quota);
    POST.mockResolvedValue(reply);
    await recipes(optedIn(), api);
    await open();
    await typeRecipe();
    if (withPhoto) {
      await fireEvent.press(await screen.findByLabelText('Add a photo of the recipe from your gallery'));
      await screen.findByLabelText('Your recipe photo');
    }
    await importIt();
    return POST;
  };

  it('503 feature_disabled shows the switched-off message with the builder as the fallback', async () => {
    await failWith({ error: { code: 'feature_disabled', message: 'x' }, response: res(503) });
    expect(await screen.findByText('AI features are switched off right now. The recipe builder still works.')).toBeTruthy();
  });

  it('503 unavailable says to try again', async () => {
    await failWith({ error: { code: 'unavailable', message: 'x' }, response: res(503) });
    expect(await screen.findByText('Couldn’t get an answer, try again. The recipe builder still works.')).toBeTruthy();
  });

  it('429 rate_limited says to wait a minute', async () => {
    await failWith({ error: { code: 'rate_limited', message: 'x' }, response: res(429, { 'Retry-After': '30' }) });
    expect(await screen.findByText('Too many requests right now. Wait a minute and try again.')).toBeTruthy();
  });

  it('429 quota_exceeded shows the quota message and no Import button', async () => {
    await failWith({ error: { code: 'quota_exceeded', message: 'x', quota: { ...QUOTA, remaining: 0 } }, response: res(429) });
    expect(await screen.findByText(/You’ve used today’s AI answers\. They come back at .* The recipe builder still works\./)).toBeTruthy();
    expect(screen.queryByLabelText('Import')).toBeNull();
  });

  it('a used-up quota shows the message and sends nothing', async () => {
    const { api, POST } = fakeApi({ import_recipe: true }, { ...QUOTA, remaining: 0 });
    await recipes(optedIn(), api);
    await open();
    expect(await screen.findByText(/You’ve used today’s AI answers/)).toBeTruthy();
    expect(screen.queryByLabelText('Import')).toBeNull();
    expect(POST).not.toHaveBeenCalled();
  });

  it('offline says so', async () => {
    const { api, POST } = fakeApi();
    POST.mockRejectedValue(new TypeError('Network request failed'));
    await recipes(optedIn(), api);
    await open();
    await typeRecipe();
    await importIt();
    expect(await screen.findByText('No connection. The recipe builder still works.')).toBeTruthy();
  });

  it.each(IMAGE_ISSUES.map((i) => [i]))('400 on the photo with issue %s gets its friendly message', async (issue) => {
    await failWith({ error: { code: 'invalid_request', message: 'x', details: [{ field: 'image.data', issue }] }, response: res(400) }, QUOTA, true);
    expect(await screen.findByText(IMAGE_ISSUE_MESSAGE[issue])).toBeTruthy();
    expect(screen.queryByText(/image\.data/)).toBeNull();
  });

  it('a 400 on the photo with an issue the app does not know gets the generic photo message, never "shorten the text"', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue({ error: { code: 'invalid_request', message: 'x', details: [{ field: 'image.data', issue: 'something_new' }] }, response: res(400) });
    await recipes(optedIn(), api);
    await open();
    await fireEvent.press(await screen.findByLabelText('Add a photo of the recipe from your gallery'));
    await screen.findByLabelText('Your recipe photo');
    await importIt();
    expect(await screen.findByText('That photo wasn’t accepted. Try another one.')).toBeTruthy();
    expect(screen.queryByText(/Shorten the text/)).toBeNull();
  });

  it('a 400 on the text with only text sent says to shorten it, whatever the issue', async () => {
    await failWith({ error: { code: 'invalid_request', message: 'x', details: [{ field: '', issue: 'too_large' }] }, response: res(400) });
    expect(await screen.findByText('That recipe wasn’t accepted. Shorten the text and try again.')).toBeTruthy();
  });

  it('a 400 on the text (too long) says to shorten it, not that the photo is too big', async () => {
    await failWith({ error: { code: 'invalid_request', message: 'x', details: [{ field: 'text', issue: 'too_large' }] }, response: res(400) }, QUOTA, true);
    expect(await screen.findByText('That recipe wasn’t accepted. Shorten the text and try again.')).toBeTruthy();
  });

  it('camera access off says so', async () => {
    const { api } = fakeApi();
    await recipes(optedIn(), api);
    await open();
    mockPicker.granted = false;
    await fireEvent.press(await screen.findByLabelText('Take a photo of the recipe'));
    expect(await screen.findByText('Camera access is off. Allow it in Settings, or choose a photo instead.')).toBeTruthy();
  });
});
