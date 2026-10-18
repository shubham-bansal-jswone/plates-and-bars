import { createClient } from '@plate-and-bar/api';
import { lookupBarcode, retryAfterSec } from '../src/barcode/lookup';
import { EAN13, json, product, UPC_A, UPC_E } from './barcode-fixtures';

// The generated client over a stubbed fetch: every request that would leave the app is recorded here.
const fetchMock = jest.fn<Promise<Response>, [Request]>();
const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
const api = () => createClient('http://api.test/api/v1', () => null);

describe('no lookup without a valid barcode (network stub)', () => {
  // wrong check digit, wrong lengths (incl. GTIN-14), non-digits, empty, a UPC-E with a bad check digit
  const bad: [string, string, 'upc_e' | undefined][] = [
    ['wrong check digit', '5000112637923', undefined],
    ['14 digits', '15000112637929', undefined],
    ['11 digits', '04210000526', undefined],
    ['letters', '50001126379AB', undefined],
    ['spaces are not trimmed here', ' 5000112637922', undefined],
    ['empty', '', undefined],
    ['a URL from a QR code', 'https://example.com/5000112637922', undefined],
    ['upc_e with a bad check digit', '04252615', 'upc_e'],
    ['upc_e of the wrong length', '5000112637922', 'upc_e'],
  ];
  it.each(bad)('%s: invalid, and fetch is never called', async (_n, code, hint) => {
    expect(await lookupBarcode(api(), code, hint)).toEqual({ kind: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a valid code makes exactly one GET with no credentials and the digits only in the path', async () => {
    fetchMock.mockResolvedValue(json(200, product()));
    const r = await lookupBarcode(api(), EAN13);
    expect(r.kind).toBe('found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = fetchMock.mock.calls[0]![0];
    expect(req.method).toBe('GET');
    expect(req.url).toBe(`http://api.test/api/v1/foods/barcode/${EAN13}`);
    expect(req.headers.get('Authorization')).toBeNull();
    expect(req.headers.get('Cookie')).toBeNull();
  });

  it('a UPC-E from the scanner is expanded by core: the request carries the 12-digit UPC-A', async () => {
    fetchMock.mockResolvedValue(json(200, product({ code: UPC_A })));
    await lookupBarcode(api(), UPC_E, 'upc_e');
    expect(fetchMock.mock.calls[0]![0].url).toBe(`http://api.test/api/v1/foods/barcode/${UPC_A}`);
  });
});

describe('answers', () => {
  it('200: mapped by core, saved under the code that was looked up, product kept for the credit', async () => {
    fetchMock.mockResolvedValue(json(200, product({ code: `0${UPC_A}` })));
    const r = await lookupBarcode(api(), UPC_A);
    if (r.kind !== 'found') throw new Error('expected found');
    expect(r.draft).toMatchObject({ name: 'Peanut bar (Acme)', unit: '1 bar (50 g)', kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 8, fibre_g: 3, barcode: UPC_A });
    expect(r.missing).toEqual([]);
    expect(r.product.source.code).toBe('open_food_facts');
  });

  it('200 with no usable nutriment is not found', async () => {
    fetchMock.mockResolvedValue(json(200, product({ nutriments: {} })));
    expect(await lookupBarcode(api(), EAN13)).toEqual({ kind: 'not_found' });
  });

  it('404 is not found', async () => {
    fetchMock.mockResolvedValue(json(404, { code: 'not_found', message: 'x' }));
    expect(await lookupBarcode(api(), EAN13)).toEqual({ kind: 'not_found' });
  });

  it('429 carries Retry-After', async () => {
    fetchMock.mockResolvedValue(json(429, { code: 'rate_limited', message: 'x' }, { 'Retry-After': '30' }));
    expect(await lookupBarcode(api(), EAN13)).toEqual({ kind: 'rate_limited', retryAfterSec: 30 });
  });

  it('503 upstream_busy carries Retry-After; upstream_unavailable and other failures do not retry-after', async () => {
    fetchMock.mockResolvedValue(json(503, { code: 'upstream_busy', message: 'x' }, { 'Retry-After': '45' }));
    expect(await lookupBarcode(api(), EAN13)).toEqual({ kind: 'busy', retryAfterSec: 45 });
    fetchMock.mockResolvedValue(json(503, { code: 'upstream_unavailable', message: 'x' }));
    expect(await lookupBarcode(api(), EAN13)).toEqual({ kind: 'unavailable' });
    fetchMock.mockResolvedValue(json(500, { code: 'internal', message: 'x' }));
    expect(await lookupBarcode(api(), EAN13)).toEqual({ kind: 'unavailable' });
  });

  it('a 400 from the server is invalid (the app checked already, so this is a disagreement, never a retry)', async () => {
    fetchMock.mockResolvedValue(json(400, { code: 'invalid_barcode', message: 'x' }));
    expect(await lookupBarcode(api(), EAN13)).toEqual({ kind: 'invalid' });
  });

  it('a thrown fetch is offline; a body that is not JSON is unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    expect(await lookupBarcode(api(), EAN13)).toEqual({ kind: 'offline' });
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    expect(await lookupBarcode(api(), EAN13)).toEqual({ kind: 'unavailable' });
  });

  it('a request that never answers is unavailable after the timeout', async () => {
    fetchMock.mockImplementation((req) => new Promise((_res, rej) => req.signal.addEventListener('abort', () => rej(new Error('aborted')))));
    expect(await lookupBarcode(api(), EAN13, undefined, 20)).toEqual({ kind: 'unavailable' });
  });
});

describe('retryAfterSec', () => {
  it('reads whole seconds only', () => {
    expect(retryAfterSec('30')).toBe(30);
    expect(retryAfterSec(' 7 ')).toBe(7);
    expect(retryAfterSec(null)).toBeNull();
    expect(retryAfterSec('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
    expect(retryAfterSec('-5')).toBeNull();
    expect(retryAfterSec('1.5')).toBeNull();
  });
});
