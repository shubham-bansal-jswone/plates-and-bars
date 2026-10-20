/** @jest-environment node */
import { JSDOM } from 'jsdom';
import type { Engine } from '../src/labelscan/tesseract-engine';

// The web wrapper (#1067): same API as Android; flag off loads nothing; the engine is stopped after each scan; no network request.
const mockLoad = jest.fn();
jest.mock('../src/labelscan/webLoad', () => ({ loadEngine: () => mockLoad() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const load = () => require('../modules/plate-label-scanner/index.web') as typeof import('../modules/plate-label-scanner/index.web');

const g = globalThis as Record<string, unknown>;
const KEYS = ['window', 'document', 'Image', 'fetch'];
let saved: Record<string, unknown>;
const fetchMock = jest.fn();
let imageOk = true;
let draws: number[][] = [];
let canvasSize: { width: number; height: number }[] = [];

beforeEach(() => {
  jest.resetModules();
  mockLoad.mockReset();
  fetchMock.mockReset();
  draws = [];
  canvasSize = [];
  imageOk = true;
  saved = Object.fromEntries(KEYS.map((k) => [k, g[k]]));
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' });
  const doc = dom.window.document;
  const realCreate = doc.createElement.bind(doc);
  doc.createElement = ((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag);
    const c = { width: 0, height: 0, getContext: () => ({ drawImage: (...a: number[]) => draws.push(a.slice(1)) }), toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['png'])) };
    canvasSize.push(c);
    return c;
  }) as typeof doc.createElement;
  g.window = dom.window;
  g.document = doc;
  g.fetch = fetchMock;
  g.Image = class {
    naturalWidth = 4000;
    naturalHeight = 3000;
    src = '';
    decode() {
      return imageOk ? Promise.resolve() : Promise.reject(new Error('bad'));
    }
  };
  process.env.EXPO_PUBLIC_LABEL_SCAN = '1';
});
afterEach(() => {
  for (const k of KEYS) g[k] = saved[k];
  delete process.env.EXPO_PUBLIC_LABEL_SCAN;
});

const engine = (lines = [{ text: 'Fat 3 g', confidence: 80, words: [{ text: 'Fat', confidence: 90 }, { text: '3', confidence: 70 }, { text: 'g', confidence: 80 }] }]): Engine & { recognize: jest.Mock; terminate: jest.Mock } => ({
  recognize: jest.fn().mockResolvedValue(lines),
  terminate: jest.fn().mockResolvedValue(undefined),
});

describe('web recognize', () => {
  it('flag off: refuses before loading anything or touching the image', async () => {
    delete process.env.EXPO_PUBLIC_LABEL_SCAN;
    await expect(load().recognize('blob:https://app.test/x')).rejects.toMatchObject({ code: 'disabled' });
    expect(mockLoad).not.toHaveBeenCalled();
    expect(draws).toEqual([]);
  });

  it('importing the module does not load the engine', () => {
    load();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('crops, downsizes to 2400 on the long side, reads, stops the engine and returns lines', async () => {
    const e = engine();
    mockLoad.mockResolvedValue(async () => e);
    const r = await load().recognize('blob:https://app.test/x', { x: 0, y: 0, width: 1, height: 1 });
    expect(draws[0]).toEqual([0, 0, 4000, 3000, 0, 0, 2400, 1800]);
    expect(r.lines).toEqual([{ text: 'Fat 3 g', confidence: 80, words: [{ text: 'Fat', confidence: 90 }, { text: '3', confidence: 70 }, { text: 'g', confidence: 80 }] }]);
    expect(typeof r.ms).toBe('number');
    expect(e.terminate).toHaveBeenCalledTimes(1);
    expect(canvasSize[0]).toMatchObject({ width: 0, height: 0 }); // pixels dropped
  });

  it('makes no network request while scanning', async () => {
    mockLoad.mockResolvedValue(async () => engine());
    await load().recognize('data:image/png;base64,AAAA');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops the engine when reading fails, and maps the failure', async () => {
    const e = engine();
    e.recognize.mockRejectedValue(new Error('worker said: Protein 12 g'));
    mockLoad.mockResolvedValue(async () => e);
    const err = await load().recognize('blob:https://app.test/x').catch((x: unknown) => x);
    expect(err).toMatchObject({ name: 'OcrError', code: 'failed' });
    expect(e.terminate).toHaveBeenCalled();
  });

  it('an engine that will not load is `engine`', async () => {
    mockLoad.mockRejectedValue(new Error('chunk failed'));
    await expect(load().recognize('blob:https://app.test/x')).rejects.toMatchObject({ code: 'engine' });
    mockLoad.mockResolvedValue(async () => {
      throw new Error('worker 404');
    });
    await expect(load().recognize('blob:https://app.test/x')).rejects.toMatchObject({ code: 'engine' });
  });

  it('an image that will not decode is `image`, and the engine is never fetched', async () => {
    imageOk = false;
    await expect(load().recognize('blob:https://app.test/x')).rejects.toMatchObject({ code: 'image' });
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('a bad crop is `crop`, before the engine is fetched', async () => {
    await expect(load().recognize('blob:https://app.test/x', { x: 0, y: 0, width: 0, height: 1 })).rejects.toMatchObject({ code: 'crop' });
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('refuses an address on another site', async () => {
    await expect(load().recognize('https://evil.example/label.jpg')).rejects.toMatchObject({ code: 'image' });
    await expect(load().recognize('http://[bad')).rejects.toMatchObject({ code: 'image' });
    expect(mockLoad).not.toHaveBeenCalled();
  });
});
