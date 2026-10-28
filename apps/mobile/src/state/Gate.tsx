import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { Skeleton } from '../components/Skeleton';
import { a11yState, COLUMN_MAX } from '../components/ui';
import { space } from '../theme/tokens';
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
    // A plain container, not `Page`: the route underneath keeps its own main landmark, so this adds none.
    <View testID="gate-cover" {...a11yState({ busy: true })} style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, padding: space.lg }]}>
      <View style={{ width: '100%', maxWidth: COLUMN_MAX, alignSelf: 'center' }}><Skeleton /></View>
    </View>
  );
}
