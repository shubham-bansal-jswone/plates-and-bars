/** `fg` over `bg` at `a` (0 to 1), as a hex: tints are built from palette values, not literals. */
export function blend(fg: string, bg: string, a: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(fg, i) * a + ch(bg, i) * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
}
