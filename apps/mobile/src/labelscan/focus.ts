import { useEffect, useRef, type ComponentRef, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, View } from 'react-native';

type Node = ComponentRef<typeof View>;

/** Moves screen-reader and keyboard focus to `node` (WCAG 2.4.3). */
export function focusNode(node: Node | null | undefined): void {
  if (!node) return;
  if (Platform.OS === 'web') {
    const el = node as unknown as HTMLElement;
    // Containers and headings: focusable by script, not in the tab order. Never touch an element that is already focusable (a button's tab stop must survive).
    if (!el.hasAttribute?.('tabindex') && !el.matches?.('button, a[href], input, select, textarea, [contenteditable]')) el.setAttribute?.('tabindex', '-1');
    el.focus?.();
    return;
  }
  const tag = findNodeHandle(node);
  if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
}

/** Moves focus to the heading it is attached to when the screen appears. */
export function useFocusOnMount(): RefObject<Node | null> {
  const ref = useRef<Node>(null);
  useEffect(() => focusNode(ref.current), []);
  return ref;
}
