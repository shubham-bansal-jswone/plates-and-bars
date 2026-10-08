import { Tabs } from 'expo-router';
import { useTheme } from '../../src/theme/useTheme';

// Same sections, in the same order, as the prototype's bottom nav.
const TABS = [
  { name: 'index', title: 'Food' },
  { name: 'workout', title: 'Workout' },
  { name: 'progress', title: 'Progress' },
  { name: 'targets', title: 'Targets' },
] as const;

export default function TabsLayout() {
  const c = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.ink,
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{ title: t.title, tabBarAccessibilityLabel: t.title, tabBarIcon: () => null }}
        />
      ))}
    </Tabs>
  );
}
