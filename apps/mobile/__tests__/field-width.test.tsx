import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Field } from '../src/components/ui';

const maxWidth = (label: string) => StyleSheet.flatten(screen.getByLabelText(label).props.style).maxWidth;

describe('Field width', () => {
  it('lets text fields fill their column', async () => {
    await render(<Field label="Search foods" placeholder="Search roti, paneer, whey…" />);
    expect(maxWidth('Search foods')).toBeUndefined();
  });

  it.each([
    ['inputMode', { inputMode: 'decimal' as const }],
    ['keyboardType', { keyboardType: 'numeric' as const }],
    ['keyboardType decimal-pad', { keyboardType: 'decimal-pad' as const }],
  ])('keeps numeric fields narrow by %s', async (_n, props) => {
    await render(<Field label="Weight" {...props} />);
    expect(maxWidth('Weight')).toBe(160);
  });

  it('lets a caller widen a numeric field with a real maxWidth', async () => {
    await render(<Field label="Calories" keyboardType="decimal-pad" style={{ maxWidth: '100%' }} />);
    expect(maxWidth('Calories')).toBe('100%');
  });
});
