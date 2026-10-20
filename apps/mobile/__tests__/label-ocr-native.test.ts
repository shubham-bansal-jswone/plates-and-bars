import { OcrError, mapOcrError } from '../modules/plate-label-scanner/errors';

// The Android wrapper (#1067): the native module is stood in for, and looked up only when a scan is asked for with the flag on.
const mockRecognize = jest.fn();
const mockVerify = jest.fn();
const mockRequire = jest.fn((_name: string) => ({ recognize: mockRecognize, verifyData: mockVerify }));
jest.mock('expo', () => ({ requireNativeModule: (name: string) => mockRequire(name) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const load = () => require('../modules/plate-label-scanner') as typeof import('../modules/plate-label-scanner');

const IMAGE = 'content://media/picker/0/label-1234.jpg';

describe('the native wrapper', () => {
  const saved = process.env.EXPO_PUBLIC_LABEL_SCAN;
  beforeEach(() => {
    jest.resetModules();
    mockRecognize.mockReset();
    mockVerify.mockReset();
    mockRequire.mockClear();
    process.env.EXPO_PUBLIC_LABEL_SCAN = '1';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_LABEL_SCAN;
    else process.env.EXPO_PUBLIC_LABEL_SCAN = saved;
  });

  it('flag off: refuses with `disabled` and never looks the native module up', async () => {
    delete process.env.EXPO_PUBLIC_LABEL_SCAN;
    const m = load();
    await expect(m.recognize(IMAGE)).rejects.toMatchObject({ name: 'OcrError', code: 'disabled' });
    await expect(m.verifyData()).rejects.toMatchObject({ code: 'disabled' });
    expect(mockRequire).not.toHaveBeenCalled();
    expect(mockRecognize).not.toHaveBeenCalled();
  });

  it('importing the module with the flag on still loads nothing until a scan', () => {
    load();
    expect(mockRequire).not.toHaveBeenCalled();
  });

  it('passes the address and no crop as null, and returns lines with confidence and the time', async () => {
    mockRecognize.mockResolvedValue({
      lines: [
        { text: 'Protein 12.5 g', confidence: 91.5, box: { x: 4, y: 10, width: 200, height: 20 }, words: [{ text: 'Protein', confidence: 95, box: { x: 4, y: 10, width: 70, height: 20 } }, { text: '12.5', confidence: 88 }, { text: 'g', confidence: 91 }] },
        { text: '   ', confidence: 10 },
      ],
      ms: 812.4,
    });
    const r = await load().recognize(IMAGE);
    expect(mockRequire).toHaveBeenCalledWith('PlateLabelScanner');
    expect(mockRecognize).toHaveBeenCalledWith(IMAGE, null);
    expect(r.ms).toBe(812);
    expect(r.lines).toEqual([
      { text: 'Protein 12.5 g', confidence: 91.5, box: { x: 4, y: 10, width: 200, height: 20 }, words: [{ text: 'Protein', confidence: 95, box: { x: 4, y: 10, width: 70, height: 20 } }, { text: '12.5', confidence: 88 }, { text: 'g', confidence: 91 }] },
    ]);
  });

  it('passes the crop as given and holds confidence to 0..100', async () => {
    mockRecognize.mockResolvedValue({ lines: [{ text: 'Fat', confidence: 250, words: [{ text: 'Fat', confidence: -5 }] }], ms: 5 });
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    const r = await load().recognize(IMAGE, crop);
    expect(mockRecognize).toHaveBeenCalledWith(IMAGE, crop);
    expect(r.lines).toEqual([{ text: 'Fat', confidence: 100, words: [{ text: 'Fat', confidence: 0 }] }]);
  });

  it('an empty page is an empty list, not an error', async () => {
    mockRecognize.mockResolvedValue({ lines: [], ms: 40 });
    expect(await load().recognize(IMAGE)).toEqual({ lines: [], ms: 40 });
  });

  it('an answer that is not a result is an `engine` error', async () => {
    mockRecognize.mockResolvedValue('nope');
    await expect(load().recognize(IMAGE)).rejects.toMatchObject({ code: 'engine' });
  });

  it('verifyData returns what the native side checked', async () => {
    mockVerify.mockResolvedValue({ sha256: 'ab', bytes: 3 });
    expect(await load().verifyData()).toEqual({ sha256: 'ab', bytes: 3 });
  });

  it.each([
    ['ERR_OCR_IMAGE', 'image'],
    ['ERR_OCR_CROP', 'crop'],
    ['ERR_OCR_MEMORY', 'memory'],
    ['ERR_OCR_ENGINE', 'engine'],
    ['ERR_OCR_NO_CONTEXT', 'engine'],
    ['ERR_OCR_DATA_HASH', 'data'],
    ['ERR_OCR_DATA', 'data'],
  ])('maps the native code %s to `%s`', async (nativeCode, code) => {
    mockRecognize.mockRejectedValue(Object.assign(new Error(`failed on ${IMAGE}`), { code: nativeCode }));
    const e = (await load().recognize(IMAGE).catch((x: unknown) => x)) as OcrError;
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('OcrError');
    expect(e.code).toBe(code);
    expect(e.message).not.toContain('label-1234'); // the address never reaches an error report
  });

  it('a missing native module (a build without it, iOS) is `unsupported`', async () => {
    mockRequire.mockImplementationOnce(() => {
      throw new Error("Cannot find native module 'PlateLabelScanner'");
    });
    await expect(load().recognize(IMAGE)).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('any other failure is `failed`, with fixed text that carries nothing of the original', async () => {
    mockRecognize.mockRejectedValue(new Error('java.lang.RuntimeException: Protein 12.5 g at /data/user/0/x'));
    const e = (await load().recognize(IMAGE).catch((x: unknown) => x)) as OcrError;
    expect(e.code).toBe('failed');
    expect(e.message).toBe('The label could not be read.');
  });
});

describe('mapOcrError', () => {
  it('passes an OcrError through unchanged', () => {
    const e = new OcrError('crop');
    expect(mapOcrError(e)).toBe(e);
  });
  it('handles things that are not errors', () => {
    expect(mapOcrError(undefined).code).toBe('failed');
    expect(mapOcrError('x').code).toBe('failed');
    expect(mapOcrError(null).code).toBe('failed');
    expect(mapOcrError({ code: 42 }).code).toBe('failed');
  });
});
