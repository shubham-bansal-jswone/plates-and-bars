// Design tokens copied from the `:root` CSS of docs/prototype/plate-and-bar.html.
export interface Palette {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  track: string;
  brand: string;
  onBrand: string;
  protein: string;
  carbs: string;
  fat: string;
  tint: string;
  danger: string;
}

export const light: Palette = {
  bg: '#F5F4EE',
  surface: '#FFFFFF',
  ink: '#16201A',
  muted: '#5D6961',
  line: '#DEDFD6',
  track: '#E7E8E0',
  brand: '#1E5B41',
  onBrand: '#FFFFFF',
  protein: '#2E7D59',
  carbs: '#C98F0C',
  fat: '#C3533A',
  tint: '#EAF2EC',
  danger: '#B3412B',
};

export const dark: Palette = {
  bg: '#111613',
  surface: '#1A211D',
  ink: '#EAEEE8',
  muted: '#9AA69E',
  line: '#2B3530',
  track: '#27312B',
  brand: '#7FC9A2',
  onBrand: '#0F1A14',
  protein: '#62BC90',
  carbs: '#E8B53A',
  fat: '#E27C61',
  tint: '#1F2D25',
  danger: '#F08A70',
};
