/** @jest-environment node */
import { JSDOM } from 'jsdom';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import { Switch } from '../src/components/ui';

// react-native-web gives its Switch ref to the focusable <input role=switch> and puts every other aria prop on the wrapper div.
// The stand-in below does the same with a real jsdom input, so this checks the DOM the screen reader focuses, not React Native props.
let input: HTMLInputElement;
jest.mock('react-native/Libraries/Components/Switch/Switch', () => {
  const React = jest.requireActual('react');
  return { __esModule: true, default: ({ ref }: { ref?: { current: unknown } }) => { if (ref) ref.current = (globalThis as Record<string, unknown>).__input; return React.createElement('RNSwitch'); } };
});

describe('Switch invalid / describedBy on the web', () => {
  const g = globalThis as Record<string, unknown>;
  beforeEach(() => {
    const { window } = new JSDOM('<!doctype html><body><input type="checkbox" role="switch"></body>');
    g.document = window.document;
    input = window.document.querySelector('input')!;
    g.__input = input;
    jest.replaceProperty(Platform, 'OS', 'web');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete g.document;
    delete g.__input;
  });

  it('sets aria-invalid and aria-describedby on the input while invalid, and removes them when cleared', async () => {
    const view = await render(<Switch value={false} accessibilityLabel="Agree" invalid describedBy="err-1" />);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('err-1');
    await view.rerender(<Switch value accessibilityLabel="Agree" />);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });
});
