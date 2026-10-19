import { createContext, useContext } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** True inside the tab navigator: its tab bar already pads the bottom system inset, so a page must not add it twice. */
export const TabBarOwnsBottomInset = createContext(false);

/**
 * Space a full-height surface keeps clear at the bottom for the system navigation bar (3-button bar, gesture pill, iOS home
 * indicator). 0 on the web and inside the tabs. Without it, an edge-to-edge Android app draws the last button under the bar (#1059).
 */
export function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  return useContext(TabBarOwnsBottomInset) ? 0 : insets.bottom;
}
