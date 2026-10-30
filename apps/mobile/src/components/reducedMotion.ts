import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** The browser's answer right now (no waiting), so the first paint of a web sheet already knows. */
const webReduced = (): boolean | undefined =>
  Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : undefined;

// One answer for the whole app, asked once at load: a sheet mounts fresh on every open, so a per-mount lookup (async on native)
// would always lose the race with the first render and the native Modal reads its animation then.
let known: boolean | undefined;
const watchers = new Set<() => void>();
const learn = (v: boolean) => {
  known = v;
  watchers.forEach((w) => w());
};
AccessibilityInfo.isReduceMotionEnabled().then(learn, () => learn(true));
AccessibilityInfo.addEventListener('reduceMotionChanged', learn);

/**
 * Whether the system asks for reduced motion: undefined until it has answered (the first paint then shows frame 0, starts no timer and
 * has no Pause button), true when it asks or the lookup fails (nothing moves), false otherwise.
 */
export function useReducedMotion(): boolean | undefined {
  return useSyncExternalStore(
    (notify) => {
      watchers.add(notify);
      return () => void watchers.delete(notify);
    },
    () => known ?? webReduced(),
  );
}

/** Modal slide-in unless reduced motion is on. Web knows at first paint; native learns a tick later (a native sheet opened in that tick may still slide once). */
export function useSheetAnimation(): 'slide' | 'none' {
  return useReducedMotion() === true ? 'none' : 'slide';
}

/** Tests only: set (or, with undefined, forget) the saved answer. */
export const setReducedMotionForTests = (v: boolean | undefined) => {
  known = v;
  watchers.forEach((w) => w());
};
