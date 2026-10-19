import { createContext, useContext, type ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';

/** True where an ancestor already pads the bottom system inset (the tab bar, or a modal window), so a page must not add it twice. */
export const BottomInsetPadded = createContext(false);

/**
 * Space a full-height surface keeps clear at the bottom for the system navigation bar (3-button bar, gesture pill, iOS home
 * indicator). 0 on the web and wherever an ancestor already pads it. Without it, an edge-to-edge Android app draws the last
 * button under the bar (#1059).
 */
export function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  return useContext(BottomInsetPadded) ? 0 : insets.bottom;
}

/** The content of a modal window: its own window sits over the tab bar too, so it pads the raw inset itself, once. */
export function PaddedWindow({ children }: { children: ReactNode }) {
  const c = useTheme();
  const { bottom } = useSafeAreaInsets();
  return (
    <BottomInsetPadded.Provider value>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingBottom: bottom }}>{children}</View>
    </BottomInsetPadded.Provider>
  );
}
