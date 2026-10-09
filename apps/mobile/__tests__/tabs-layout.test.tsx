import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import TabsLayout from '../app/(tabs)/_layout';

interface MockScreen {
  name: string;
  options: { title: string; tabBarIcon: (p: { focused: boolean; color: string }) => { props: { name: string; size: number; color: string } } };
}
const mockTabs = jest.fn();
jest.mock('expo-router', () => {
  const Tabs = Object.assign(
    function Tabs(props: { children: ReactNode }) {
      mockTabs(props);
      return props.children;
    },
    {
      Screen: function Screen(props: MockScreen) {
        mockScreens.push(props);
        return null;
      },
    },
  );
  return { Tabs };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 20, left: 0, right: 0 }) }));
const mockScreens: MockScreen[] = [];

describe('tab bar', () => {
  beforeEach(async () => {
    mockScreens.length = 0;
    mockTabs.mockClear();
    await render(<TabsLayout />);
  });

  it('is 56 plus the bottom safe area, labels below 24px icons, and hides the duplicate header', () => {
    const o = mockTabs.mock.calls[0][0].screenOptions;
    expect(o.tabBarStyle).toMatchObject({ height: 76, paddingBottom: 20, borderTopWidth: 1 });
    expect(o.tabBarLabelPosition).toBe('below-icon');
    expect(o.headerShown).toBe(false);
    expect(o.tabBarActiveTintColor).toBe('#2457E6');
    expect(o.sceneStyle).toMatchObject({ paddingTop: 24 });
  });

  it('gives each tab a 24px icon, filled when active and outlined when not', () => {
    expect(mockScreens.map((s) => s.options.title)).toEqual(['Food', 'Workout', 'Progress', 'Targets']);
    for (const s of mockScreens) {
      const on = s.options.tabBarIcon({ focused: true, color: '#000' }).props;
      const off = s.options.tabBarIcon({ focused: false, color: '#000' }).props;
      expect(on.size).toBe(24);
      expect(on.name).not.toMatch(/-outline$/);
      expect(off.name).toBe(`${on.name}-outline`);
    }
  });

  it('gives tab buttons the 2px focus ring and keeps their role, state and label', async () => {
    const o = mockTabs.mock.calls[0][0].screenOptions;
    const onPress = jest.fn();
    await render(
      o.tabBarButton({ role: 'tab', 'aria-label': 'Food', 'aria-selected': true, onPress, children: <Text>Food</Text> }),
    );
    const tab = screen.getByLabelText('Food');
    expect(tab.props.role).toBe('tab');
    expect(tab.props.accessibilityState).toMatchObject({ selected: true });
    expect(StyleSheet.flatten(tab.props.style).outlineWidth).toBeUndefined();
    await fireEvent(tab, 'focus', { target: 1 });
    expect(StyleSheet.flatten(screen.getByLabelText('Food').props.style)).toMatchObject({ outlineWidth: 2, outlineOffset: 2, outlineColor: '#2457E6' });
    await fireEvent.press(screen.getByLabelText('Food'));
    expect(onPress).toHaveBeenCalled();
  });
});
