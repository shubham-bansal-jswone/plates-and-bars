import * as React from 'react';
import * as RNs from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

type Mod = typeof import('../src/components/reducedMotion');
type RN = typeof RNs;

/** Fresh module (its load-time lookup) per test, with the system answer the test names. */
function load(answer: boolean | 'pending'): { mod: Mod; rn: RN } {
  let out!: { mod: Mod; rn: RN };
  jest.isolateModules(() => {
    // A fresh copy of the module only: React and React Native stay the instances the test renderer uses.
    jest.doMock('react', () => React);
    jest.doMock('react-native', () => RNs);
    const rn = RNs;
    const lookup = jest.spyOn(rn.AccessibilityInfo, 'isReduceMotionEnabled');
    if (answer === 'pending') lookup.mockReturnValue(new Promise(() => {}));
    else lookup.mockResolvedValue(answer);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    out = { mod: require('../src/components/reducedMotion') as Mod, rn };
  });
  return out;
}

afterEach(() => jest.restoreAllMocks());

test('a sheet mounted after the answer arrived is unanimated on its very first render (native)', async () => {
  const { mod } = load(true);
  await act(async () => {}); // the load-time lookup resolves
  const second = await renderHook(() => mod.useSheetAnimation());
  expect(second.result.current).toBe('none'); // no act flush: the first render already knows
});

test('without reduced motion sheets slide', async () => {
  const { mod } = load(false);
  await act(async () => {});
  const h = await renderHook(() => mod.useSheetAnimation());
  expect(h.result.current).toBe('slide');
});

test('on the web the browser preference is known at first render', async () => {
  const mm = jest.fn().mockReturnValue({ matches: true });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: mm });
  jest.replaceProperty(RNs.Platform, 'OS', 'web');
  const { mod } = load('pending');
  const h = await renderHook(() => mod.useSheetAnimation());
  expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  expect(h.result.current).toBe('none');
});
