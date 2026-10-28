import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { VideoLink } from '../src/workout/VideoLink';
import { light } from '../src/theme/tokens';

// #1271: the `link` colour is the neutral ink, so a link text is told apart by its underline.
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.tsx') ? [join(dir, f)] : []));

describe('link text', () => {
  it('every Text drawn in the link colour is underlined', () => {
    const bad = files(join(__dirname, '../src')).flatMap((f) =>
      readFileSync(f, 'utf8').split('\n').flatMap((l, i) => (/color: c\.link\b/.test(l) && !/linkText|textDecorationLine: 'underline'/.test(l) ? [`${f}:${i + 1}`] : [])),
    );
    expect(bad).toEqual([]);
  });

  it('the YouTube link on Library detail and the how-to sheet is underlined ink', async () => {
    await render(<VideoLink name="Barbell Bench Press" />);
    expect(StyleSheet.flatten(screen.getByText(/Watch form videos/).props.style)).toMatchObject({ color: light.ink, textDecorationLine: 'underline' });
  });
});
