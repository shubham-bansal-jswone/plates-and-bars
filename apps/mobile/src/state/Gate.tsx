import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { Skeleton } from '../components/Skeleton';
import { a11yState, Page } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { gateRedirect } from './gateRedirect';
import { useProfile } from './ProfileProvider';
import { setSetupLeaving, setupLeaving } from './setupExit';

/** Sends the user to setup or Targets as the stored profile requires; covers the screen with the themed skeleton while loading. */
export function Gate() {
  const { status, profile, skipped } = useProfile();
  const pathname = usePathname();
  const router = useRouter();
  const params = useGlobalSearchParams<{ redo?: string; recalc?: string }>();
  const redo = params.redo === '1' || params.recalc === '1';
  const c = useTheme();
  const firstOpen = useRef(true);

  useEffect(() => {
    if (status !== 'ready') return;
    if (pathname !== '/setup') setSetupLeaving(false);
    const to = gateRedirect({ status, hasProfile: !!profile, pathname, firstOpen: firstOpen.current, skipped, redo, leaving: setupLeaving() });
    firstOpen.current = false;
    if (to) router.replace(to as never);
  }, [status, profile, skipped, pathname, redo, router]);

  if (status === 'ready') return null;
  return (
    <View accessibilityLabel="Loading" {...a11yState({ busy: true })} style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}>
      <Page><Skeleton /></Page>
    </View>
  );
}
