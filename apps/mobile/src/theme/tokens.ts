// Design tokens. "TRAIN HARD. TRACK EVERYTHING.": black canvas, electric lime as the one high-energy signal (primary actions,
// active states, workout progress, key metrics). `dark` is the identity; `light` is the older
// "Plate blue" palette. useTheme picks one from the system colour scheme.
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
  /** The brand's secondary text colour. Only for large text or text on the canvas: on `surface` it is under 4.5:1 (use `muted`). */
  subtle: string;
  /** Disabled text; exempt from contrast rules. */
  disabled: string;
  line: string;
  track: string;
  /** Secondary button border: decorative, the label identifies the control. */
  ghostBorder: string;
  /** Input and control borders (3:1). */
  outline: string;
  brand: string;
  /** Fill of a goal bar drawn on `track` (3:1, also at the 0.85 opacity the Seven-days bar uses). `brand` is too dark for that in dark mode (#504). */
  bar: string;
  /** Body map: the stroke round every muscle, 3:1 against the page and the cards, so the silhouette shows (#1197). Unworked muscles are filled with `surfaceSoft`. */
  muscleOff: string;
  /** Body map: fill of a muscle that also works. 3:1 against the page, the cards and `surfaceSoft`; main (`brand`) vs this is lower (see theme-contrast.test.ts). */
  muscleAlso: string;
  brandPressed: string;
  brandActive: string;
  onBrand: string;
  /** Secondary actions and links (Recipes, Why?, credits, Back): the neutral ink, underlined by `linkText`. The accent (`brand`) is only the key number and the one primary action (#1271). */
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
  /** Restrained glow under the one primary action and the rest-timer ring; lime in dark, none in light. */
  glow: string;
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
  subtle: '#6B6B6B',
  disabled: '#CCCCCC',
  line: '#E6E8EC',
  track: '#E6E8EC',
  ghostBorder: '#CCCCCC',
  outline: '#8B8F9B',
  brand: '#2457E6',
  bar: '#2457E6',
  muscleOff: '#8E8E8E',
  muscleAlso: '#6286EA',
  brandPressed: '#1D48C2',
  brandActive: '#16389A',
  onBrand: '#FFFFFF',
  link: '#000000',
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
  glow: '#FFFFFF',
};

export const dark: Palette = {
  bg: '#090B09',
  surface: '#151915',
  field: '#151915',
  surfaceElevated: '#1C211C',
  surfaceSoft: '#232923',
  ink: '#F5F7F2',
  body: '#B4BBB3',
  muted: '#8E968D',
  subtle: '#777F76',
  disabled: '#4F574F',
  line: '#2A302A',
  track: '#2A302A',
  ghostBorder: '#4A524A',
  outline: '#6B736A',
  brand: '#B7FF00',
  bar: '#B7FF00',
  muscleOff: '#667066',
  muscleAlso: '#6D9412',
  brandPressed: '#9EE000',
  brandActive: '#86C400',
  onBrand: '#090B09',
  link: '#F5F7F2',
  focus: '#B7FF00',
  protein: '#B7FF00',
  carbs: '#2DD4BF',
  fat: '#F5B53D',
  tint: '#1C2410',
  danger: '#FF5252',
  caution: '#FFB020',
  toastBg: '#F5F7F2',
  toastFg: '#090B09',
  toastAction: '#3F5F00',
  shadow: '#000000',
  glow: '#B7FF00',
};

/** Corner radii: inputs, cards and tiles, sheets, and every button, chip and badge. */
export const radius = { sm: 10, md: 14, lg: 20, full: 9999 } as const;

/** Spacing scale. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** Widest a progress chart (and its range control) is drawn, px: on a wide screen it stays a readable shape instead of stretching with the card. */
export const CHART_MAX_WIDTH = 560;

export type FontWeight = '300' | '400' | '500' | '600' | '700' | '800' | '900';

export interface TextStyleToken {
  fontSize: number;
  fontWeight: FontWeight;
  lineHeight: number;
  letterSpacing?: number;
  /** Italic is only drawn for the Black weight (the athletic display face). */
  fontStyle?: 'italic';
}

/** Type scale: Inter throughout. Display, titles and metrics are ExtraBold or Black (italic Black for the hero face); labels and buttons Bold. */
export const type = {
  display: { fontSize: 40, fontWeight: '900', lineHeight: 44, letterSpacing: -0.8, fontStyle: 'italic' },
  title: { fontSize: 30, fontWeight: '800', lineHeight: 36, letterSpacing: -0.5 },
  heading: { fontSize: 22, fontWeight: '800', lineHeight: 28, letterSpacing: -0.3 },
  label: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  textBody: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  bodyStrong: { fontSize: 16, fontWeight: '600', lineHeight: 24 },
  caption: { fontSize: 14, fontWeight: '400', lineHeight: 21 },
  small: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  button: { fontSize: 16, fontWeight: '800', lineHeight: 20, letterSpacing: 0.3 },
  buttonSm: { fontSize: 14, fontWeight: '700', lineHeight: 18, letterSpacing: 0.2 },
  /** Oversized workout numbers: the rest countdown, weight and reps while logging, the day's kcal left. Pair with `tabular`. */
  metric: { fontSize: 56, fontWeight: '900', lineHeight: 60, letterSpacing: -1.5, fontStyle: 'italic' },
  metricSm: { fontSize: 28, fontWeight: '900', lineHeight: 32, letterSpacing: -0.5, fontStyle: 'italic' },
} as const satisfies Record<string, TextStyleToken>;

/** Digits of equal width, so a ticking timer or a column of weights does not jitter. */
export const tabular = { fontVariant: ['tabular-nums'] } as const;

/** Underline for a link: the neutral ink needs more than colour to read as a link. Spread it into the link's Text style. */
export const linkText = { textDecorationLine: 'underline' } as const;

/** The glow of a primary action: lime, low opacity, no offset. Dark theme only in effect (light's `glow` is #FFFFFF). */
export const glowShadow = { shadowOffset: { width: 0, height: 0 }, shadowRadius: 16, shadowOpacity: 0.3 } as const;

/** Resting elevation is none; this is the pressed-state shadow (0 4px 12px, 16% black). */
export const pressedShadow = { shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, shadowOpacity: 0.16, elevation: 4 } as const;
