// Design tokens from docs/design/DESIGN.md (issue #179): "Plate blue" on black and white canvases.
// This is the only file with colour values. Macro colours are for bars, rings, dots and icons, never text.
export interface Palette {
  /** Page canvas. */
  bg: string;
  /** Cards and inputs. */
  surface: string;
  /** Input fill: canvas in light, surface in dark. */
  field: string;
  /** Raised band in dark mode (same as the canvas in light). */
  surfaceElevated: string;
  /** Default chip fill and disabled button fill. */
  surfaceSoft: string;
  ink: string;
  body: string;
  muted: string;
  /** Disabled text; exempt from contrast rules. */
  disabled: string;
  line: string;
  track: string;
  /** Secondary button border: decorative, the label identifies the control. */
  ghostBorder: string;
  /** Input and control borders (3:1). */
  outline: string;
  brand: string;
  brandPressed: string;
  brandActive: string;
  onBrand: string;
  /** Blue used as text or icon on the canvas. */
  link: string;
  /** Focus ring colour. */
  focus: string;
  protein: string;
  carbs: string;
  fat: string;
  tint: string;
  danger: string;
  /** Over target, low coverage. */
  caution: string;
  /** Toasts invert the canvas. */
  toastBg: string;
  toastFg: string;
  toastAction: string;
  /** Pressed-state shadow colour. */
  shadow: string;
}

export const light: Palette = {
  bg: '#FFFFFF',
  surface: '#F5F7FA',
  field: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceSoft: '#F3F3F3',
  ink: '#000000',
  body: '#5C5F66',
  muted: '#6B6B6B',
  disabled: '#CCCCCC',
  line: '#E6E8EC',
  track: '#E6E8EC',
  ghostBorder: '#CCCCCC',
  outline: '#8B8F9B',
  brand: '#2457E6',
  brandPressed: '#1D48C2',
  brandActive: '#16389A',
  onBrand: '#FFFFFF',
  link: '#1D48C2',
  focus: '#2457E6',
  protein: '#2457E6',
  carbs: '#0E8F8E',
  fat: '#C86D06',
  tint: '#EAF0FE',
  danger: '#C81B3A',
  caution: '#C2410C',
  toastBg: '#000000',
  toastFg: '#FFFFFF',
  toastAction: '#8AB0FF',
  shadow: '#000000',
};

export const dark: Palette = {
  bg: '#000000',
  surface: '#181818',
  field: '#181818',
  surfaceElevated: '#121314',
  surfaceSoft: '#1F1F1F',
  ink: '#FFFFFF',
  body: '#B3B3B3',
  muted: '#A3A3A3',
  disabled: '#5C5C5C',
  line: '#2A2B2D',
  track: '#2A2B2D',
  ghostBorder: '#2A2B2D',
  outline: '#63656A',
  brand: '#2457E6',
  brandPressed: '#1D48C2',
  brandActive: '#16389A',
  onBrand: '#FFFFFF',
  link: '#8AB0FF',
  focus: '#8AB0FF',
  protein: '#6F95FF',
  carbs: '#2DD4BF',
  fat: '#F5B53D',
  tint: '#0F1A33',
  danger: '#FF6B81',
  caution: '#FB923C',
  toastBg: '#FFFFFF',
  toastFg: '#000000',
  toastAction: '#1D48C2',
  shadow: '#000000',
};

/** Corner radii: inputs, cards and tiles, sheets, and every button, chip and badge. */
export const radius = { sm: 4, md: 8, lg: 16, full: 9999 } as const;

/** Spacing scale. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export type FontWeight = '300' | '400' | '500' | '600' | '700';

export interface TextStyleToken {
  fontSize: number;
  fontWeight: FontWeight;
  lineHeight: number;
  letterSpacing?: number;
}

/** Mobile type scale: display and headings in Roboto 300, everything else in Inter. */
export const type = {
  display: { fontSize: 34, fontWeight: '300', lineHeight: 41, letterSpacing: -0.1 },
  title: { fontSize: 28, fontWeight: '300', lineHeight: 35 },
  heading: { fontSize: 22, fontWeight: '300', lineHeight: 28 },
  label: { fontSize: 18, fontWeight: '600', lineHeight: 22 },
  textBody: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  bodyStrong: { fontSize: 16, fontWeight: '500', lineHeight: 24 },
  caption: { fontSize: 14, fontWeight: '400', lineHeight: 21 },
  small: { fontSize: 12, fontWeight: '500', lineHeight: 18 },
  button: { fontSize: 16, fontWeight: '700', lineHeight: 20, letterSpacing: 0.4 },
  buttonSm: { fontSize: 14, fontWeight: '700', lineHeight: 18, letterSpacing: 0.3 },
} as const satisfies Record<string, TextStyleToken>;

/** Resting elevation is none; this is the pressed-state shadow (0 4px 12px, 16% black). */
export const pressedShadow = { shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.16, elevation: 4 } as const;
