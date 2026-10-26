import { dark, light, type Palette } from '../src/theme/tokens';
import { toWeight } from '../src/theme/fonts';

// WCAG 2.x relative luminance and contrast ratio.
function lum(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Colour `fg` drawn at `alpha` over `bg`, as a hex string.
function blend(fg: string, bg: string, alpha: number): string {
  const px = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(px(fg, i) * alpha + px(bg, i) * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
}

type K = keyof Palette;
// Text on the surfaces it is drawn on. Disabled text is exempt (WCAG), so it is not listed.
const TEXT: [K, K][] = [
  ['ink', 'bg'], ['ink', 'surface'], ['ink', 'surfaceElevated'], ['ink', 'surfaceSoft'], ['ink', 'tint'], ['ink', 'field'], ['muted', 'field'],
  ['body', 'bg'], ['body', 'surface'], ['body', 'surfaceElevated'], ['body', 'tint'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surfaceElevated'], ['muted', 'surfaceSoft'],
  ['onBrand', 'brand'], ['onBrand', 'brandPressed'], ['onBrand', 'brandActive'],
  ['link', 'bg'], ['link', 'surface'], ['link', 'surfaceElevated'], ['link', 'tint'],
  ['danger', 'bg'], ['danger', 'surface'], ['caution', 'bg'], ['caution', 'surface'],
  ['toastFg', 'toastBg'], ['toastAction', 'toastBg'],
];
// Bars, borders, focus rings and icons: 3:1 against what they sit on.
const GRAPHIC: [K, K][] = [
  ['protein', 'surface'], ['protein', 'bg'], ['protein', 'track'],
  ['carbs', 'surface'], ['carbs', 'bg'], ['carbs', 'track'],
  ['fat', 'surface'], ['fat', 'bg'], ['fat', 'track'],
  ['caution', 'track'], ['danger', 'track'], ['bar', 'track'], ['brand', 'bg'], ['brand', 'surface'],
  ['outline', 'bg'], ['outline', 'surface'], ['outline', 'surfaceElevated'], ['outline', 'field'],
  ['focus', 'bg'], ['focus', 'surface'],
  // The off state of a switch (#153): its track must be visible against the page.
  ['muted', 'bg'], ['muted', 'surface'],
];

describe.each([['light', light], ['dark', dark]] as const)('%s palette', (_mode, p) => {
  it.each(TEXT)('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(GRAPHIC)('graphic %s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(3);
  });
  // The Seven-days bar draws its fill at opacity 0.85, so what reaches the eye is the blend over `track` (#504).
  it.each(['bar', 'caution'] as const)('%s fill at 0.85 opacity over track is at least 3:1', (k) => {
    expect(contrast(blend(p[k], p.track, 0.85), p.track)).toBeGreaterThanOrEqual(3);
  });
  it('only uses six-digit hex colours, so the maths above is what is drawn', () => {
    for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('font weights', () => {
  it('maps css weights to the faces we ship', () => {
    expect(['300', 300, 'normal', undefined, '500', '600', 'bold', '800', '900'].map(toWeight)).toEqual(['300', '300', '400', '400', '500', '600', '700', '800', '900']);
  });
});
