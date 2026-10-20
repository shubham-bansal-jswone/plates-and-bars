import { cropRect, MIN_SIDE } from '../src/labelscan/crop';

// The same rules as Geometry.cropToRaw on Android (GeometryTest.kt): fractions of the upright image.
describe('cropRect', () => {
  it('no crop is the whole image', () => {
    expect(cropRect(undefined, 400, 300)).toEqual({ left: 0, top: 0, width: 400, height: 300 });
  });
  it('turns fractions into pixels', () => {
    expect(cropRect({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 400, 300)).toEqual({ left: 100, top: 150, width: 200, height: 150 });
  });
  it('clips a box that runs past the edge', () => {
    expect(cropRect({ x: 0.5, y: 0.5, width: 0.9, height: 0.9 }, 400, 300)).toEqual({ left: 200, top: 150, width: 200, height: 150 });
  });
  it.each([
    [{ x: Number.NaN, y: 0, width: 0.5, height: 0.5 }],
    [{ x: -0.1, y: 0, width: 0.5, height: 0.5 }],
    [{ x: 0, y: 0, width: 0, height: 0.5 }],
    [{ x: 1, y: 0, width: 0.5, height: 0.5 }],
    [{ x: 0, y: 0, width: Infinity, height: 0.5 }],
    [{ x: 0, y: 0, width: 0.01, height: 1 }],
  ])('refuses %j with a `crop` error', (crop) => {
    expect(() => cropRect(crop, 400, 300)).toThrow(expect.objectContaining({ code: 'crop' }));
  });
  it('the smallest accepted side is MIN_SIDE pixels', () => {
    expect(cropRect({ x: 0, y: 0, width: MIN_SIDE / 400, height: 1 }, 400, 300).width).toBe(MIN_SIDE);
    expect(() => cropRect({ x: 0, y: 0, width: (MIN_SIDE - 1) / 400, height: 1 }, 400, 300)).toThrow();
  });
});
