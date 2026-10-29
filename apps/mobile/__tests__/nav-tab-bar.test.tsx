import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { PressableProps } from 'react-native';
import { NavTabBar } from '../src/components/NavTabBar';

// react-native-web reads aria-* props; record what reaches Pressable.
const mockPressed: PressableProps[] = [];
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const React = jest.requireActual('react');
  const Actual = jest.requireActual('react-native/Libraries/Components/Pressable/Pressable').default;
  return { __esModule: true, default: (p: PressableProps) => { mockPressed.push(p); return React.createElement(Actual, p); } };
});
beforeEach(() => { mockPressed.length = 0; });
const last = (label: string) => mockPressed.filter((p) => p['aria-label'] === label).at(-1) as Record<string, unknown>;

const routes = [{ key: 'index', name: 'index' }, { key: 'workout', name: 'workout' }, { key: 'progress', name: 'progress' }];
const options = (title: string) => ({ title, tabBarAccessibilityLabel: title, tabBarIcon: () => <Text>{`${title} icon`}</Text>, tabBarLabelStyle: { fontSize: 12 } });
const descriptors = {
  index: { options: { ...options('Food'), tabBarStyle: { height: 80 }, tabBarActiveTintColor: '#2457E6', tabBarInactiveTintColor: '#555555' } },
  workout: { options: options('Workout') },
  progress: { options: options('Progress') },
};

function mount(index: number, over: { prevent?: boolean } = {}) {
  const emit = jest.fn(() => ({ defaultPrevented: !!over.prevent }));
  const navigateToTab = jest.fn();
  // The focused route's options carry the bar style and tints, as the layout's screenOptions do.
  const d = { ...descriptors, [routes[index]!.key]: { options: { ...descriptors.index.options, ...options(['Food', 'Workout', 'Progress'][index]!) } } };
  const props = { state: { index, routes }, descriptors: d, emitter: { emit }, navigateToTab } as unknown as ComponentProps<typeof NavTabBar>;
  return { ui: <NavTabBar {...props} />, emit, navigateToTab };
}

describe('NavTabBar (#1409)', () => {
  it('is a navigation landmark of buttons, with no tablist or tab roles', async () => {
    await render(mount(0).ui);
    expect(screen.getByLabelText('Sections').props.role).toBe('navigation');
    expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Food', 'Workout', 'Progress']);
    const json = JSON.stringify(screen.toJSON());
    expect(json).not.toContain('tablist');
    expect(json).not.toContain('"role":"tab"');
  });

  it('marks only the current section aria-current="page"', async () => {
    await render(mount(1).ui);
    expect(last('Workout')['aria-current']).toBe('page');
    expect(last('Food')['aria-current']).toBeUndefined();
    expect(last('Progress')['aria-current']).toBeUndefined();
  });

  it('a press emits tabPress and goes to another section, and does nothing on the current one', async () => {
    const m = mount(0);
    await render(m.ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Progress' }));
    expect(m.emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'progress', canPreventDefault: true });
    expect(m.navigateToTab).toHaveBeenCalledWith('progress');
    m.navigateToTab.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Food' }));
    expect(m.navigateToTab).not.toHaveBeenCalled();
  });

  it('a prevented tabPress does not navigate', async () => {
    const m = mount(0, { prevent: true });
    await render(m.ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Workout' }));
    expect(m.navigateToTab).not.toHaveBeenCalled();
  });

  it('shows each icon and label', async () => {
    await render(mount(0).ui);
    for (const t of ['Food', 'Workout', 'Progress']) {
      expect(screen.getByText(t)).toBeTruthy();
      expect(screen.getByText(`${t} icon`)).toBeTruthy();
    }
  });
});
