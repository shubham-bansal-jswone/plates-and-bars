import { render, screen } from '@testing-library/react-native';
import { FontsProvider } from '../src/theme/fonts';
import { TrendChart } from '../src/progress/TrendChart';
import { BodyMap } from '../src/workout/BodyMap';

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

interface Node {
  type?: string;
  props?: { font?: { fontFamily?: string } };
  children?: Node[] | null;
}
/** fontFamily of every SVG text node in the rendered tree. */
function textFamilies(): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  const walk = (n: Node | null | undefined) => {
    if (!n) return;
    if (n.type === 'RNSVGText') out.push(n.props?.font?.fontFamily);
    n.children?.forEach(walk);
  };
  walk(screen.toJSON() as Node);
  return out;
}

describe('SVG labels use the body font (#908)', () => {
  it('TrendChart axis labels are set in Inter 400', async () => {
    const points = [{ date: '2026-10-01', v: 82 }, { date: '2026-10-02', v: 80.5 }];
    await render(
      <FontsProvider>
        <TrendChart points={points} box={{ W: 300, H: 100, px: 24, py: 10 }} label="Weight" />
      </FontsProvider>,
    );
    const families = textFamilies();
    expect(families).toHaveLength(2);
    for (const f of families) expect(f).toContain('Inter_400Regular');
  });

  it('BodyMap view names are set in Inter 400', async () => {
    await render(
      <FontsProvider>
        <BodyMap primary={[]} secondary={[]} />
      </FontsProvider>,
    );
    const families = textFamilies();
    expect(families).toHaveLength(2);
    for (const f of families) expect(f).toContain('Inter_400Regular');
  });

  it('BodyMap view names are at least 12 px (#1126)', async () => {
    await render(
      <FontsProvider>
        <BodyMap primary={[]} secondary={[]} />
      </FontsProvider>,
    );
    const sizes: number[] = [];
    const walk = (n: Node | null | undefined) => {
      if (!n) return;
      if (n.type === 'RNSVGText') sizes.push(Number((n.props as { font?: { fontSize?: unknown } }).font?.fontSize));
      n.children?.forEach(walk);
    };
    walk(screen.toJSON() as Node);
    expect(sizes).toHaveLength(2);
    for (const z of sizes) expect(z).toBeGreaterThanOrEqual(12);
  });
});
