import { render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import { FontsProvider } from '../src/theme/fonts';
import { Text } from '../src/components/Text';
import { Input } from '../src/components/Input';
import { TrendChart } from '../src/progress/TrendChart';

const mockUseFonts = jest.fn();
jest.mock('expo-font', () => ({ useFonts: () => mockUseFonts() }));

// DESIGN.md 4.1 fallback stack
const STACK = "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";

interface Node {
  type?: string;
  props?: { font?: { fontFamily?: string } };
  children?: Node[] | null;
}
function svgFamilies(): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  const walk = (n: Node | null | undefined) => {
    if (!n) return;
    if (n.type === 'RNSVGText') out.push(n.props?.font?.fontFamily);
    n.children?.forEach(walk);
  };
  walk(screen.toJSON() as Node);
  return out;
}

const points = [{ date: '2026-10-01', v: 82 }, { date: '2026-10-02', v: 80.5 }];
async function renderAll() {
  await render(
    <FontsProvider>
      <Text style={{ fontWeight: '700' }}>Bold</Text>
      <Input accessibilityLabel="field" />
      <TrendChart points={points} box={{ W: 300, H: 100, px: 24, py: 10 }} label="Weight" />
    </FontsProvider>,
  );
}

const states: [string, unknown[]][] = [
  ['not ready', [false, null]],
  ['failed', [false, new Error('load failed')]],
];

describe.each(['web', 'ios', 'android'] as const)('font fallback on %s', (os) => {
  const original = Platform.OS;
  beforeEach(() => {
    Platform.OS = os;
  });
  afterEach(() => {
    Platform.OS = original;
  });

  it.each(states)('%s: SVG labels, Input and Text', async (_n, result) => {
    mockUseFonts.mockReturnValue(result);
    await renderAll();
    const expected = os === 'web' ? STACK : undefined;
    const labels = svgFamilies();
    expect(labels).toHaveLength(2);
    // The SVG renderer keeps only the first family of a stack off web, so compare that one; Input shows the full string.
    for (const f of labels) expect(f).toBe(expected?.split(',')[0]);
    expect(StyleSheet.flatten(screen.getByLabelText('field').props.style).fontFamily).toBe(expected);
    // Text keeps its own weight until the fonts are there.
    const text = StyleSheet.flatten(screen.getByText('Bold').props.style);
    expect(text.fontFamily).toBeUndefined();
    expect(text.fontWeight).toBe('700');
  });

  it('ready: Inter, with the stack behind it on web only', async () => {
    mockUseFonts.mockReturnValue([true, null]);
    await renderAll();
    const expected = os === 'web' ? `Inter_400Regular, ${STACK}` : 'Inter_400Regular';
    for (const f of svgFamilies()) expect(f).toBe('Inter_400Regular');
    expect(StyleSheet.flatten(screen.getByLabelText('field').props.style).fontFamily).toBe(expected);
    expect(StyleSheet.flatten(screen.getByText('Bold').props.style).fontFamily).toBe(
      os === 'web' ? `Inter_700Bold, ${STACK}` : 'Inter_700Bold',
    );
  });
});
