import { processColor, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { barLayout, WEIGHT_CHART_BOX as box } from '@plate-and-bar/core';
import { BarChart, type Bar } from '../src/progress/BarChart';
import { CHART_MAX_WIDTH, dark, light } from '../src/theme/tokens';
import * as useThemeModule from '../src/theme/useTheme';

afterEach(() => jest.restoreAllMocks());

interface N { type?: string; props?: Record<string, unknown> & { font?: { fontSize?: unknown } }; children?: N[] | null }
const walk = (type: string): N[] => {
  const out: N[] = [];
  const go = (n: N | null | undefined) => {
    if (!n) return;
    if (n.type === type) out.push(n);
    n.children?.forEach(go);
  };
  go(screen.toJSON() as N);
  return out;
};
const rect = (id: string) => walk('RNSVGRect').find((n) => n.props?.testID === id);
const num = (n: N | undefined, k: string) => Number(n?.props?.[k]);
const hidden = { includeHiddenElements: true } as const;

const weeks: Bar[] = [
  { label: '2026-09-14', value: 2000 },
  { label: '2026-09-21', value: 1500 },
  { label: '2026-09-28', value: null },
  { label: '2026-10-05', value: 1000, partial: true },
  { label: '2026-10-12', value: 2400 },
];
const base = { box, unit: 'kcal', noun: 'Calories', valueHeader: 'Average', label: 'Average calories by week' };

describe('BarChart geometry', () => {
  it('draws each bar where core barLayout puts it', async () => {
    await render(<BarChart {...base} bars={weeks} />);
    const lay = barLayout(weeks.map((w) => w.value), undefined, box)!;
    for (const [i, w] of weeks.entries()) {
      const r = lay.bars[i];
      if (!r || w.partial) continue;
      const n = rect(`bar-${w.label}`);
      expect([num(n, 'x'), num(n, 'y'), num(n, 'width'), num(n, 'height')]).toEqual([r.x, r.y, r.width, r.height]);
    }
    expect(num(rect('bar-2026-10-12'), 'height')).toBeCloseTo(118, 6);
    expect(num(rect('bar-2026-09-14'), 'height')).toBeCloseTo((2000 / 2400) * 118, 6);
  });

  it('leaves a gap for a null value: no bar of any height', async () => {
    await render(<BarChart {...base} bars={weeks} />);
    expect(rect('bar-2026-09-28')).toBeUndefined();
    expect(walk('RNSVGRect')).toHaveLength(4);
  });
});

describe.each([['light', light], ['dark', dark]] as const)('BarChart styling in %s', (_m, p) => {
  beforeEach(() => jest.spyOn(useThemeModule, 'useTheme').mockReturnValue(p));
  const paint = (n: N | undefined, k: 'fill' | 'stroke') => n?.props?.[k] as { payload?: unknown } | null | undefined;
  const colour = (hex: string) => ({ type: 0, payload: processColor(hex) });

  it('fills a bar in the contrast-checked bar token, not brand', async () => {
    await render(<BarChart {...base} bars={weeks} />);
    expect(paint(rect('bar-2026-09-14'), 'fill')).toEqual(colour(p.bar));
    if (p.bar !== p.brand) expect(paint(rect('bar-2026-09-14'), 'fill')).not.toEqual(colour(p.brand));
  });

  it('draws a partial week hollow: no fill, an outline in the bar token', async () => {
    await render(<BarChart {...base} bars={weeks} />);
    const n = rect('bar-2026-10-05');
    expect(paint(n, 'fill')).toBeNull();
    expect(paint(n, 'stroke')).toEqual(colour(p.bar));
    expect(rect('ring-2026-10-05')).toBeUndefined();
  });

  it('gives a below-target bar an inner ring in the page colour, with the fill kept', async () => {
    await render(<BarChart {...base} bars={weeks} target={{ value: 1800 }} />);
    expect(paint(rect('bar-2026-09-21'), 'fill')).toEqual(colour(p.bar));
    expect(paint(rect('ring-2026-09-21'), 'stroke')).toEqual(colour(p.bg));
    // At or over target, a gap and a partial week get no ring.
    for (const d of ['2026-09-14', '2026-10-12', '2026-10-05', '2026-09-28']) expect(rect(`ring-${d}`)).toBeUndefined();
  });

  it('keeps the ring visible against the bar: 3:1 in both modes, so it survives greyscale', () => {
    expect(contrast(p.bg, p.bar)).toBeGreaterThanOrEqual(3);
    // The hollow bar's outline sits on the page.
    expect(contrast(p.bg, p.bar)).toBeGreaterThanOrEqual(3);
  });

  it('draws the target line in ink at half opacity', async () => {
    await render(<BarChart {...base} bars={weeks} target={{ value: 1800 }} />);
    const line = walk('RNSVGLine').find((l) => l.props?.strokeOpacity === 0.5);
    expect(line?.props?.stroke).toEqual(colour(p.ink));
  });
});

const lum = (hex: string): number => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
};
const contrast = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe('BarChart target', () => {
  it('does not change any bar x or width, only the heights', async () => {
    const geo = () => walk('RNSVGRect').filter((n) => String(n.props?.testID).startsWith('bar-')).map((n) => [n.props?.testID, num(n, 'x'), num(n, 'width'), num(n, 'height')] as const);
    await render(<BarChart {...base} bars={weeks} />);
    const without = geo();
    await screen.unmount();
    await render(<BarChart {...base} bars={weeks} target={{ value: 3000 }} />);
    const withT = geo();
    expect(withT.map((g) => [g[0], g[1], g[2]])).toEqual(without.map((g) => [g[0], g[1], g[2]]));
    expect(withT[0]![3]).toBeLessThan(without[0]![3]);
  });

  it('draws a far target nowhere, but still names it', async () => {
    await render(<BarChart {...base} bars={weeks} target={{ value: 9000 }} />);
    expect(walk('RNSVGLine').filter((l) => l.props?.strokeOpacity === 0.5)).toHaveLength(0);
    expect(screen.getByText('Target 9000 kcal')).toBeTruthy();
    expect(num(rect('bar-2026-10-12'), 'height')).toBeCloseTo(118, 6);
  });

  it('draws a near target, with the default or a given caption', async () => {
    await render(<BarChart {...base} bars={weeks} target={{ value: 1800 }} />);
    expect(walk('RNSVGLine').filter((l) => l.props?.strokeOpacity === 0.5)).toHaveLength(1);
    expect(screen.getByText('Target 1800 kcal')).toBeTruthy();
    await screen.unmount();
    await render(<BarChart {...base} bars={weeks} target={{ value: 1800, caption: 'Your goal: 1800 kcal' }} />);
    expect(screen.getByText('Your goal: 1800 kcal')).toBeTruthy();
  });
});

