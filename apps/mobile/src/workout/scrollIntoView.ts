import { useCallback, useMemo, useRef, type ComponentRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView, View } from 'react-native';
import { useReducedMotion } from '../components/reducedMotion';

/** About how high the rest dock is (the page keeps a 184 px spacer under its last control for it). */
export const DOCK_CLEAR = 150;
const EDGE = 8;

/** What `Page` takes to let its owner scroll it: hands over the ScrollView, and reports the offset through `onScroll`. */
export interface PageScroller {
  attach: (node: ComponentRef<typeof ScrollView> | null) => void;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

/**
 * How far to scroll (down is positive) so a node at `nodeTop` (window coordinates, `nodeH` high) shows inside the visible part of the page:
 * from the top of the scroll view to its bottom edge less `bottomClear` (the rest dock). 0 when it already shows. A node taller than that
 * part, or one above it, is brought to the top edge: its start is what the user needs.
 */
export function revealDelta(nodeTop: number, nodeH: number, viewTop: number, viewH: number, bottomClear: number): number {
  const top = viewTop + EDGE;
  const bottom = viewTop + viewH - bottomClear - EDGE;
  if (nodeTop >= top && nodeTop + nodeH <= bottom) return 0;
  if (nodeTop < top || nodeH > bottom - top) return nodeTop - top;
  return nodeTop + nodeH - bottom;
}

/**
 * Scrolls a node into view in the `Page` it is given to (`scroller`), above the rest dock when one is up. Does nothing when the node already
 * shows. Only scrolls: it never moves focus. Animated unless reduced motion is on (or not yet known).
 */
export function useScrollIntoView() {
  const ref = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const y = useRef(0);
  const reduced = useReducedMotion();
  const animated = reduced === false;
  const scroller = useMemo<PageScroller>(() => ({ attach: (n) => void (ref.current = n), onScroll: (e) => void (y.current = e.nativeEvent.contentOffset.y) }), []);
  const reveal = useCallback(
    (node: ComponentRef<typeof View> | null | undefined, bottomClear: number) => {
      const page = ref.current;
      if (!node || !page) return;
      node.measureInWindow((_x, nodeTop, _w, nodeH) => {
        page.measureInWindow((_px, viewTop, _pw, viewH) => {
          const d = revealDelta(nodeTop, nodeH, viewTop, viewH, bottomClear);
          if (d !== 0) page.scrollTo({ x: 0, y: Math.max(0, y.current + d), animated });
        });
      });
    },
    [animated],
  );
  return { scroller, reveal };
}
