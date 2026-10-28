import { Platform, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Input } from '../src/components/Input';
import { dark, light } from '../src/theme/tokens';

const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

describe('Input focus indicator on web (#1253)', () => {
  const orig = Platform.OS;
  afterEach(() => setOS(orig));

  it('drops the browser outline and shows the app focus border on focus', async () => {
    setOS('web');
    await render(<Input accessibilityLabel="Search" />);
    const field = screen.getByLabelText('Search');
    expect(StyleSheet.flatten(field.props.style)).toMatchObject({ outlineStyle: 'none', borderWidth: 1 });
    await fireEvent(field, 'focus');
    const st = StyleSheet.flatten(screen.getByLabelText('Search').props.style);
    expect(st).toMatchObject({ outlineStyle: 'none', borderWidth: 2 });
    expect([light.focus, dark.focus]).toContain(st.borderColor);
  });

  it('leaves native styles alone', async () => {
    setOS('android');
    await render(<Input accessibilityLabel="Search" />);
    expect(StyleSheet.flatten(screen.getByLabelText('Search').props.style)).not.toHaveProperty('outlineStyle');
  });
});
