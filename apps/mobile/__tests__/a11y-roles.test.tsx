import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { PressableProps } from 'react-native';
import { Choice, Page } from '../src/components/ui';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';

// Pressable folds aria-checked into accessibilityState before the host view, so record what Choice hands to it.
const mockPressed: PressableProps[] = [];
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const React = jest.requireActual('react');
  const Actual = jest.requireActual('react-native/Libraries/Components/Pressable/Pressable').default;
  return { __esModule: true, default: (p: PressableProps) => { mockPressed.push(p); return React.createElement(Actual, p); } };
});

/** Props of every host element in the rendered tree, to find landmarks that are not "accessible" elements. */
const roles = (node: unknown, out: string[] = []): string[] => {
  if (!node || typeof node !== 'object') return out;
  const n = node as { props?: Record<string, unknown>; children?: unknown[] };
  if (typeof n.props?.role === 'string') out.push(n.props.role);
  for (const c of n.children ?? []) roles(c, out);
  return out;
};

describe('radio state', () => {
  it('Choice radios announce checked for the selected and unchecked for the other option', async () => {
    await render(
      <>
        <Choice label="Male" selected onPress={() => undefined} />
        <Choice label="Female" selected={false} onPress={() => undefined} />
      </>,
    );
    const by = (l: string) => mockPressed.filter((p) => p.accessibilityLabel === l).at(-1) as Record<string, unknown>;
    expect(by('Male')['aria-checked']).toBe(true);
    expect(by('Female')['aria-checked']).toBe(false);
    expect(screen.getByRole('radio', { name: 'Male' })).toBeChecked();
  });

  it('an action Choice is a button, not a radio', async () => {
    await render(<Choice action label="Yes" selected={false} onPress={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Yes' })).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('landmarks', () => {
  it('Page content sits in a main landmark', async () => {
    await render(
      <Page>
        <Text>Body</Text>
      </Page>,
    );
    expect(roles(screen.toJSON())).toContain('main');
  });
});

describe('exercise library rows', () => {
  it('are named by their visible text, with no separate label', async () => {
    await render(<ExerciseLibraryScreen onBack={() => undefined} />);
    const row = screen.getAllByRole('button').find((b) => b.props.accessibilityLabel === undefined);
    expect(row).toBeTruthy();
    expect(roles(screen.toJSON()).filter((r) => r === 'main')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Archer Push-ups/ })).toBeTruthy();
  });
});
