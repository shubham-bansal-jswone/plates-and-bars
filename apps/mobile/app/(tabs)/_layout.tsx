import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ReactNode } from 'react';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Press } from '../../src/components/ui';
import { type } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

type IconName = keyof typeof Ionicons.glyphMap;

// Same sections, in the same order, as the prototype's bottom nav. Filled icon when active, outline when not (DESIGN.md 8.7).
const TABS: readonly { name: string; title: string; on: IconName; off: IconName }[] = [
  { name: 'index', title: 'Food', on: 'restaurant', off: 'restaurant-outline' },
  { name: 'workout', title: 'Workout', on: 'barbell', off: 'barbell-outline' },
  { name: 'progress', title: 'Progress', on: 'stats-chart', off: 'stats-chart-outline' },
  { name: 'targets', title: 'Targets', on: 'flag', off: 'flag-outline' },
];

interface TabButtonProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: PressableProps['onPress'];
  onLongPress?: PressableProps['onLongPress'];
  testID?: string;
  role?: PressableProps['role'];
  'aria-label'?: string;
  'aria-selected'?: boolean;
}

/** Tab button with the app's 2px focus ring in place of the browser's default outline; keeps the tab role, selected state and label. */
function TabButton({ children, style, onPress, onLongPress, testID, role, 'aria-label': label, 'aria-selected': selected }: TabButtonProps) {
  return (
    <Press
      role={role}
      aria-label={label}
      aria-selected={selected}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[style, { alignItems: 'center' }]}
    >
      {children}
    </Press>
  );
}

/** Tab bar height from DESIGN.md 8.7: 56 plus the bottom safe area. */
const TAB_BAR_HEIGHT = 56;

export default function TabsLayout() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        // Each screen draws its own heading, so the navigator's header would show the title twice.
        headerShown: false,
        sceneStyle: { backgroundColor: c.bg, paddingTop: insets.top },
        // 8.7: brand on light, link-dark on dark; the focus token is exactly that pair.
        tabBarActiveTintColor: c.focus,
        tabBarInactiveTintColor: c.muted,
        tabBarButton: (props) => <TabButton {...props} />,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: { ...type.small, lineHeight: 16 },
        tabBarStyle: {
          backgroundColor: c.surfaceElevated,
          borderTopColor: c.line,
          borderTopWidth: 1,
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
        },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarAccessibilityLabel: t.title,
            tabBarIcon: ({ focused, color }) => <Ionicons name={focused ? t.on : t.off} size={24} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