describe('BarChart table and labels', () => {
  const open = () => fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));

  it('lists not logged, few days logged and the below-target flag as text', async () => {
    await render(<BarChart {...base} bars={weeks} target={{ value: 1800 }} />);
    await open();
    expect(screen.getByLabelText('21 Sept 2026, 1500 kcal, Target 1800 kcal, 300 kcal under, Below target')).toBeTruthy();
    expect(screen.getByLabelText('14 Sept 2026, 2000 kcal, Target 1800 kcal, 200 kcal over')).toBeTruthy();
    expect(screen.getByLabelText('28 Sept 2026, Not logged')).toBeTruthy();
    // A partial week says so and is not flagged against the target.
    expect(screen.getByLabelText('5 Oct 2026, 1000 kcal, few days logged, Target 1800 kcal, 800 kcal under')).toBeTruthy();
  });

  it('has no target or delta text without a target, and says On target at the target', async () => {
    await render(<BarChart {...base} bars={weeks} />);
    await open();
    expect(screen.getByLabelText('14 Sept 2026, 2000 kcal')).toBeTruthy();
    await screen.unmount();
    await render(<BarChart {...base} bars={[weeks[0]!, weeks[4]!]} target={{ value: 2000 }} />);
    await open();
    expect(screen.getByLabelText('14 Sept 2026, 2000 kcal, Target 2000 kcal, On target')).toBeTruthy();
  });

  it('wires the summary to the image role, with gaps, partial and below-target weeks added', async () => {
    await render(<BarChart {...base} bars={weeks} target={{ value: 1800 }} />);
    const img = screen.getByRole('image');
    expect(img.props.accessibilityLabel).toBe('Average calories by week. Not logged: 28 Sept. Few days logged: 5 Oct. Below target: 21 Sept');
    await screen.unmount();
    await render(<BarChart {...base} bars={[weeks[0]!, weeks[4]!]} />);
    expect(screen.getByRole('image').props.accessibilityLabel).toBe('Average calories by week');
  });

  it('labels the first and last week, and the axis text is at least 12px as drawn', async () => {
    await render(<BarChart {...base} bars={weeks} />);
    expect(screen.getByText('14 Sept', hidden)).toBeTruthy();
    expect(screen.getByText('12 Oct', hidden)).toBeTruthy();
    const sizes = walk('RNSVGText').map((t) => Number(t.props?.font?.fontSize));
    expect(sizes).toHaveLength(2);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(12);
  });

  it('caps the width and draws nothing without bars', async () => {
    await render(<BarChart {...base} bars={weeks} />);
    const root = screen.toJSON() as unknown as { props: { style: unknown } };
    expect(StyleSheet.flatten(root.props.style as never)).toMatchObject({ maxWidth: CHART_MAX_WIDTH });
    await screen.unmount();
    await render(<BarChart {...base} bars={[]} />);
    expect(screen.toJSON()).toBeNull();
  });
});
