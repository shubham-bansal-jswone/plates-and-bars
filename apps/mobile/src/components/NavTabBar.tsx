import type { BottomTabBarProps } from 'expo-router/tabs';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Press } from './ui';

/**
 * The section bar on web (#1409): navigation, not tab panels. A `nav` landmark holding one button per section, the current one marked
 * `aria-current="page"`, each in the page's tab order and none a `tab` (the ARIA tabs pattern would need arrow keys and a roving stop,
 * and nothing here is a tab panel). It draws from the same screen options as the native `BottomTabBar` (label, icon, colours, bar style),
 * so the two look alike; native keeps `BottomTabBar` and its platform tab semantics.
 */
export function NavTabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const bar = descriptors[state.routes[state.index]?.key ?? '']?.options;
  return (
    <View role="navigation" aria-label="Sections" style={[styles.bar, bar?.tabBarStyle as StyleProp<ViewStyle>]}>
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          if (!descriptor) return null;
          const { options } = descriptor;
          const focused = index === state.index;
          const title = options.title ?? route.name;
          const color = (focused ? bar?.tabBarActiveTintColor : bar?.tabBarInactiveTintColor) as string | undefined;
          const go = () => {
            const e = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !e.defaultPrevented) navigateToTab(route.key);
          };
          const current = focused ? ({ 'aria-current': 'page' } as const) : null;
          return (
            <Press key={route.key} role="button" aria-label={options.tabBarAccessibilityLabel ?? title} {...current} testID={options.tabBarButtonTestID} onPress={go} style={styles.item}>
              {options.tabBarIcon?.({ focused, color: color ?? '', size: 24 })}
              <Text style={[options.tabBarLabelStyle, { color }]}>{title}</Text>
            </Press>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row' },
  row: { flex: 1, flexDirection: 'row' },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
