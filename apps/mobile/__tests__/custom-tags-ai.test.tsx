import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ApiClient, Schemas } from '@plate-and-bar/api';
import { AiProvider, KEY_AI_CONSENT } from '../src/ai/AiProvider';
import { KEY_USER } from '../src/sync/store';
import { memoryTokenStore } from '../src/sync/tokens';
import { CustomTagsSheet } from '../src/workout/CustomTagsSheet';
import { FALLBACK_TAGS, tagsFromSuggestion } from '../src/workout/suggestTags';

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const QUOTA = { limit: 10, remaining: 7, resets_at: '2026-10-09T00:00:00Z' };
const res = (s: number, h: Record<string, string> = {}) => ({ status: s, headers: { get: (k: string) => h[k] ?? null } }) as unknown as Response;
const status = (suggest_tags: boolean | undefined, quota = QUOTA) => ({
  features: { describe_meal: false, ask_why: false, weekly_summary: false, ...(suggest_tags === undefined ? {} : { suggest_tags }) },
  quota,
});
const SUGGESTION: Schemas['SuggestTagsResponse'] = { pattern: 'fly', equipment: 'cable', difficulty: 1, primary: ['chest'], secondary: ['front-delt'], joints: ['shoulder'], quota: { ...QUOTA, remaining: 6 } };

function kvDb(initial: Record<string, string>) {
  const kv = new Map(Object.entries(initial));
  return {
    getFirstAsync: async (_sql: string, key: string) => (kv.has(key) ? { value: kv.get(key) } : null),
    runAsync: async (sql: string, key: string, value?: string) => void (sql.startsWith('DELETE') ? kv.delete(key) : kv.set(key, value!)),
  };
}
const optedIn = () => kvDb({ [KEY_USER]: 'u1', [KEY_AI_CONSENT]: 'u1' });

async function open(opts: { get?: jest.Mock; post?: jest.Mock; kv?: ReturnType<typeof kvDb> } = {}) {
  const GET: jest.Mock = opts.get ?? jest.fn(async () => ({ data: status(true), response: res(200) }));
  const POST: jest.Mock = opts.post ?? jest.fn(async () => ({ data: SUGGESTION, response: res(200) }));
  const t = memoryTokenStore();
  await t.save({ access: 'a', refresh: 'r' });
  const onSave = jest.fn();
  const notify = jest.fn();
  const ui: ReactNode = (
    <AiProvider db={(opts.kv ?? optedIn()) as never} api={{ GET, POST } as unknown as ApiClient} tokens={t} signedIn now={NOW}>
      <CustomTagsSheet name="Pec deck" onSave={onSave} onClose={jest.fn()} notify={notify} />
    </AiProvider>
  );
  await render(ui);
  return { GET, POST, onSave, notify };
}
const pressed = (label: string) => !!screen.getByLabelText(label).props.accessibilityState?.selected;
const tap = async (label: string) => fireEvent.press(await screen.findByLabelText(label));

