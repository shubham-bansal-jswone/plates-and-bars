import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text as RNText } from 'react-native';
import { Chip, Disclosure, Field, MetricRow } from '../src/components/ui';
import { Skeleton } from '../src/components/Skeleton';
import { Text } from '../src/components/Text';
import { FontsProvider } from '../src/theme/fonts';

const mockUseFonts = jest.fn();
jest.mock('expo-font', () => ({ useFonts: () => mockUseFonts() }));

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe('Disclosure', () => {
  it('starts closed, does not mount children, and toggles aria-expanded', async () => {
    await render(<Disclosure label="More"><RNText>inside</RNText></Disclosure>);
    const b = screen.getByRole('button', { name: 'More' });
    expect(b.props['aria-expanded'] ?? b.props.accessibilityState?.expanded).toBe(false);
    expect(screen.queryByText('inside')).toBeNull();
    await fireEvent.press(b);
    expect(screen.getByText('inside')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More' }).props.accessibilityState?.expanded ?? screen.getByRole('button', { name: 'More' }).props['aria-expanded']).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByText('inside')).toBeNull();
  });

  it('opens at once with defaultOpen and uses a11yLabel as the spoken name', async () => {
    await render(<Disclosure label="Visible" a11yLabel="Spoken" defaultOpen><RNText>inside</RNText></Disclosure>);
    expect(screen.getByText('inside')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Spoken' })).toBeTruthy();
  });

  it('is controlled by `open` and reports the wish through onOpenChange', async () => {
    const onOpenChange = jest.fn();
    await render(<Disclosure label="More" open={false} onOpenChange={onOpenChange}><RNText>inside</RNText></Disclosure>);
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText('inside')).toBeNull();
  });
});

describe('MetricRow', () => {
  it('gives each cell one accessible "label: value" name', async () => {
    await render(<MetricRow cells={[{ label: 'Calories', value: '2,100' }, { label: 'Protein', value: '150 g' }]} />);
    expect(screen.getByLabelText('Calories: 2,100')).toBeTruthy();
    expect(screen.getByLabelText('Protein: 150 g')).toBeTruthy();
  });
});

describe('Field', () => {
  it('marks invalid with aria-invalid and a danger border that wins over the caller style', async () => {
    await render(<Field label="Name" invalid style={{ borderColor: 'red', minWidth: 50 }} />);
    const f = screen.getByLabelText('Name');
    expect(f.props['aria-invalid']).toBe(true);
    expect(flat(f).borderColor).not.toBe('red');
    expect(flat(f).minWidth).toBe(50);
  });

  it('is not invalid by default', async () => {
    await render(<Field label="Name" />);
    expect(screen.getByLabelText('Name').props['aria-invalid']).toBeUndefined();
  });
});

describe('Chip', () => {
  it('is 44px tall, toggles on press and reports pressed', async () => {
    const onPress = jest.fn();
    await render(<Chip label="Push" text="Push day" pressed onPress={onPress} />);
    const b = screen.getByRole('button', { name: 'Push' });
    expect(screen.getByText('Push day')).toBeTruthy();
    expect(flat(b).minHeight).toBe(44);
    expect(b.props.accessibilityState?.pressed ?? b.props['aria-pressed']).toBe(true);
    await fireEvent.press(b);
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Black Italic font mapping', () => {
  beforeEach(() => mockUseFonts.mockReturnValue([true, null]));
  const family = async (style: object) => {
    await render(<FontsProvider><Text style={style}>x</Text></FontsProvider>);
    return flat(screen.getByText('x'));
  };

  it('weight 900 italic draws Inter Black Italic and resets the synthetic style', async () => {
    const s = await family({ fontWeight: '900', fontStyle: 'italic' });
    expect(s.fontFamily).toBe('Inter_900Black_Italic');
    expect(s.fontStyle).toBe('normal');
  });

  it('italic at any other weight falls back to the upright face', async () => {
    expect((await family({ fontWeight: '700', fontStyle: 'italic' })).fontFamily).toBe('Inter_700Bold');
  });

  it('upright 900 is Inter Black', async () => {
    expect((await family({ fontWeight: '900' })).fontFamily).toBe('Inter_900Black');
  });
});

describe('Skeleton', () => {
  it('announces "Loading…" once and hides the blocks from screen readers', async () => {
    await render(<Skeleton heights={[10, 20]} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).toContain('"aria-hidden":true');
  });
});
