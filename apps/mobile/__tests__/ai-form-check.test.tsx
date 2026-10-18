import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ApiClient } from '@plate-and-bar/api';
import { AiProvider, KEY_AI_CONSENT, useAi } from '../src/ai/AiProvider';
import { IMAGE_ISSUES } from '../src/ai/client';
import { FRAME_ISSUE_MESSAGE } from '../src/ai/copy';
import { ExerciseCard, type Actions } from '../src/workout/ExerciseCard';
import { FormCheckButton } from '../src/ai/FormCheck';
import { frameTimes } from '../src/ai/frames';
import { exInfo } from '@plate-and-bar/core';
import { getCatalog } from '../src/workout/catalog';
import { blankRow, type ExState } from '../src/workout/model';
import { memoryTokenStore } from '../src/sync/tokens';
import { KEY_USER } from '../src/sync/store';

// Form check (#946): hidden unless the server says on, consent is given and the exercise is in the catalogue; only frames (never
// the video) are sent; the checks and summary are shown verbatim; every failure maps to the fallback copy.
const CACHE = 'file:///data/user/0/app/cache/';
const mockPicker = { granted: true, video: null as unknown, photos: null as unknown, camera: null as unknown, calls: [] as string[] };
const mockSaved = { base64: ['cmVzaXplZA=='] as string[], ops: [] as string[], deleted: [] as string[], cuts: [] as { uri: string; time: number }[] };

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: async () => ({ granted: mockPicker.granted }),
  launchCameraAsync: async () => (mockPicker.calls.push('camera'), mockPicker.camera),
  launchImageLibraryAsync: async (o: { mediaTypes: string[] }) => (mockPicker.calls.push(o.mediaTypes[0] === 'videos' ? 'video' : 'photos'), o.mediaTypes[0] === 'videos' ? mockPicker.video : mockPicker.photos),
}));
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: async (uri: string, o: { time: number }) => (mockSaved.cuts.push({ uri, time: o.time }), { uri: `${CACHE}VideoThumbnails/t-${o.time}.jpg`, width: 1080, height: 1920 }),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (uri: string) => {
      mockSaved.ops.push(`manipulate ${uri}`);
      const ctx = {
        resize: (s: object) => (mockSaved.ops.push(`resize ${JSON.stringify(s)}`), ctx),
        renderAsync: async () => ({
          saveAsync: async (o: { compress: number; format: string; base64: boolean }) => {
            mockSaved.ops.push(`save ${o.compress} ${o.format} ${o.base64}`);
            return { uri: `${CACHE}ImageManipulator/out-${mockSaved.ops.length}.jpg`, base64: mockSaved.base64[Math.min(mockSaved.ops.filter((x) => x.startsWith('save')).length - 1, mockSaved.base64.length - 1)] };
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
type Flags = Partial<Record<'describe_meal' | 'ask_why' | 'weekly_summary' | 'form_check', boolean>>;
const status = (f: Flags = {}, quota = QUOTA) => ({ features: { describe_meal: false, ask_why: false, weekly_summary: false, ...f }, quota });
const res = (s: number, h: Record<string, string> = {}) => ({ status: s, headers: { get: (k: string) => h[k] ?? null } }) as unknown as Response;
const asset = (uri: string, width = 3000, height = 4000) => ({ uri, width, height });
const photos = (...uris: string[]) => ({ canceled: false, assets: uris.map((u) => asset(u)) });

function kvDb(initial: Record<string, string> = {}) {
  const kv = new Map(Object.entries(initial));
  return {
    kv,
    getFirstAsync: async (_sql: string, key: string) => (kv.has(key) ? { value: kv.get(key) } : null),
    runAsync: async (sql: string, key: string, value?: string) => void (sql.startsWith('DELETE') ? kv.delete(key) : kv.set(key, value!)),
  };
}
const optedIn = () => kvDb({ [KEY_USER]: 'u1', [KEY_AI_CONSENT]: 'u1' });
function fakeApi(flags: Flags = { form_check: true }, quota = QUOTA) {
  const GET: jest.Mock = jest.fn(async () => ({ data: status(flags, quota), response: res(200) }));
  const POST: jest.Mock = jest.fn(async () => ({ error: { code: 'internal', message: 'x' }, response: res(500) }));
  return { api: { GET, POST } as unknown as ApiClient, GET, POST };
}
const tokens = async () => {
  const t = memoryTokenStore();
  await t.save({ access: 'a', refresh: 'r' });
  return t;
};


const CARD = 'Goblet Squat';
const CUES = getCatalog().cards[CARD]!.key_cues;
const act = new Proxy({}, { get: () => jest.fn() }) as Actions;
const state = (name: string): ExState => ({ name, part: 1, bridge: false, form: null, found: null, skipRamp: false, feel: null, ramp: [], sets: [{ ...blankRow() }], ...{} });
async function card(kv: ReturnType<typeof kvDb>, api: ApiClient, name = CARD, signedIn = true) {
  const t = await tokens();
  await render(
    <AiProvider db={kv as never} api={api} tokens={t} signedIn={signedIn} now={NOW}>
      <ExerciseCard ex={state(name)} info={exInfo(name, getCatalog())} sug={{ mode: 'new', reps: 8, text: '', reason: '' }} focus={[]} warm={null} act={act} infoOf={(n) => exInfo(n, getCatalog())} />
    </AiProvider>,
  );
}
const REPLY = {
  visible: true,
  checks: [
    { cue: CUES[0], status: 'good', note: '' },
    { cue: CUES[1], status: 'watch', note: 'Your knees drift in a little on the way up.' },
    { cue: CUES[2], status: 'unclear', note: '' },
  ],
  summary: 'Depth and chest position look solid. Focus on pushing your knees out as you stand.',
};
const ok = (over: object = {}) => ({ data: { ...REPLY, quota: { ...QUOTA, remaining: 6 }, ...over }, response: res(200) });

beforeEach(() => {
  mockPicker.granted = true;
  mockPicker.calls = [];
  mockPicker.video = { canceled: false, assets: [{ uri: `${CACHE}ImagePicker/set.mp4`, width: 1080, height: 1920, duration: 20000 }] };
  mockPicker.photos = photos(`${CACHE}ImagePicker/1.jpg`, `${CACHE}ImagePicker/2.jpg`, `${CACHE}ImagePicker/3.jpg`);
  mockPicker.camera = photos(`${CACHE}ImagePicker/cam.jpg`);
  mockSaved.base64 = ['cmVzaXplZA=='];
  mockSaved.ops = [];
  mockSaved.deleted = [];
  mockSaved.cuts = [];
});

const open = async () => fireEvent.press(await screen.findByLabelText(`Check my form on ${CARD}`));
const chooseVideo = async () => fireEvent.press(await screen.findByLabelText('Choose a video'));
const run = async () => fireEvent.press(await screen.findByLabelText('Get a second opinion'));
const sentFrames = (POST: jest.Mock) => POST.mock.calls[0][1].body.frames as { media_type: string; data: string }[];

describe('hidden states', () => {
  it('shows no entry point and sends nothing without consent, even with the server on', async () => {
    const { api, GET, POST } = fakeApi();
    await card(kvDb({ [KEY_USER]: 'u1' }), api);
    expect(screen.queryByLabelText(`Check my form on ${CARD}`)).toBeNull();
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  it('shows no entry point when the server reports Form check off or does not send the flag', async () => {
    const { api, GET } = fakeApi({ describe_meal: true });
    await card(optedIn(), api);
    await waitFor(() => expect(GET).toHaveBeenCalledWith('/ai/status', expect.anything()));
    expect(screen.queryByLabelText(`Check my form on ${CARD}`)).toBeNull();
  });

  it('signed out: no entry point and nothing sent', async () => {
    const { api, GET, POST } = fakeApi();
    await card(optedIn(), api, CARD, false);
    expect(screen.queryByLabelText(`Check my form on ${CARD}`)).toBeNull();
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
  });

  it('shows the entry point on a catalogue exercise once on, and not on a custom exercise', async () => {
    const { api, GET } = fakeApi();
    const t = await tokens();
    await render(
      <AiProvider db={optedIn() as never} api={api} tokens={t} signedIn now={NOW}>
        <FormCheckButton name="My custom lift" />
        <FormCheckButton name={CARD} />
      </AiProvider>,
    );
    expect(await screen.findByLabelText(`Check my form on ${CARD}`)).toBeTruthy();
    await waitFor(() => expect(GET).toHaveBeenCalled());
    expect(screen.queryByLabelText('Check my form on My custom lift')).toBeNull();
    // Names that are not own keys of the cards never count.
    for (const n of ['constructor', '__proto__', 'toString']) expect(Object.prototype.hasOwnProperty.call(getCatalog().cards, n)).toBe(false);
  });

  it('network stub: no frame is ever sent while the feature is off, whatever calls the provider', async () => {
    const probe: { call: ((e: string, f: { media_type: 'image/jpeg'; data: string }[]) => Promise<{ kind: string }>) | null } = { call: null };
    function Probe() {
      const ai = useAi();
      useEffect(() => {
        probe.call = (e, f) => ai.formCheck(e, f);
      });
      return null;
    }
    const frames = [{ media_type: 'image/jpeg' as const, data: 'cmVzaXplZA==' }, { media_type: 'image/jpeg' as const, data: 'cmVzaXplZA==' }];
    for (const [kv, flags] of [[kvDb({ [KEY_USER]: 'u1' }), { form_check: true }], [optedIn(), { describe_meal: true }], [optedIn(), {}]] as const) {
      const { api, POST } = fakeApi(flags);
      const t = await tokens();
      const view = await render(<AiProvider db={kv as never} api={api} tokens={t} signedIn now={NOW}><Probe /></AiProvider>);
      await waitFor(() => expect(probe.call).toBeTruthy());
      expect((await probe.call!(CARD, frames)).kind).toBe('disabled');
      await new Promise((r) => setTimeout(r, 0));
      expect((await probe.call!(CARD, frames)).kind).toBe('disabled');
      expect(POST).not.toHaveBeenCalled();
      view.unmount();
    }
  });
});

describe('frames', () => {
  it('cuts four frames from 12% to 88% of the clip, evenly (the prototype)', () => {
    expect(frameTimes(20000, 4)).toEqual([2400, 7467, 12533, 17600]);
    expect(frameTimes(20000, 2)).toEqual([2400, 17600]);
    expect(frameTimes(NaN, 4)).toEqual(frameTimes(5000, 4));
    expect(frameTimes(0, 1)).toEqual([600]);
  });
});

describe('the flow', () => {
  it('a video becomes four small frames; only the frames are sent, with the exercise name, and the video file is deleted', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok());
    await card(optedIn(), api);
    await open();
    await chooseVideo();
    expect(await screen.findByLabelText('Frame 4 from your set')).toBeTruthy();
    expect(mockSaved.cuts).toEqual([2400, 7467, 12533, 17600].map((time) => ({ uri: `${CACHE}ImagePicker/set.mp4`, time })));
    // Each cut is shrunk to 640 px, at JPEG 0.75, then deleted along with the video.
    expect(mockSaved.ops.filter((o) => o.startsWith('resize'))).toEqual(Array(4).fill('resize {"height":640}'));
    expect(mockSaved.ops.filter((o) => o.startsWith('save'))).toEqual(Array(4).fill('save 0.75 jpeg true'));
    expect(mockSaved.deleted).toContain(`${CACHE}ImagePicker/set.mp4`);
    expect(mockSaved.deleted.filter((u) => u.includes('VideoThumbnails'))).toHaveLength(4);
    expect(POST).not.toHaveBeenCalled();
    await run();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    expect(POST.mock.calls[0][0]).toBe('/ai/form-check');
    expect(Object.keys(POST.mock.calls[0][1].body).sort()).toEqual(['exercise', 'frames']);
    expect(POST.mock.calls[0][1].body.exercise).toBe(CARD);
    expect(sentFrames(POST)).toEqual(Array(4).fill({ media_type: 'image/jpeg', data: 'cmVzaXplZA==' }));
    // Nothing in the body is the video: no uri, no file.
    expect(JSON.stringify(POST.mock.calls[0][1].body)).not.toMatch(/mp4|file:/);
  });

  it('shows each check verbatim with its status, the summary and the not-a-coach note', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok());
    await card(optedIn(), api);
    await open();
    await chooseVideo();
    await screen.findByLabelText('Frame 1 from your set');
    await run();
    expect(await screen.findByText('Second opinion')).toBeTruthy();
    expect(screen.getByLabelText(`Looks good: ${CUES[0]}`)).toBeTruthy();
    expect(screen.getByLabelText(`Watch this: ${CUES[1]}. Your knees drift in a little on the way up.`)).toBeTruthy();
    expect(screen.getByLabelText(`Can’t tell: ${CUES[2]}`)).toBeTruthy();
    expect(screen.getByText(`${CUES[1]}: Your knees drift in a little on the way up.`)).toBeTruthy();
    expect(screen.getByText(REPLY.summary)).toBeTruthy();
    expect(screen.getByText(/Second opinion, not a coach\./)).toBeTruthy();
  });

  it('photos: two to four, in the order picked, are the frames; a camera photo adds one', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok());
    await card(optedIn(), api);
    await open();
    await fireEvent.press(await screen.findByLabelText('Choose 2 to 4 photos'));
    expect(await screen.findByText('3 frames ready. Only these are sent.')).toBeTruthy();
    expect(mockPicker.calls).toEqual(['photos']);
    await fireEvent.press(screen.getByLabelText('Take a photo'));
    expect(await screen.findByText('4 frames ready. Only these are sent.')).toBeTruthy();
    await run();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    expect(sentFrames(POST)).toHaveLength(4);
  });

  it('with fewer than two frames there is no way to send', async () => {
    const { api, POST } = fakeApi();
    mockPicker.photos = photos(`${CACHE}ImagePicker/1.jpg`);
    await card(optedIn(), api);
    await open();
    await fireEvent.press(await screen.findByLabelText('Choose 2 to 4 photos'));
    expect(await screen.findByText('Choose at least 2 photos.')).toBeTruthy();
    expect(screen.queryByLabelText('Get a second opinion')).toBeNull();
    expect(POST).not.toHaveBeenCalled();
  });

  it('more than four photos keep the first four', async () => {
    const { api } = fakeApi();
    mockPicker.photos = photos(...[1, 2, 3, 4, 5].map((n) => `${CACHE}ImagePicker/${n}.jpg`));
    await card(optedIn(), api);
    await open();
    await fireEvent.press(await screen.findByLabelText('Choose 2 to 4 photos'));
    expect(await screen.findByText('4 frames ready. Only these are sent.')).toBeTruthy();
  });

  it('a body not in view asks for a side view, with no checks', async () => {
    const { api, POST } = fakeApi();
    POST.mockResolvedValue(ok({ visible: false, checks: [], summary: '' }));
    await card(optedIn(), api);
    await open();
    await chooseVideo();
    await screen.findByLabelText('Frame 1 from your set');
    await run();
    expect(await screen.findByText('Your body wasn’t clearly in view. Try a side view with your whole body in frame.')).toBeTruthy();
  });

  it('the cue checklist is always there, and ticks', async () => {
    const { api } = fakeApi();
    await card(optedIn(), api);
    await open();
    const box = await screen.findByRole('checkbox', { name: CUES[0] });
    expect(box.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(box);
    expect(screen.getByRole('checkbox', { name: CUES[0] }).props.accessibilityState.checked).toBe(true);
  });

  it('the camera permission being off says so; cancelling changes nothing; an unreadable video says to try a shorter clip', async () => {
    const { api, POST } = fakeApi();
    await card(optedIn(), api);
    await open();
    mockPicker.granted = false;
    await fireEvent.press(await screen.findByLabelText('Take a photo'));
    expect(await screen.findByText('Camera access is off. Allow it in Settings, or choose a photo instead.')).toBeTruthy();
    mockPicker.video = { canceled: true, assets: null };
    await chooseVideo();
    expect(screen.queryByLabelText('Frame 1 from your set')).toBeNull();
    mockPicker.video = { canceled: false, assets: [{ uri: `${CACHE}ImagePicker/bad.mp4`, width: 1, height: 1, duration: 1000 }] };
    mockSaved.base64 = ['x'.repeat(466_700)];
    await chooseVideo();
    expect(await screen.findByText('Couldn’t read frames from that video. Try a shorter clip (under a minute) in MP4.')).toBeTruthy();
    expect(mockSaved.deleted).toContain(`${CACHE}ImagePicker/bad.mp4`);
    expect(POST).not.toHaveBeenCalled();
  });

  it('sends one request while one is pending', async () => {
    const { api, POST } = fakeApi();
    let done!: (v: unknown) => void;
    POST.mockReturnValue(new Promise((r) => (done = r)));
    await card(optedIn(), api);
    await open();
    await chooseVideo();
    await screen.findByLabelText('Frame 1 from your set');
    await run();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getAllByLabelText('Get a second opinion')[0]!);
    expect(POST).toHaveBeenCalledTimes(1);
    await (async () => done(ok()))();
    expect(await screen.findByText('Second opinion')).toBeTruthy();
  });
});

describe('failures fall back and say so', () => {
  const failWith = async (reply: unknown, quota = QUOTA) => {
    const { api, POST } = fakeApi({ form_check: true }, quota);
    POST.mockResolvedValue(reply);
    await card(optedIn(), api);
    await open();
    await chooseVideo();
    await screen.findByLabelText('Frame 1 from your set');
    await run();
    return POST;
  };

  it('503 feature_disabled shows the switched-off message with the cue checklist as the fallback', async () => {
    await failWith({ error: { code: 'feature_disabled', message: 'x' }, response: res(503) });
    expect(await screen.findByText('AI features are switched off right now. The cue checklist still works.')).toBeTruthy();
  });

  it('503 unavailable says to try again', async () => {
    await failWith({ error: { code: 'unavailable', message: 'x' }, response: res(503) });
    expect(await screen.findByText('Couldn’t get an answer, try again. The cue checklist still works.')).toBeTruthy();
  });

  it('429 rate_limited says to wait a minute', async () => {
    await failWith({ error: { code: 'rate_limited', message: 'x' }, response: res(429, { 'Retry-After': '30' }) });
    expect(await screen.findByText('Too many requests right now. Wait a minute and try again.')).toBeTruthy();
  });

  it('429 quota_exceeded shows the quota message and no run button', async () => {
    await failWith({ error: { code: 'quota_exceeded', message: 'x', quota: { ...QUOTA, remaining: 0 } }, response: res(429) });
    expect(await screen.findByText(/You’ve used today’s AI answers\. They come back at .* The cue checklist still works\./)).toBeTruthy();
    expect(screen.queryByLabelText('Get a second opinion')).toBeNull();
  });

  it('a used-up quota shows the message and sends nothing', async () => {
    const { api, POST } = fakeApi({ form_check: true }, { ...QUOTA, remaining: 0 });
    await card(optedIn(), api);
    await open();
    await chooseVideo();
    expect(await screen.findByText(/You’ve used today’s AI answers/)).toBeTruthy();
    expect(screen.queryByLabelText('Get a second opinion')).toBeNull();
    expect(POST).not.toHaveBeenCalled();
  });

  it('offline says so', async () => {
    const { api, POST } = fakeApi();
    POST.mockRejectedValue(new TypeError('Network request failed'));
    await card(optedIn(), api);
    await open();
    await chooseVideo();
    await screen.findByLabelText('Frame 1 from your set');
    await run();
    expect(await screen.findByText('No connection. The cue checklist still works.')).toBeTruthy();
  });

  it.each(IMAGE_ISSUES.map((i) => [i]))('400 on a frame with issue %s names the frame and gets its friendly message', async (issue) => {
    await failWith({ error: { code: 'invalid_request', message: 'x', details: [{ field: 'frames[1].data', issue }] }, response: res(400) });
    expect(await screen.findByText(`Frame 2: ${FRAME_ISSUE_MESSAGE[issue]}`)).toBeTruthy();
    expect(screen.queryByText(/frames\[1\]/)).toBeNull();
  });

  it('a 400 naming no frame still gets the frame message; one on the exercise says the check is not available for it', async () => {
    await failWith({ error: { code: 'invalid_request', message: 'x', details: [{ field: '', issue: 'too_large' }] }, response: res(400) });
    expect(await screen.findByText(FRAME_ISSUE_MESSAGE.too_large)).toBeTruthy();
    await screen.unmount();
    await failWith({ error: { code: 'invalid_request', message: 'x', details: [{ field: 'exercise', issue: 'must be one of the exercise cards' }] }, response: res(400) });
    expect(await screen.findByText('Form check isn’t available for this exercise. The cue checklist still works.')).toBeTruthy();
  });

  it('a 400 with an unknown issue gets the generic message', async () => {
    await failWith({ error: { code: 'invalid_request', message: 'x', details: [{ field: 'frames', issue: 'minItems' }] }, response: res(400) });
    expect(await screen.findByText('That wasn’t accepted. Try a different clip or photos.')).toBeTruthy();
  });
});
