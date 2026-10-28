import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';

/**
 * Tab screens stay mounted so typed values survive, but on web an inactive one is only aria-hidden and its controls
 * stay in the Tab order (#1191). display:none removes them from focus and the accessibility tree; state is kept.
 */
export function InactiveScreenHidden({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  const hide = Platform.OS === 'web' && !focused;
  return <View style={hide ? { display: 'none', flex: 1 } : { flex: 1 }}>{children}</View>;
}
