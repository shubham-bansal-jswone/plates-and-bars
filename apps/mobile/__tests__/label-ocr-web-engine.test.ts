import { createEngine } from '../src/labelscan/tesseract-engine';
import { CORE_PATH, LANG_PATH, WORKER_PATH } from '../src/labelscan/webAssets';
// The tesseract.js wrapper (#1067): every path is our own, and the page tree is flattened to lines of words with boxes.
const mockCreate = jest.fn();
jest.mock('tesseract.js', () => ({ createWorker: (...a: unknown[]) => mockCreate(...a) }));


const word = (text: string, conf: number, x0: number) => ({ text, confidence: conf, bbox: { x0, y0: 10, x1: x0 + 30, y1: 30 } });

describe('createEngine', () => {
  it('starts the worker with our own worker, core and language paths, no cache, no blob worker', async () => {
    mockCreate.mockResolvedValue({ recognize: jest.fn(), terminate: jest.fn() });
    await createEngine();
    const [lang, oem, opts] = mockCreate.mock.calls[0] as [string, number, Record<string, unknown>];
    expect(lang).toBe('eng');
    expect(oem).toBe(1);
    expect(opts).toMatchObject({ workerPath: WORKER_PATH, corePath: CORE_PATH, langPath: LANG_PATH, workerBlobURL: false, gzip: false, cacheMethod: 'none' });
    for (const p of [WORKER_PATH, CORE_PATH, LANG_PATH]) expect(p).toMatch(/^\/tesseract\//); // same origin, never http(s)
  });

  it('flattens blocks to lines with words, boxes and mean confidence, skipping blank words', async () => {
    const recognize = jest.fn().mockResolvedValue({
      data: { blocks: [{ paragraphs: [{ lines: [{ bbox: { x0: 0, y0: 10, x1: 100, y1: 30 }, words: [word('Energy', 90, 0), word(' ', 10, 40), word('250', 70, 60)] }, { bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words: [word('', 0, 0)] }] }] }] },
    });
    mockCreate.mockResolvedValue({ recognize, terminate: jest.fn() });
    const lines = await (await createEngine()).recognize(new Blob(['x']));
    expect(recognize.mock.calls[0]![2]).toEqual({ blocks: true });
    expect(lines).toEqual([
      { text: 'Energy 250', confidence: 80, box: { x: 0, y: 10, width: 100, height: 20 }, words: [{ text: 'Energy', confidence: 90, box: { x: 0, y: 10, width: 30, height: 20 } }, { text: '250', confidence: 70, box: { x: 60, y: 10, width: 30, height: 20 } }] },
    ]);
  });

  it('no blocks is no lines, and terminate stops the worker', async () => {
    const terminate = jest.fn().mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({ recognize: jest.fn().mockResolvedValue({ data: { blocks: null } }), terminate });
    const e = await createEngine();
    expect(await e.recognize(new Blob(['x']))).toEqual([]);
    await e.terminate();
    expect(terminate).toHaveBeenCalled();
  });
});
