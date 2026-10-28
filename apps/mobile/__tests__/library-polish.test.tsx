import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { ExerciseLibraryScreen } from '../src/library/ExerciseLibraryScreen';
import { Page } from '../src/components/ui';
import { getLibrary } from '../src/library/exercises';
import { type } from '../src/theme/tokens';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

describe('library polish (#1198)', () => {
  it('the list content column is as wide as the shared Page column', async () => {
    const page = await render(<Page><Text testID="c">x</Text></Page>);
    const col = StyleSheet.flatten(page.getByTestId('c').parent!.props.style);
    await page.unmount();
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    let node = screen.getByText('Exercise library').parent;
    while (node && !node.props.contentContainerStyle) node = node.parent;
    const content = StyleSheet.flatten(node!.props.contentContainerStyle);
    expect(content.maxWidth - 2 * content.padding).toBe(col.maxWidth);
  });

  it('exercise detail section headings use the shared heading size', async () => {
    const e = getLibrary().find((x) => x.card);
    await render(<ExerciseLibraryScreen onBack={() => {}} />);
    await fireEvent.press(screen.getByText(e!.name));
    const h = screen.getByRole('header', { name: 'Key cues' });
    expect(StyleSheet.flatten(h.props.style).fontSize).toBe(type.heading.fontSize);
  });
});
