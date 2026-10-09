import { StyleSheet } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Press } from '../components/ui';
import { Text } from '../components/Text';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { changes } from './copy';
import { useSync } from './SyncProvider';

/** The label the badge shows: signed out, unsynced changes, or all pushed. */
export function badgeLabel(s: { signedIn: boolean; pending: number }): string {
  if (!s.signedIn) return 'Sign in to sync';
  return s.pending > 0 ? 'Not synced' : 'Synced';
}

/** Small pill in the top corner; opens the account screen. Hidden in builds without a server. */
export function SyncBadge() {
  const s = useSync();
  const c = useTheme();
  const router = useRouter();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  // While a device wipe is pending the account is already deleted: no "sign in" prompt.
  if (!s.configured || path === '/sign-in' || s.wipePending) return null;
  const label = badgeLabel(s);
  const warn = s.signedIn && s.pending > 0;
  const hint = s.signedIn ? (s.pending > 0 ? `${changes(s.pending)} on this device ${s.pending === 1 ? 'is' : 'are'} not synced yet` : 'All changes are synced') : 'Signing in is optional';
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${hint}. Opens account`}
      onPress={() => router.push('/sign-in' as never)}
      hitSlop={8}
      style={[styles.pill, { top: insets.top + 4, backgroundColor: warn ? c.tint : c.surfaceSoft, borderColor: warn ? c.caution : c.line }]}
    >
      <Text style={[type.small, { color: c.ink }]}>{label}</Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  pill: { position: 'absolute', right: 8, minHeight: 28, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 14, borderWidth: 1 },
});
