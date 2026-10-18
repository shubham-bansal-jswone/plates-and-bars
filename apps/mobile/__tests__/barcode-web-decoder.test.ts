import { createFrameDecoder, WEB_FORMATS, type DetectorClass } from '../src/barcode/webDecoder';

// The choice between the browser's BarcodeDetector and the zxing-wasm ponyfill, and what a frame read returns (#944).
const frame = {} as HTMLVideoElement;

function detectorClass(supported: string[] | Error | undefined, results: { rawValue: string; format: string }[] | Error = []) {
  const made: { formats: string[] }[] = [];
  const Cls = class {
    constructor(o: { formats: string[] }) {
      made.push(o);
    }
    async detect() {
      if (results instanceof Error) throw results;
      return results;
    }
    static getSupportedFormats = supported === undefined ? undefined : async () => { if (supported instanceof Error) throw supported; return supported; };
  };
  return { Cls: Cls as unknown as DetectorClass, made };
}

describe('which decoder', () => {
  it('uses the browser detector when it lists ean_13, and never loads the ponyfill', async () => {
    const n = detectorClass(['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'code_128']);
    const loadPonyfill = jest.fn();
    const d = await createFrameDecoder({ native: n.Cls, loadPonyfill });
    expect(d.kind).toBe('native');
    expect(loadPonyfill).not.toHaveBeenCalled();
    expect(n.made).toEqual([{ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }]); // EAN and UPC only, not QR
  });

  it('asks the browser detector only for the EAN and UPC formats it supports', async () => {
    const n = detectorClass(['ean_13', 'qr_code']);
    await createFrameDecoder({ native: n.Cls, loadPonyfill: jest.fn() });
    expect(n.made).toEqual([{ formats: ['ean_13'] }]);
  });

  it.each([
    ['a browser detector without ean_13', detectorClass(['qr_code', 'code_128'])],
    ['a browser detector with no format list', detectorClass(undefined)],
    ['a browser detector that throws', detectorClass(new Error('boom'))],
  ])('uses the ponyfill for %s', async (_name, n) => {
    const p = detectorClass(undefined);
    const loadPonyfill = jest.fn(async () => p.Cls);
    const d = await createFrameDecoder({ native: n.Cls, loadPonyfill });
    expect(d.kind).toBe('zxing');
    expect(loadPonyfill).toHaveBeenCalledTimes(1);
    expect(p.made).toEqual([{ formats: [...WEB_FORMATS] }]);
  });

  it('uses the ponyfill when the browser has no detector at all', async () => {
    const p = detectorClass(undefined);
    const d = await createFrameDecoder({ native: undefined, loadPonyfill: async () => p.Cls });
    expect(d.kind).toBe('zxing');
  });

  it('a ponyfill that fails to load is an error for the caller (the view then says the camera did not start)', async () => {
    await expect(createFrameDecoder({ native: undefined, loadPonyfill: async () => { throw new Error('chunk failed'); } })).rejects.toThrow('chunk failed');
  });
});

describe('reading a frame', () => {
  const read = async (results: { rawValue: string; format: string }[] | Error) => {
    const n = detectorClass(['ean_13'], results);
    return (await createFrameDecoder({ native: n.Cls, loadPonyfill: jest.fn() })).read(frame);
  };

  it('maps each format to the app name', async () => {
    expect(await read([{ rawValue: '5000112637922', format: 'ean_13' }])).toEqual({ code: '5000112637922', format: 'EAN_13' });
    expect(await read([{ rawValue: '96385074', format: 'ean_8' }])).toEqual({ code: '96385074', format: 'EAN_8' });
    expect(await read([{ rawValue: '042100005264', format: 'upc_a' }])).toEqual({ code: '042100005264', format: 'UPC_A' });
    expect(await read([{ rawValue: '04252614', format: 'upc_e' }])).toEqual({ code: '04252614', format: 'UPC_E' });
  });

  it('ignores a QR code (a URL in it is never read) and any other symbology, and takes the first EAN or UPC', async () => {
    expect(await read([{ rawValue: 'https://example.com', format: 'qr_code' }])).toBeNull();
    expect(await read([{ rawValue: '123', format: 'code_128' }, { rawValue: '5000112637922', format: 'ean_13' }])).toEqual({ code: '5000112637922', format: 'EAN_13' });
  });

  it('no code, an empty value or an engine error is null, so the next frame is tried', async () => {
    expect(await read([])).toBeNull();
    expect(await read([{ rawValue: '', format: 'ean_13' }])).toBeNull();
    expect(await read(new Error('InvalidStateError'))).toBeNull();
  });
});
