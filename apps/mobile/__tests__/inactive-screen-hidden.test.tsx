import { render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';
import { InactiveScreenHidden } from '../src/components/InactiveScreenHidden';

let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));

const display = () => {
  const style = screen.getByText('body', { includeHiddenElements: true }).parent?.props.style as { display?: string };
  return style.display;
};

describe('InactiveScreenHidden', () => {
  const os = Platform.OS;
  afterEach(() => { Platform.OS = os; });

  it('keeps children mounted but display:none when blurred on web', async () => {
    Platform.OS = 'web';
    mockFocused = false;
    await render(<InactiveScreenHidden><Text>body</Text></InactiveScreenHidden>);
    expect(display()).toBe('none');
  });

  it('shows the focused screen on web', async () => {
    Platform.OS = 'web';
    mockFocused = true;
    await render(<InactiveScreenHidden><Text>body</Text></InactiveScreenHidden>);
    expect(display()).toBeUndefined();
  });

  it('leaves native untouched', async () => {
    Platform.OS = 'ios';
    mockFocused = false;
    await render(<InactiveScreenHidden><Text>body</Text></InactiveScreenHidden>);
    expect(display()).toBeUndefined();
  });
});