describe('custom exercise tag suggestion', () => {
  it('with AI on, sends only the name, shows the suggestion on the chips and the body map, and saves it as confirmed', async () => {
    const { POST, onSave } = await open();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    expect(POST).toHaveBeenCalledWith('/ai/suggest-tags', expect.objectContaining({ body: { name: 'Pec deck' } }));
    expect(await screen.findByText(/AI’s suggestion/)).toBeTruthy();
    expect(pressed('Main muscle: chest')).toBe(true);
    expect(pressed('Also working: front shoulders')).toBe(true);
    expect(screen.getByLabelText('Muscles worked: chest. Also working: front shoulders')).toBeTruthy();
    await tap('Add Pec deck with these muscles');
    expect(onSave).toHaveBeenCalledWith({ pattern: 'fly', family: 'custom', equipment: 'cable', difficulty: 1, primary: ['chest'], secondary: ['front-delt'], joints: ['shoulder'] });
  });

  it('lets the user correct the suggestion, and the body map follows', async () => {
    const { onSave } = await open();
    await tap('Main muscle: triceps');
    expect(screen.getByLabelText('Muscles worked: chest and triceps. Also working: front shoulders')).toBeTruthy();
    await tap('Main muscle: chest');
    expect(screen.getByLabelText('Muscles worked: triceps. Also working: front shoulders')).toBeTruthy();
    await tap('Add Pec deck with these muscles');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ primary: ['triceps'], pattern: 'fly' }));
  });

  it('with no consent, asks nothing and gives the manual sheet with the prototype fallback tags', async () => {
    const { POST, GET, onSave } = await open({ kv: kvDb({ [KEY_USER]: 'u1' }) });
    expect(await screen.findByText(/Tap the muscles this exercise trains/)).toBeTruthy();
    expect(screen.getByLabelText('Muscles worked: none')).toBeTruthy();
    await tap('Main muscle: quads');
    await tap('Add Pec deck with these muscles');
    expect(onSave).toHaveBeenCalledWith({ ...FALLBACK_TAGS, primary: ['quads'] });
    expect(POST).not.toHaveBeenCalled();
    expect(GET).not.toHaveBeenCalled();
    expect(screen.queryByText(/switched off|used today/)).toBeNull();
  });

  it.each([
    ['off on the server', false],
    ['not sent by the server', undefined],
  ])('with the feature %s, asks nothing', async (_n, flag) => {
    const get = jest.fn(async () => ({ data: status(flag), response: res(200) }));
    const { POST } = await open({ get });
    await waitFor(() => expect(get).toHaveBeenCalled());
    await screen.findByText(/Tap the muscles this exercise trains/);
    expect(POST).not.toHaveBeenCalled();
    expect(screen.queryByText(/switched off|used today/)).toBeNull();
  });

  it('with the quota used up, asks nothing and stays manual', async () => {
    const get = jest.fn(async () => ({ data: status(true, { ...QUOTA, remaining: 0 }), response: res(200) }));
    const { POST } = await open({ get });
    await waitFor(() => expect(get).toHaveBeenCalled());
    await screen.findByText(/Tap the muscles this exercise trains/);
    expect(POST).not.toHaveBeenCalled();
    expect(screen.queryByText(/switched off|used today/)).toBeNull();
  });

  it.each([
    ['quota exceeded', 429, { code: 'quota_exceeded', message: 'x', quota: { ...QUOTA, remaining: 0 } }, /used today’s AI answers/],
    ['switched off after the status read', 503, { code: 'feature_disabled', message: 'x' }, /switched off right now/],
    ['unavailable', 503, { code: 'unavailable', message: 'x' }, /Couldn’t get an answer/],
  ])('on %s, says so and the manual sheet still saves', async (_n, code, error, msg) => {
    const post = jest.fn(async () => ({ error, response: res(code) }));
    const { onSave } = await open({ post });
    expect(await screen.findByText(msg)).toBeTruthy();
    expect(screen.getByText(/Tap the muscles this exercise trains/)).toBeTruthy();
    await tap('Main muscle: abs');
    await tap('Add Pec deck with these muscles');
    expect(onSave).toHaveBeenCalledWith({ ...FALLBACK_TAGS, primary: ['abs'] });
  });

  it('on a network failure, falls back to manual', async () => {
    const post = jest.fn(async () => {
      throw new TypeError('network');
    });
    await open({ post });
    expect(await screen.findByText(/No connection/)).toBeTruthy();
    expect(screen.getByLabelText('Main muscle: chest')).toBeTruthy();
  });

  it('a reply with no known main muscle is no suggestion', async () => {
    const post = jest.fn(async () => ({ data: { ...SUGGESTION, primary: [] }, response: res(200) }));
    const { onSave, notify } = await open({ post });
    await waitFor(() => expect(post).toHaveBeenCalled());
    await screen.findByText(/Tap the muscles this exercise trains/);
    await tap('Add Pec deck with these muscles');
    expect(onSave).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Pick at least one main muscle.');
  });

  it('shows the working hint while the suggestion is out, and Cancel stays available', async () => {
    const post = jest.fn(() => new Promise(() => undefined));
    await open({ post });
    expect(await screen.findByText(/Working out which muscles/)).toBeTruthy();
    expect(screen.getByLabelText('Cancel')).toBeTruthy();
  });
});

describe('custom exercise tag suggestion timing', () => {
  it('a status read that lands after the user picked a muscle does not ask or overwrite their picks', async () => {
    let release: (v: unknown) => void = () => undefined;
    const get = jest.fn(() => new Promise((r) => (release = r)));
    const { POST, onSave } = await open({ get });
    await tap('Main muscle: quads');
    release({ data: status(true), response: res(200) });
    await waitFor(() => expect(get).toHaveBeenCalled());
    await tap('Add Pec deck with these muscles');
    expect(POST).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledWith({ ...FALLBACK_TAGS, primary: ['quads'] });
  });

  it('an answer that arrives after the sheet closed is dropped without error', async () => {
    let answer: (v: unknown) => void = () => undefined;
    const post = jest.fn(() => new Promise((r) => (answer = r)));
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await open({ post });
    await waitFor(() => expect(post).toHaveBeenCalled());
    screen.unmount();
    answer({ data: SUGGESTION, response: res(200) });
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it.each([
    ['rate limited', 429, { code: 'rate_limited', message: 'x' }],
    ['rejected', 400, { code: 'invalid_request', message: 'x' }],
  ])('when %s, does not tell the user to try again', async (_n, code, error) => {
    const post = jest.fn(async () => ({ error, response: res(code, { 'Retry-After': '30' }) }));
    await open({ post });
    expect(await screen.findByText(/Couldn’t get a suggestion right now. Tap the muscles/)).toBeTruthy();
    expect(screen.queryByText(/try again|Shorten/i)).toBeNull();
  });
});

describe('tagsFromSuggestion', () => {
  const base = SUGGESTION;
  it('keeps a good reply as it is', () => {
    expect(tagsFromSuggestion(base)).toEqual({ pattern: 'fly', family: 'custom', equipment: 'cable', difficulty: 1, primary: ['chest'], secondary: ['front-delt'], joints: ['shoulder'] });
  });
  it('replaces an unknown pattern, equipment or difficulty with the prototype fallback', () => {
    const t = tagsFromSuggestion({ ...base, pattern: 'toString', equipment: 'other' as never, difficulty: 7 });
    expect(t).toMatchObject({ pattern: 'h-press', equipment: 'machine', difficulty: 2 });
  });
  it('drops unknown or repeated muscles and joints and caps muscles at three each', () => {
    const t = tagsFromSuggestion({ ...base, primary: ['chest', 'chest', 'nose', 'triceps', 'biceps', 'lats'] as never, secondary: ['abs', 'hams', 'quads', 'calves'], joints: ['elbow', 'elbow', 'toe', 'constructor'] });
    expect(t).toMatchObject({ primary: ['chest', 'triceps', 'biceps'], secondary: ['abs', 'hams', 'quads'], joints: ['elbow'] });
  });
  it('is null with no known main muscle', () => {
    expect(tagsFromSuggestion({ ...base, primary: ['nose'] as never })).toBeNull();
  });
});
