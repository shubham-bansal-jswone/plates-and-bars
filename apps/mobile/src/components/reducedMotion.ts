import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** The browser's answer right now (no waiting), so the first paint of a web sheet already knows. */
const webReduced = (): boolean | undefined =>
  Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : undefined;

/**
 * Whether the system asks for reduced motion: undefined until it has answered (the first paint then shows frame 0, starts no timer and
 * has no Pause button), true when it asks or the lookup fails (nothing moves), false otherwise.
 */
export function useReducedMotion(): boolean | undefined {
  const [reduced, setReduced] = useState<boolean | undefined>(webReduced);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduced(v); }, () => { if (alive) setReduced(true); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}

/** Modal slide-in unless reduced motion is on. Web knows at first paint; native learns a tick later (a native sheet opened in that tick may still slide once). */
export function useSheetAnimation(): 'slide' | 'none' {
  return useReducedMotion() === true ? 'none' : 'slide';
}
