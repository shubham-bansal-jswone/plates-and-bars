import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Button } from '../src/components/ui';

const NAME = 'A'.repeat(30) + ' ' + 'B'.repeat(29);

it.each([`How to do ${NAME}`, `Can’t do ${NAME}`])('link "%s" can shrink and wrap inside its card (#1140)', async (label) => {
  await render(<Button label={label} kind="link" onPress={jest.fn()} />);
  const press = StyleSheet.flatten(screen.getByLabelText(label).props.style);
  const text = StyleSheet.flatten(screen.getByText(label).props.style);
  expect(press.maxWidth).toBe('100%');
  expect(press.minHeight).toBe(44);
  expect(press.alignSelf).toBe('flex-start');
  expect(press.width).toBeUndefined();
  expect(text.flexShrink).toBe(1);
  expect(text.whiteSpace).toBeUndefined();
});
