import { useCallback, useMemo, useRef, type ComponentRef } from 'react';
import type { ScrollView, View } from 'react-native';
import { useReducedMotion } from '../components/reducedMotion';

const EDGE = 8;

/** What `Page` takes to let its owner scroll it: hands over the ScrollView. */
export interface PageScroller {
  attach: (node: ComponentRef<typeof ScrollView> | null) => void;
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
  const reduced = useReducedMotion();
  const animated = reduced === false;
  const scroller = useMemo<PageScroller>(() => ({ attach: (n) => void (ref.current = n) }), []);
  const reveal = useCallback(
    (node: ComponentRef<typeof View> | null | undefined, bottomClear: number, onOffset?: (y: number) => void) => {
      const page = ref.current;
      const content = page?.getInnerViewRef();
      if (!node || !page || !content) return;
      // The offset is read from where the content sits (its top is the page top less the offset), not from `onScroll`, which lags a scroll that has just happened.
      node.measureInWindow((_x, nodeTop, _w, nodeH) => {
        page.measureInWindow((_px, viewTop, _pw, viewH) => {
          content.measureInWindow((_cx, contentTop, _cw, contentH) => {
            const d = revealDelta(nodeTop, nodeH, viewTop, viewH, bottomClear);
            const want = Math.max(0, viewTop - contentTop + d);
            if (d !== 0) page.scrollTo({ x: 0, y: want, animated });
            // What the page can reach: a scroll past the end of the content stops there.
            onOffset?.(d !== 0 ? Math.min(want, Math.max(0, contentH - viewH)) : viewTop - contentTop); // the offset the reveal left, for a later check that the page has not moved
          });
        });
      });
    },
    [animated],
  );
  /** Where the page is scrolled to now, read the way `reveal` reads it. */
  const offset = useCallback((then: (y: number) => void) => {
    const page = ref.current;
    const content = page?.getInnerViewRef();
    if (!page || !content) return;
    page.measureInWindow((_px, viewTop) => content.measureInWindow((_cx, contentTop) => then(viewTop - contentTop)));
  }, []);
  return { scroller, reveal, offset };
}
