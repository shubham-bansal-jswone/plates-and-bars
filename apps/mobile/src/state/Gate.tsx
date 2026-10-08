import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTheme } from '../theme/useTheme';
import { gateRedirect } from './gateRedirect';
import { useProfile } from './ProfileProvider';

/** Sends the user to setup or Targets as the stored profile requires; covers the screen while loading. */
export function Gate() {
  const { status, profile } = useProfile();
  const pathname = usePathname();
  const router = useRouter();
  const c = useTheme();
  const firstOpen = useRef(true);

  useEffect(() => {
    if (status !== 'ready') return;
    const to = gateRedirect({ status, hasProfile: !!profile, pathname, firstOpen: firstOpen.current });
    firstOpen.current = false;
    if (to) router.replace(to as never);
  }, [status, profile, pathname, router]);

  if (status === 'ready') return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: c.bg }]}>
      <ActivityIndicator accessibilityLabel="Loading" color={c.brand} />
    </View>
  );
}

const styles = StyleSheet.create({ cover: { alignItems: 'center', justifyContent: 'center' } });
