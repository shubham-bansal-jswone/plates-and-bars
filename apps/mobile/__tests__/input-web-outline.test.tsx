import { Platform, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Input } from '../src/components/Input';
import { Field } from '../src/components/ui';
import { dark, light } from '../src/theme/tokens';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }));

const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
const style = (label: string) => StyleSheet.flatten(screen.getByLabelText(label).props.style);

describe('Input focus indicator on web (#1253)', () => {
  const orig = Platform.OS;
  afterEach(() => {
    setOS(orig);
    mockScheme = 'light';
  });

  it.each([['light', light], ['dark', dark]] as const)('drops the browser outline and shows the %s focus border on focus', async (scheme, p) => {
    mockScheme = scheme;
    setOS('web');
    await render(<Input accessibilityLabel="Search" />);
    expect(style('Search')).toMatchObject({ outlineStyle: 'none', borderWidth: 1, borderColor: p.outline });
    await fireEvent(screen.getByLabelText('Search'), 'focus');
    expect(style('Search')).toMatchObject({ outlineStyle: 'none', borderWidth: 2, borderColor: p.focus });
  });

  it('leaves native styles alone', async () => {
    setOS('android');
    await render(<Input accessibilityLabel="Search" />);
    expect(style('Search')).not.toHaveProperty('outlineStyle');
  });

  it.each([['light', light], ['dark', dark]] as const)('focused + invalid on web keeps the %s danger border and adds a focus-colour outline', async (scheme, p) => {
    mockScheme = scheme;
    setOS('web');
    await render(<Field label="Age" invalid />);
    expect(style('Age')).toMatchObject({ borderColor: p.danger, outlineStyle: 'none' });
    await fireEvent(screen.getByLabelText('Age'), 'focus');
    expect(style('Age')).toMatchObject({ borderColor: p.danger, borderWidth: 2, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2, outlineColor: p.focus });
    await fireEvent(screen.getByLabelText('Age'), 'blur');
    expect(style('Age')).toMatchObject({ outlineStyle: 'none' });
  });

  it('focused + invalid on native keeps the 2px danger border', async () => {
    setOS('android');
    await render(<Field label="Age" invalid />);
    await fireEvent(screen.getByLabelText('Age'), 'focus');
    expect(style('Age')).toMatchObject({ borderColor: light.danger, borderWidth: 2 });
    expect(style('Age')).not.toHaveProperty('outlineStyle');
  });
});
