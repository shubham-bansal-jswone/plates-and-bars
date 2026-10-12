import { render } from '@testing-library/react-native';
import type { PressableProps } from 'react-native';
import { a11yState, Button, Choice } from '../src/components/ui';
import { Chip } from '../src/workout/parts';
import { sourcesMatching } from './source-files';

// react-native-web ignores accessibilityState; only the aria-* props reach the DOM. Record what the primitives hand to Pressable.
const mockPressed: PressableProps[] = [];
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const React = jest.requireActual('react');
  const Actual = jest.requireActual('react-native/Libraries/Components/Pressable/Pressable').default;
  return { __esModule: true, default: (p: PressableProps) => { mockPressed.push(p); return React.createElement(Actual, p); } };
});
const last = (label: string) => mockPressed.filter((p) => p.accessibilityLabel === label).at(-1) as Record<string, unknown>;

describe('a11yState', () => {
  it('sets the native state and the aria twin together', () => {
    expect(a11yState({ expanded: true, busy: false })).toMatchObject({ accessibilityState: { expanded: true, busy: false }, 'aria-expanded': true, 'aria-busy': false });
    expect(a11yState({ selected: true })).toMatchObject({ accessibilityState: { selected: true }, 'aria-selected': true });
    expect(a11yState({ checked: false })).toMatchObject({ accessibilityState: { checked: false }, 'aria-checked': false });
  });
  it('a toggle button is aria-pressed and selected natively', () => {
    expect(a11yState({ pressed: true })).toMatchObject({ accessibilityState: { selected: true }, 'aria-pressed': true });
  });
  it('sets nothing when there is no state', () => {
    expect(a11yState({})).toMatchObject({ accessibilityState: undefined, 'aria-expanded': undefined, 'aria-pressed': undefined });
  });
});

describe('primitives hand aria state to the web', () => {
  it('Button announces expanded and busy', async () => {
    await render(<><Button label="More" expanded onPress={() => undefined} /><Button label="Save" busy onPress={() => undefined} /><Button label="Plain" onPress={() => undefined} /></>);
    expect(last('More')['aria-expanded']).toBe(true);
    expect(last('Save')['aria-busy']).toBe(true);
    expect(last('Plain')['aria-expanded']).toBeUndefined();
    expect(last('Plain').accessibilityState).toBeUndefined();
  });

  it('Button announces collapsed as expanded=false', async () => {
    await render(<Button label="Less" expanded={false} onPress={() => undefined} />);
    expect(last('Less')['aria-expanded']).toBe(false);
  });

  it('Choice is a radio with aria-checked and no aria-selected', async () => {
    await render(<Choice label="Male" selected onPress={() => undefined} />);
    expect(last('Male')['aria-checked']).toBe(true);
    expect(last('Male')['aria-selected']).toBeUndefined();
  });

  it('Chip is aria-pressed', async () => {
    await render(<><Chip label="Gym" pressed onPress={() => undefined} /><Chip label="Home" pressed={false} onPress={() => undefined} /></>);
    expect(last('Gym')['aria-pressed']).toBe(true);
    expect(last('Home')['aria-pressed']).toBe(false);
  });
});

describe('no accessibilityState without its aria twin', () => {
  it('only the a11yState helper mentions accessibilityState, as a prop or in a spread object', () => {
    const bad = sourcesMatching(/accessibilityState/);
    expect(bad).toEqual([]);
  });
});
