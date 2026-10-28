import { AccessibilityInfo, Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSheetAnimation } from '../src/components/reducedMotion';

afterEach(() => jest.restoreAllMocks());

test('sheets slide by default and do not animate under reduced motion (native)', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const { result } = await renderHook(() => useSheetAnimation());
  await act(async () => {});
  expect(result.current).toBe('none');

  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const off = await renderHook(() => useSheetAnimation());
  await act(async () => {});
  expect(off.result.current).toBe('slide');
});

test('on the web the browser preference is known at first render', async () => {
  const os = jest.replaceProperty(Platform, 'OS', 'web');
  const mm = jest.fn().mockReturnValue({ matches: true });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: mm });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise(() => {}));
  const { result } = await renderHook(() => useSheetAnimation());
  expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  expect(result.current).toBe('none');
  os.restore();
});
